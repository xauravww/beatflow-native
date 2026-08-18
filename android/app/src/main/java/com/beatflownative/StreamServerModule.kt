package com.beatflownative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * A tiny HTTP server that runs inside the app (bound to 127.0.0.1 only) and
 * streams the direct YouTube audio URL for a video id. ExoPlayer plays from
 * `http://127.0.0.1:<port>/stream/<videoId>` while this module proxies to
 * the googlevideo URL registered from JS.
 *
 * Why proxy instead of handing ExoPlayer the googlevideo URL directly:
 *
 *  - The upstream URL expires (~6h) and is re-resolved from JS; the player
 *    only ever holds the stable local URL.
 *  - It pins the YouTube client User-Agent that the URL was issued for.
 *  - Range handling lives in one place. Progressive (itag 18) URLs accept any
 *    range — measured: `bytes=0-` -> 206, no Range -> 200 — so those are
 *    passed straight through. Adaptive audio URLs are stricter (they 403 any
 *    offset at or past 1 MiB without a PoToken), so the pump falls back to
 *    bounded windows when upstream refuses a range.
 */
class StreamServerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule() {

    override fun getName() = "StreamServer"

    private class Entry(
        val url: String,
        val userAgent: String,
        /** Total size from the player response, or -1 when unknown. */
        val contentLength: Long,
        val contentType: String,
    )

    private val entries = ConcurrentHashMap<String, Entry>()
    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null
    private val pool: ExecutorService = Executors.newCachedThreadPool()

    companion object {
        /** Max bytes per upstream range request — googlevideo only serves
         * bounded ranges, and small windows keep seeks responsive. */
        private const val WINDOW = 1 * 1024 * 1024 // 1 MB
        private const val UA =
            "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)"
    }

    @ReactMethod
    fun start(port: Int, promise: Promise) {
        if (running.get()) {
            promise.resolve(true)
            return
        }
        try {
            val ss = ServerSocket(port, 50, InetAddress.getByName("127.0.0.1"))
            serverSocket = ss
            running.set(true)
            acceptThread = Thread {
                while (running.get()) {
                    try {
                        val sock = ss.accept()
                        pool.execute { handle(sock) }
                    } catch (e: Exception) {
                        // Only a closed server socket ends the loop; transient
                        // accept errors are retried.
                        if (!running.get() || ss.isClosed) break
                    }
                }
            }.apply {
                isDaemon = true
                start()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            running.set(false)
            promise.reject("E_START", e.message)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        running.set(false)
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
        promise.resolve(true)
    }

    @ReactMethod
    fun isRunning(promise: Promise) {
        promise.resolve(running.get())
    }

    /**
     * Register (or replace) the upstream URL for a video id.
     * `contentLength` comes from the player response's format entry; pass 0
     * or a negative value when unknown and the proxy will probe for it.
     */
    @ReactMethod
    fun registerUrl(
        videoId: String,
        url: String,
        userAgent: String?,
        contentLength: Double,
        contentType: String?,
    ) {
        entries[videoId] = Entry(
            url = url,
            userAgent = if (userAgent.isNullOrEmpty()) UA else userAgent,
            contentLength = if (contentLength > 0) contentLength.toLong() else -1L,
            contentType =
                if (contentType.isNullOrEmpty()) "audio/mp4" else contentType,
        )
    }

    @ReactMethod
    fun clearUrls() {
        entries.clear()
    }

    // ---- request handling ------------------------------------------------

    private fun handle(sock: Socket) {
        try {
            sock.soTimeout = 30_000
            sock.tcpNoDelay = true
            val input = BufferedInputStream(sock.getInputStream())
            val output = BufferedOutputStream(sock.getOutputStream())

            val head = readHeaders(input) ?: return
            val lines = head.split("\r\n")
            val parts = (lines.firstOrNull() ?: return).split(" ")
            if (parts.size < 2) return
            val method = parts[0]
            val path = parts[1]

            val headers = mutableMapOf<String, String>()
            for (line in lines.drop(1)) {
                val i = line.indexOf(':')
                if (i > 0) {
                    headers[line.substring(0, i).trim().lowercase()] =
                        line.substring(i + 1).trim()
                }
            }

            if (path == "/health") {
                writeSimple(output, 200, "text/plain", "ok".toByteArray())
                return
            }

            val m = Regex("^/stream/([^/?#]+)").find(path)
            if ((method != "GET" && method != "HEAD") || m == null) {
                writeSimple(output, 404, "text/plain", "not found".toByteArray())
                return
            }
            val videoId = URLDecoder.decode(m.groupValues[1], "UTF-8")
            val entry = entries[videoId]
            if (entry == null) {
                writeSimple(
                    output,
                    404,
                    "text/plain",
                    "no url registered for $videoId".toByteArray(),
                )
                return
            }

            serve(entry, headers["range"], method == "HEAD", output)
        } catch (e: Exception) {
            // Client vanished or upstream died — nothing left to send.
        } finally {
            try {
                sock.close()
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Answer one client request for the whole (or a sub-range of the) track.
     * The client sees a single normal response with real total-length
     * semantics; upstream is read in [WINDOW]-sized pieces underneath.
     */
    private fun serve(
        entry: Entry,
        rangeHeader: String?,
        headOnly: Boolean,
        output: BufferedOutputStream,
    ) {
        val total =
            if (entry.contentLength > 0) entry.contentLength
            else probeTotalLength(entry)
        if (total <= 0) {
            writeSimple(
                output,
                502,
                "text/plain",
                "could not determine upstream length".toByteArray(),
            )
            return
        }

        // Parse the client's Range. Absent/unparseable means the whole file.
        var start = 0L
        var end = total - 1
        var partial = false
        if (rangeHeader != null) {
            val rm = Regex("bytes=(\\d*)-(\\d*)").find(rangeHeader)
            if (rm != null) {
                val s = rm.groupValues[1]
                val e = rm.groupValues[2]
                if (s.isNotEmpty()) {
                    start = s.toLongOrNull() ?: 0L
                    if (e.isNotEmpty()) {
                        end = e.toLongOrNull() ?: (total - 1)
                    }
                } else if (e.isNotEmpty()) {
                    // Suffix range: bytes=-N -> last N bytes
                    val n = e.toLongOrNull() ?: total
                    start = (total - n).coerceAtLeast(0L)
                }
                partial = true
            }
        }
        if (start >= total) {
            val sb = StringBuilder()
            sb.append("HTTP/1.1 416 Range Not Satisfiable\r\n")
            sb.append("Content-Range: bytes */").append(total).append("\r\n")
            sb.append("Content-Length: 0\r\n")
            sb.append("Connection: close\r\n\r\n")
            output.write(sb.toString().toByteArray(StandardCharsets.UTF_8))
            output.flush()
            return
        }
        end = end.coerceAtMost(total - 1)
        val length = end - start + 1

        val sb = StringBuilder()
        if (partial) {
            sb.append("HTTP/1.1 206 Partial Content\r\n")
            sb.append("Content-Range: bytes ")
                .append(start).append('-').append(end).append('/').append(total)
                .append("\r\n")
        } else {
            sb.append("HTTP/1.1 200 OK\r\n")
        }
        sb.append("Content-Type: ").append(entry.contentType).append("\r\n")
        sb.append("Content-Length: ").append(length).append("\r\n")
        sb.append("Accept-Ranges: bytes\r\n")
        sb.append("Connection: close\r\n\r\n")
        output.write(sb.toString().toByteArray(StandardCharsets.UTF_8))
        output.flush()
        if (headOnly) return

        // Pump upstream to the client. Progressive (itag 18) URLs serve any
        // range in one shot, so ask for the whole remainder first; only if
        // upstream refuses do we drop to bounded windows (some formats reject
        // large or open-ended ranges).
        var pos = start
        var bounded = false
        val buf = ByteArray(64 * 1024)
        while (pos <= end) {
            val reqEnd =
                if (bounded) (pos + WINDOW - 1).coerceAtMost(end) else end
            val written = copyRange(entry, pos, reqEnd, buf, output)
            if (written < 0L) {
                // Upstream rejected this range. Retry bounded once, then give up.
                if (!bounded) {
                    bounded = true
                    continue
                }
                break
            }
            if (written == 0L) {
                // No bytes and no error — nothing more to read.
                break
            }
            pos += written
        }
        try {
            output.flush()
        } catch (_: Exception) {
        }
    }

    /**
     * Fetch `[from, to]` from upstream and write it to the client.
     * Returns the bytes written, or -1 when upstream refused the range.
     */
    private fun copyRange(
        entry: Entry,
        from: Long,
        to: Long,
        buf: ByteArray,
        output: OutputStream,
    ): Long {
        val conn = URL(entry.url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "GET"
            conn.connectTimeout = 10_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("User-Agent", entry.userAgent)
            conn.setRequestProperty("Range", "bytes=$from-$to")
            conn.setRequestProperty("Accept", "*/*")
            conn.setRequestProperty("Accept-Encoding", "identity")
            val code = conn.responseCode
            if (code != 200 && code != 206) {
                return -1L
            }
            var written = 0L
            conn.inputStream.use { body ->
                while (true) {
                    val n = body.read(buf)
                    if (n < 0) break
                    output.write(buf, 0, n)
                    written += n
                }
            }
            output.flush()
            return written
        } catch (e: Exception) {
            // A write failure means the client hung up; a read failure means
            // upstream did. Either way, report progress so far.
            return 0L
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Learn the total size with a 2-byte ranged GET, reading it out of
     * `Content-Range: bytes 0-1/<total>`. Returns -1 when unavailable.
     */
    private fun probeTotalLength(entry: Entry): Long {
        val conn = URL(entry.url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "GET"
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            conn.setRequestProperty("User-Agent", entry.userAgent)
            conn.setRequestProperty("Range", "bytes=0-1")
            val code = conn.responseCode
            if (code != 206 && code != 200) return -1L
            val cr = conn.getHeaderField("Content-Range")
            try {
                conn.inputStream.close()
            } catch (_: Exception) {
            }
            if (cr != null) {
                val slash = cr.lastIndexOf('/')
                if (slash > 0) {
                    return cr.substring(slash + 1).trim().toLongOrNull() ?: -1L
                }
            }
            return -1L
        } catch (e: Exception) {
            return -1L
        } finally {
            conn.disconnect()
        }
    }

    private fun readHeaders(input: BufferedInputStream): String? {
        val buf = StringBuilder()
        var consecutive = 0
        while (buf.length < 16 * 1024) {
            val b = input.read()
            if (b == -1) return null
            buf.append(b.toChar())
            if (b == '\r'.code || b == '\n'.code) {
                consecutive++
            } else {
                consecutive = 0
            }
            if (consecutive >= 4) break
        }
        return buf.toString()
    }

    private fun writeSimple(
        output: BufferedOutputStream,
        code: Int,
        type: String,
        body: ByteArray,
    ) {
        val reason =
            when (code) {
                200 -> "OK"
                404 -> "Not Found"
                502 -> "Bad Gateway"
                else -> "Error"
            }
        val sb = StringBuilder()
        sb.append("HTTP/1.1 ").append(code).append(" ").append(reason).append("\r\n")
        sb.append("Content-Type: ").append(type).append("\r\n")
        sb.append("Content-Length: ").append(body.size).append("\r\n")
        sb.append("Connection: close\r\n\r\n")
        output.write(sb.toString().toByteArray(StandardCharsets.UTF_8))
        output.write(body)
        output.flush()
    }
}
