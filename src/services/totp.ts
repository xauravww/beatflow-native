/**
 * Pure-JS TOTP (RFC 6238) for Spotify's anonymous-token endpoint.
 *
 * Spotify now requires a TOTP code when minting tokens from
 * `open.spotify.com/api/token` (the old `/get_access_token` endpoint is
 * deprecated). The approach mirrors SpotAPI (github.com/Aran404/SpotAPI):
 * a shared secret (rotated by Spotify) is XOR-obfuscated, its digits are
 * used as the TOTP key, and the code is sent as `totp`/`totpServer`.
 *
 * No native crypto — SHA-1/HMAC implemented in plain JS so it runs
 * anywhere (Hermes, Jest, Node).
 */

// --- SHA-1 (FIPS 180-4) ---------------------------------------------------

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) | 0;
}

/** SHA-1 of `data`. Returns 20 bytes. */
export function sha1(data: Uint8Array): Uint8Array {
  const originalLength = data.length;
  const bitLength = originalLength * 8;
  const paddedLength = Math.ceil((originalLength + 9) / 64) * 64;
  const msg = new Uint8Array(paddedLength);
  msg.set(data);
  msg[originalLength] = 0x80;
  const dv = new DataView(msg.buffer);
  // 64-bit big-endian bit length (safe: bitLength < 2^53)
  dv.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  dv.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);
  for (let i = 0; i < paddedLength; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = dv.getInt32(i + t * 4, false);
    }
    for (let t = 16; t < 80; t++) {
      w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      const f =
        t < 20
          ? (b & c) | (~b & d)
          : t < 40
            ? b ^ c ^ d
            : t < 60
              ? (b & c) | (b & d) | (c & d)
              : b ^ c ^ d;
      const k =
        t < 20
          ? 0x5a827999
          : t < 40
            ? 0x6ed9eba1
            : t < 60
              ? 0x8f1bbcdc
              : 0xca62c1d6;
      const temp = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const outDv = new DataView(out.buffer);
  outDv.setInt32(0, h0, false);
  outDv.setInt32(4, h1, false);
  outDv.setInt32(8, h2, false);
  outDv.setInt32(12, h3, false);
  outDv.setInt32(16, h4, false);
  return out;
}

// --- HMAC-SHA1 (RFC 2104) -------------------------------------------------

function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  const k = key.length > blockSize ? sha1(key) : key;
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    const kb = i < k.length ? k[i] : 0;
    ipad[i] = kb ^ 0x36;
    opad[i] = kb ^ 0x5c;
  }
  const innerInput = new Uint8Array(ipad.length + message.length);
  innerInput.set(ipad);
  innerInput.set(message, ipad.length);
  const inner = sha1(innerInput);
  const outerInput = new Uint8Array(opad.length + inner.length);
  outerInput.set(opad);
  outerInput.set(inner, opad.length);
  return sha1(outerInput);
}

// --- TOTP (RFC 6238: SHA-1, 6 digits, 30s step) ----------------------------

/**
 * One-time password for `key` at a given unix time counter.
 * `timeCounter` is the unix seconds value; default = now.
 */
export function generateTotp(
  key: Uint8Array,
  timeCounter = Math.floor(Date.now() / 1000),
): string {
  const counter = Math.floor(timeCounter / 30);
  const counterBuf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const h = hmacSha1(key, counterBuf);
  const offset = h[h.length - 1] & 0x0f;
  const bin =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff);
  return (bin % 1000000).toString().padStart(6, '0');
}

// --- Spotify-specific TOTP secret -----------------------------------------

/** Hardcoded fallback (Spotify's current shared secret, version 61). */
const FALLBACK_SECRET: number[] = [
  44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102,
  43, 69, 49, 120, 118, 80, 64, 78,
];
const FALLBACK_VERSION = 61;

/** ThetaDev's rotating spotify-secrets repo (same source SpotAPI uses). */
const SECRET_URL =
  'https://code.thetadev.de/ThetaDev/spotify-secrets/raw/branch/main/secrets/secretDict.json';

let cachedSecret: { version: number; bytes: number[] } | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 15 * 60 * 1000;

/**
 * Latest Spotify TOTP secret. Refreshed from the secrets repo (cached
 * 15 min); falls back to the hardcoded secret when offline/blocked.
 */
export async function getSpotifyTotpSecret(): Promise<{
  version: number;
  bytes: number[];
}> {
  if (cachedSecret && Date.now() < cacheExpiry) {
    return cachedSecret;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(SECRET_URL, { signal: controller.signal });
    if (res.ok) {
      const dict = (await res.json()) as Record<string, number[]>;
      const versions = Object.keys(dict)
        .map(Number)
        .filter((v) => !isNaN(v));
      const latest = Math.max(...versions);
      const bytes = dict[String(latest)];
      if (Array.isArray(bytes) && bytes.length > 0) {
        cachedSecret = { version: latest, bytes };
        cacheExpiry = Date.now() + CACHE_TTL;
        return cachedSecret;
      }
    }
  } catch {
    // network blocked or repo down — fall through to the hardcoded secret
  } finally {
    clearTimeout(timer);
  }
  cachedSecret = { version: FALLBACK_VERSION, bytes: FALLBACK_SECRET };
  cacheExpiry = Date.now() + CACHE_TTL;
  return cachedSecret;
}

/**
 * The `totp` / `totpVer` / `totpServer` query params Spotify's token
 * endpoint expects. The key is the ASCII digits of the XOR-transformed
 * secret (verified live against open.spotify.com/api/token → HTTP 200).
 */
export async function buildSpotifyTotpParams(): Promise<{
  totp: string;
  totpVer: number;
  totpServer: string;
}> {
  const { version, bytes } = await getSpotifyTotpSecret();
  const transformed = bytes.map((e, i) => e ^ ((i % 33) + 9));
  // UTF-8 encode the ASCII digit string without TextEncoder (not in RN's libs).
  const digits = transformed.join('');
  const key = new Uint8Array(digits.length);
  for (let i = 0; i < digits.length; i++) {
    key[i] = digits.charCodeAt(i) & 0xff;
  }
  const code = generateTotp(key);
  return { totp: code, totpVer: version, totpServer: code };
}
