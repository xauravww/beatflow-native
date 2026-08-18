import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
} from 'react-native-track-player';
import { resolveStreamUrl } from '../api/client';
import { Song } from '../api/types';

export async function setupPlayer(): Promise<void> {
  try {
    await TrackPlayer.setupPlayer();
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      progressUpdateEventInterval: 1,
    });
    // React state controls boundaries; this is a safe base mode.
    await TrackPlayer.setRepeatMode(RepeatMode.Off);
  } catch (e) {
    console.log('Error setting up player:', e);
  }
}

/** Convert our Song into a react-native-track-player Track. */
export async function songToTrack(song: Song) {
  return {
    id: song.id,
    url:
      song.isDownloaded && song.localPath
        ? song.localPath
        : await resolveStreamUrl(song.id),
    title: song.title,
    artist: song.artist,
    artwork: song.cover,
    duration: song.duration,
  };
}
