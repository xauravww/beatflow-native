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

  // NOTE: no PlaybackError handler here. Skipping on stream failure used to
  // live here (background service context), racing the retry logic in
  // PlayerContext and silently advancing tracks. All error handling now
  // happens in PlayerContext, which retries the same track in place and
  // never auto-advances.
}
