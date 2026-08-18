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
import { prefetchArtwork } from '../components/ui/Artwork';
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
  /** Always moves to the next queue track (never restarts, unlike `next`). */
  skipNext: () => Promise<void>;
  /** Always moves to the previous queue track (never restarts). */
  skipPrevious: () => Promise<void>;
  toggleRepeat: () => void;
  toggleShuffle: () => Promise<void>;
  playAt: (index: number) => Promise<void>;
  openPlayer: () => void;
  closePlayer: () => void;
  /** Tell the player the user just seeked — resets the stall watchdog. */
  markSeek: () => void;
  /**
   * The neighbouring queue tracks a horizontal swipe lands on, matching
   * `skipNext`/`skipPrevious`. A swipe is a track change, so unlike the
   * transport buttons it ignores repeat-one and the restart-when->3s rule —
   * only real queue edges produce a null.
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
      await TrackPlayer.add(await Promise.all(ordered.map(songToTrack)));
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
        await TrackPlayer.add(await Promise.all(songs.map(songToTrack)));
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
    // positionRef, not the position state: a dep on position would rebuild this
    // callback (and with it the whole context value) twice a second, which
    // re-renders every consumer in the app.
    if (positionRef.current > 3) {
      await TrackPlayer.seekTo(0);
      return;
    }
    const target =
      currentIndexRef.current === 0 ? 0 : currentIndexRef.current - 1;
    await TrackPlayer.skip(target);
    await TrackPlayer.play();
    setCurrentIndex(target);
  }, []);

  /** Move to a queue index, with instant loading feedback. */
  const skipTo = useCallback(async (target: number) => {
    const q = queueRef.current;
    if (target < 0 || target >= q.length) {
      return;
    }
    setLoadingSongId(q[target].id);
    await TrackPlayer.skip(target);
    await TrackPlayer.play();
    setCurrentIndex(target);
  }, []);

  /**
   * Swipe/carousel "next": always a real track change. Unlike `next` it
   * ignores repeat-one (which restarts the track) — a swipe should never
   * leave the user on the same song.
   */
  const skipNext = useCallback(async () => {
    const q = queueRef.current;
    if (q.length === 0) {
      return;
    }
    const i = currentIndexRef.current;
    if (i < q.length - 1) {
      await skipTo(i + 1);
    } else if (repeatRef.current === 'all') {
      await skipTo(0);
    }
  }, [skipTo]);

  /** Swipe/carousel "previous": always a real track change (never restarts). */
  const skipPrevious = useCallback(async () => {
    if (currentIndexRef.current > 0) {
      await skipTo(currentIndexRef.current - 1);
    }
  }, [skipTo]);

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

  // --- Retry in place — never auto-skip -------------------------------
  // A failing or stalled track is retried with a freshly resolved URL while
  // preserving the seek position. The user always stays on the same song;
  // if it keeps failing we stop retrying and let them tap play/skip
  // manually — the app never advances tracks on its own.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const retryForRef = useRef<string | null>(null);
  const lastErrorAtRef = useRef(0);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const cancelRetry = useCallback(() => {
    clearRetryTimer();
    retryForRef.current = null;
    retryCountRef.current = 0;
  }, [clearRetryTimer]);

  /** Re-resolve the current track's URL and reload it, keeping the position. */
  const retryCurrentTrack = useCallback(async () => {
    const failed = queueRef.current[currentIndexRef.current];
    if (!failed) {
      return;
    }
    const at = positionRef.current;
    try {
      const track = await songToTrack(failed);
      await TrackPlayer.load(track);
      // restore the position so a failed seek/stream doesn't jump the user back
      if (at > 1) {
        try {
          await TrackPlayer.seekTo(at);
        } catch {
          // position restore is best-effort
        }
      }
      await TrackPlayer.play();
      console.log('retried stream for', failed.id, 'at', at);
    } catch (e) {
      console.warn('stream retry failed for', failed.id, e);
    }
  }, []);

  /** Back off and retry the current track (bounded, then hands off to the user). */
  const scheduleRetry = useCallback(
    (failed: Song) => {
      if (retryForRef.current !== failed.id) {
        retryForRef.current = failed.id;
        retryCountRef.current = 0;
      }
      retryCountRef.current += 1;
      lastErrorAtRef.current = Date.now();
      if (retryCountRef.current > 5) {
        cancelRetry();
        showToast(
          `Can't play "${failed.title ?? 'this song'}" right now — tap play to retry`,
        );
        return;
      }
      const delay = Math.min(
        2000 * Math.pow(2, retryCountRef.current - 1),
        15000,
      );
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        retryCurrentTrack();
      }, delay);
    },
    [cancelRetry, clearRetryTimer, retryCurrentTrack, showToast],
  );

  // On any playback error: retry the same track, never skip.
  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackError, () => {
      const failed = queueRef.current[currentIndexRef.current];
      if (failed) {
        scheduleRetry(failed);
      }
    });
    return () => {
      sub.remove();
      clearRetryTimer();
    };
  }, [scheduleRetry, clearRetryTimer]);

  // Reset the retry budget whenever the active track changes (manual skip,
  // auto-advance, new queue…).
  useEffect(() => {
    cancelRetry();
  }, [currentIndex, cancelRetry]);

  // Watchdog: if a track is stuck buffering for too long (no error event,
  // e.g. a stalled stream), retry it in place instead of skipping.
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
      if (Date.now() - bufferingSinceRef.current > 25000) {
        bufferingSinceRef.current = Date.now(); // reset so it won't loop
        const stuck = queueRef.current[currentIndexRef.current];
        if (stuck) {
          scheduleRetry(stuck);
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [scheduleRetry]);

  // A seek legitimately causes a re-buffer — don't count that as a stall.
  const markSeek = useCallback(() => {
    bufferingSinceRef.current = null;
  }, []);

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
      await TrackPlayer.add(await songToTrack(song), insertIndex);
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
   * The neighbouring tracks a swipe reaches, mirroring skipNext()/
   * skipPrevious(): the real adjacent queue entries, wrapping forward only
   * with repeat 'all'. Repeat-one and the >3s restart rule deliberately do
   * NOT apply here — a swipe is always a track change, so the cover that
   * peeks in while dragging is always the one that will play.
   *
   * Reads state (not refs) on purpose: the carousels call this during render,
   * and refs are only synced in an effect — so refs would hand back the
   * *previous* track's neighbours for one commit after every skip.
   */
  const getSwipeTargets = useCallback(() => {
    if (queue.length === 0) {
      return { prev: null, next: null };
    }
    let nextSong: Song | null = null;
    if (currentIndex < queue.length - 1) {
      nextSong = queue[currentIndex + 1];
    } else if (repeat === 'all') {
      nextSong = queue[0];
    }
    const prevSong: Song | null =
      currentIndex > 0 ? queue[currentIndex - 1] : null;
    return { prev: prevSong, next: nextSong };
  }, [queue, currentIndex, repeat]);

  // Warm the image cache for the covers a swipe/skip is about to show, so the
  // artwork swaps at the same instant as the title instead of decoding after.
  useEffect(() => {
    prefetchArtwork([
      queue[currentIndex - 1]?.cover,
      queue[currentIndex + 1]?.cover,
      queue[currentIndex + 2]?.cover,
    ]);
  }, [queue, currentIndex]);

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
      // a song playing cleanly for a while gets a fresh retry budget
      if (
        retryCountRef.current > 0 &&
        Date.now() - lastErrorAtRef.current > 45000
      ) {
        retryForRef.current = null;
        retryCountRef.current = 0;
      }
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
      skipNext,
      skipPrevious,
      toggleRepeat,
      toggleShuffle,
      playAt,
      openPlayer,
      closePlayer,
      markSeek,
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
      skipNext,
      skipPrevious,
      toggleRepeat,
      toggleShuffle,
      playAt,
      openPlayer,
      closePlayer,
      markSeek,
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
