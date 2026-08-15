import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import TrackPlayer, {
  Event,
  RepeatMode,
  State,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';
import { Song } from '../api/types';
import { songToTrack } from '../services/trackPlayerService';
import { addPlayedSeconds, logPlay } from '../db/history';
import { closeFullPlayer, openFullPlayer } from '../navigation/navigationRef';

export type Repeat = 'off' | 'all' | 'one';

interface PlayerContextValue {
  queue: Song[];
  currentIndex: number;
  currentSong: Song | null;
  isPlaying: boolean;
  isBuffering: boolean;
  /** id of the song that was just tapped, before the native player reports a state */
  loadingSongId: string | null;
  repeat: Repeat;
  shuffle: boolean;
  playQueue: (songs: Song[], startIndex?: number) => Promise<void>;
  addToQueue: (song: Song, playNext: boolean) => Promise<void>;
  togglePlay: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  toggleRepeat: () => void;
  toggleShuffle: () => Promise<void>;
  playAt: (index: number) => Promise<void>;
  openPlayer: () => void;
  closePlayer: () => void;
  /**
   * The songs a horizontal swipe would actually land on, matching the real
   * `next`/`previous` behavior (queue edges, repeat mode, restart-when-
   * >3s). Used by the swipe carousels so the preview always matches audio.
   */
  getSwipeTargets: () => { prev: Song | null; next: Song | null };
  /** Transient status message shown as a toast (e.g. "Stream unavailable"). */
  toast: string | null;
  showToast: (message: string) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const REPEAT_ORDER: Repeat[] = ['off', 'all', 'one'];

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const playbackState = usePlaybackState();
  const { state } = playbackState ?? {};
  const { position } = useProgress(500);
  const positionRef = useRef(0);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const [baseQueue, setBaseQueue] = useState<Song[]>([]);
  const [queue, setQueue] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [repeat, setRepeat] = useState<Repeat>('all');
  const [shuffle, setShuffle] = useState(false);
  const [loadingSongId, setLoadingSongId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueRef = useRef<Song[]>([]);
  const repeatRef = useRef<Repeat>('all');
  const shuffleRef = useRef(false);
  const currentIndexRef = useRef(0);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);
  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const isPlaying = state === State.Playing;
  const isBuffering =
    state === State.Buffering || state === State.Loading;

  // Clear the "just tapped play" marker as soon as the native player
  // reports a settled state (playing/ready/error/…). Buffering/Loading keep
  // it alive — they're handled by isBuffering.
  useEffect(() => {
    if (
      state &&
      state !== State.None &&
      state !== State.Loading &&
      state !== State.Buffering
    ) {
      setLoadingSongId(null);
    }
  }, [state]);

  // Keep React state in sync with the player (remote controls, track end).
  useEffect(() => {
    const sub = TrackPlayer.addEventListener(
      Event.PlaybackActiveTrackChanged,
      ({ index }) => {
        if (
          typeof index === 'number' &&
          index >= 0 &&
          index < queueRef.current.length
        ) {
          setCurrentIndex(index);
        }
      },
    );
    return () => sub.remove();
  }, []);

  /** Load tracks into the player in the given order and start at index 0. */
  const loadOrder = useCallback(
    async (ordered: Song[]) => {
      await TrackPlayer.reset();
      await TrackPlayer.add(ordered.map(songToTrack));
      await TrackPlayer.skip(0);
      await TrackPlayer.play();
    },
    [],
  );

  const playQueue = useCallback(
    async (songs: Song[], startIndex = 0) => {
      if (songs.length === 0) {
        return;
      }
      // instant feedback: mark the tapped song as loading right away
      setLoadingSongId(songs[startIndex]?.id ?? null);
      setBaseQueue(songs);
      if (shuffleRef.current) {
        const rest = songs.filter((_, i) => i !== startIndex);
        const ordered = [songs[startIndex], ...shuffleArray(rest)];
        setQueue(ordered);
        await loadOrder(ordered);
      } else {
        setQueue(songs);
        await TrackPlayer.reset();
        await TrackPlayer.add(songs.map(songToTrack));
        await TrackPlayer.skip(startIndex);
        await TrackPlayer.play();
      }
    },
    [loadOrder],
  );

  const playAt = useCallback(
    async (index: number) => {
      if (index < 0 || index >= queueRef.current.length) {
        return;
      }
      setLoadingSongId(queueRef.current[index].id);
      await TrackPlayer.skip(index);
      await TrackPlayer.play();
      setCurrentIndex(index);
    },
    [],
  );

  const togglePlay = useCallback(async () => {
    const s = await TrackPlayer.getPlaybackState();
    if (s.state === State.Playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  }, []);

  const next = useCallback(async () => {
    if (queueRef.current.length === 0) {
      return;
    }
    if (repeatRef.current === 'one') {
      await TrackPlayer.seekTo(0);
      return;
    }
    const isLast = currentIndexRef.current >= queueRef.current.length - 1;
    if (isLast && repeatRef.current === 'off') {
      // stop at the end of the queue
      await TrackPlayer.pause();
      return;
    }
    const target = isLast ? 0 : currentIndexRef.current + 1;
    await TrackPlayer.skip(target);
    await TrackPlayer.play();
    setCurrentIndex(target);
  }, []);

  const previous = useCallback(async () => {
    if (queueRef.current.length === 0) {
      return;
    }
    if (position > 3) {
      await TrackPlayer.seekTo(0);
      return;
    }
    const target =
      currentIndexRef.current === 0 ? 0 : currentIndexRef.current - 1;
    await TrackPlayer.skip(target);
    await TrackPlayer.play();
    setCurrentIndex(target);
  }, [position]);

  const toggleRepeat = useCallback(() => {
    setRepeat((r) => {
      const nextRepeat = REPEAT_ORDER[(REPEAT_ORDER.indexOf(r) + 1) % 3];
      const mode =
        nextRepeat === 'all'
          ? RepeatMode.Queue
          : nextRepeat === 'one'
            ? RepeatMode.Track
            : RepeatMode.Off;
      TrackPlayer.setRepeatMode(mode);
      return nextRepeat;
    });
  }, []);

  const toggleShuffle = useCallback(async () => {
    const willShuffle = !shuffleRef.current;
    setShuffle(willShuffle);
    if (queueRef.current.length === 0) {
      return;
    }
    if (willShuffle) {
      const rest = queueRef.current.filter(
        (_, i) => i !== currentIndexRef.current,
      );
      const ordered = [
        queueRef.current[currentIndexRef.current],
        ...shuffleArray(rest),
      ];
      setQueue(ordered);
      await loadOrder(ordered);
    } else {
      // restore original order, keeping the current song first
      const current = queueRef.current[currentIndexRef.current];
      const rest = baseQueue.filter((s) => s.id !== current.id);
      const ordered = [current, ...rest];
      setQueue(ordered);
      await loadOrder(ordered);
    }
  }, [baseQueue, loadOrder]);

  const openPlayer = useCallback(() => {
    openFullPlayer();
  }, []);
  const closePlayer = useCallback(() => {
    closeFullPlayer();
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // Surface stream failures instead of failing silently — skip the track
  // and tell the user which one couldn't play.
  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackError, () => {
      const skipped = queueRef.current[currentIndexRef.current];
      next();
      showToast(
        `Couldn't play "${skipped?.title ?? 'this song'}" — skipping`,
      );
    });
    return () => sub.remove();
  }, [next, showToast]);

  // Watchdog: if a track is stuck buffering for too long (no error event,
  // e.g. a stalled stream), skip it so playback never hangs silently.
  const isBufferingRef = useRef(false);
  const bufferingSinceRef = useRef<number | null>(null);
  useEffect(() => {
    isBufferingRef.current = isBuffering;
  }, [isBuffering]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isBufferingRef.current) {
        bufferingSinceRef.current = null;
        return;
      }
      if (bufferingSinceRef.current == null) {
        bufferingSinceRef.current = Date.now();
        return;
      }
      if (Date.now() - bufferingSinceRef.current > 15000) {
        bufferingSinceRef.current = Date.now(); // reset so it won't loop
        const stuck = queueRef.current[currentIndexRef.current];
        next();
        showToast(
          `Couldn't play "${stuck?.title ?? 'this song'}" — skipping`,
        );
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [next, showToast]);

  /** Insert a song either right after the current track or at the end of the queue. */
  const addToQueue = useCallback(
    async (song: Song, playNext: boolean) => {
      if (queueRef.current.length === 0) {
        await playQueue([song], 0);
        return;
      }
      const insertIndex = playNext
        ? currentIndexRef.current + 1
        : queueRef.current.length;
      await TrackPlayer.add(songToTrack(song), insertIndex);
      setQueue((prev) => {
        const next = [...prev];
        next.splice(insertIndex, 0, song);
        return next;
      });
      setBaseQueue((prev) => [...prev, song]);
    },
    [playQueue],
  );

  const currentSong = useMemo(
    () => queue[currentIndex] ?? null,
    [queue, currentIndex],
  );

  /**
   * What a swipe would actually reach, mirroring next()/previous():
   *  - next: no neighbor when repeat is 'one' (restarts) or when at the end
   *    with repeat 'off' (pauses); wraps only with repeat 'all'.
   *  - prev: no neighbor at the first track, or when >3s in (restarts).
   */
  const getSwipeTargets = useCallback(() => {
    const q = queueRef.current;
    const i = currentIndexRef.current;
    const rep = repeatRef.current;
    const pos = positionRef.current;
    if (q.length === 0) {
      return { prev: null, next: null };
    }
    let next: Song | null = null;
    if (rep !== 'one') {
      if (i < q.length - 1) {
        next = q[i + 1];
      } else if (rep === 'all') {
        next = q[0];
      }
    }
    let prev: Song | null = null;
    if (pos <= 3 && i > 0) {
      prev = q[i - 1];
    }
    return { prev, next };
  }, []);

  // --- Real listening-time tracking --------------------------------------
  // Accumulate actual seconds played (position deltas while playing) and
  // write them to the active history row. Skipping a track 10s in counts
  // as 10s listened, not the full song duration.
  const lastPositionRef = useRef(0);
  const playedAccumRef = useRef(0);
  const activeRowIdRef = useRef<number | null>(null);

  useEffect(() => {
    const delta = position - lastPositionRef.current;
    lastPositionRef.current = position;
    // only count forward progress while actually playing; ignore seeks
    if (state === State.Playing && delta > 0 && delta < 10) {
      playedAccumRef.current += delta;
    }
  }, [position, state]);

  const flushPlayedSeconds = useCallback(() => {
    const rowId = activeRowIdRef.current;
    if (rowId != null && playedAccumRef.current >= 1) {
      addPlayedSeconds(rowId, playedAccumRef.current).catch(() => {});
    }
    playedAccumRef.current = 0;
  }, []);

  // Log every track that becomes active (flush the previous song's seconds first).
  useEffect(() => {
    flushPlayedSeconds();
    if (currentSong) {
      logPlay(currentSong)
        .then((rowId) => {
          activeRowIdRef.current = rowId;
        })
        .catch(() => {});
    } else {
      activeRowIdRef.current = null;
    }
  }, [currentSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush periodically (survives app kills) and whenever playback pauses.
  useEffect(() => {
    const interval = setInterval(flushPlayedSeconds, 15000);
    return () => clearInterval(interval);
  }, [flushPlayedSeconds]);

  useEffect(() => {
    if (state !== State.Playing) {
      flushPlayedSeconds();
    }
  }, [state, flushPlayedSeconds]);

  const value: PlayerContextValue = useMemo(
    () => ({
      queue,
      currentIndex,
      currentSong,
      isPlaying,
      isBuffering,
      loadingSongId,
      repeat,
      shuffle,
      playQueue,
      addToQueue,
      togglePlay,
      next,
      previous,
      toggleRepeat,
      toggleShuffle,
      playAt,
      openPlayer,
      closePlayer,
      getSwipeTargets,
      toast,
      showToast,
    }),
    [
      queue,
      currentIndex,
      currentSong,
      isPlaying,
      isBuffering,
      loadingSongId,
      toast,
      showToast,
      repeat,
      shuffle,
      playQueue,
      addToQueue,
      togglePlay,
      next,
      previous,
      toggleRepeat,
      toggleShuffle,
      playAt,
      openPlayer,
      closePlayer,
      getSwipeTargets,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayer must be used within PlayerProvider');
  }
  return ctx;
}
