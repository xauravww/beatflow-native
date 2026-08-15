import TrackPlayer, { Event } from 'react-native-track-player';

export async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () =>
    TrackPlayer.skipToNext(),
  );
  TrackPlayer.addEventListener(Event.RemotePrevious, () =>
    TrackPlayer.skipToPrevious(),
  );
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.reset());
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) =>
    TrackPlayer.seekTo(position),
  );

  // If a stream fails (common with unofficial YouTube streams), skip to the
  // next track instead of stalling — only when there is a next track, to
  // avoid endless loops on the last one.
  TrackPlayer.addEventListener(Event.PlaybackError, async () => {
    try {
      const index = await TrackPlayer.getActiveTrackIndex();
      const queue = await TrackPlayer.getQueue();
      if (index != null && index < queue.length - 1) {
        await TrackPlayer.skip(index + 1);
      } else {
        await TrackPlayer.pause();
      }
    } catch (e) {
      console.log('PlaybackError handler failed:', e);
    }
  });
}
