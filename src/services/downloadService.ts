import RNFS from 'react-native-fs';
import { getStreamUrl } from '../api/client';
import { Song } from '../api/types';
import { clearDownload, markDownloaded } from '../db/songs';

const DOWNLOAD_DIR = `${RNFS.DocumentDirectoryPath}/beatflow-downloads`;

export function getLocalPath(song: Song): string {
  return `${DOWNLOAD_DIR}/${song.id}.mp3`;
}

export async function ensureDownloadDir(): Promise<void> {
  await RNFS.mkdir(DOWNLOAD_DIR);
}

/**
 * Download a song to local storage (no expiry — plays forever offline).
 * Returns the local file path on success, null on failure.
 */
export async function downloadTrack(
  song: Song,
  onProgress?: (fraction: number) => void,
): Promise<string | null> {
  try {
    await ensureDownloadDir();
    const target = getLocalPath(song);
    if (await RNFS.exists(target)) {
      await markDownloaded(song.id, target);
      return target;
    }

    const download = RNFS.downloadFile({
      fromUrl: getStreamUrl(song.id),
      toFile: target,
      progress: (res) => {
        if (res.contentLength > 0) {
          onProgress?.(res.bytesWritten / res.contentLength);
        }
      },
      progressDivider: 5,
    });

    const result = await download.promise;
    if (result.statusCode >= 200 && result.statusCode < 300) {
      await markDownloaded(song.id, target);
      return target;
    }
    // non-2xx — clean up the partial file
    if (await RNFS.exists(target)) {
      await RNFS.unlink(target);
    }
    return null;
  } catch (e) {
    console.error('downloadTrack error:', e);
    return null;
  }
}

/** Remove a downloaded file and clear its download flag. */
export async function deleteDownload(song: Song): Promise<void> {
  try {
    const target = getLocalPath(song);
    if (await RNFS.exists(target)) {
      await RNFS.unlink(target);
    }
  } catch {
    // best-effort cleanup
  }
  await clearDownload(song.id);
}

export async function hasDownload(song: Song): Promise<boolean> {
  try {
    return await RNFS.exists(getLocalPath(song));
  } catch {
    return false;
  }
}
