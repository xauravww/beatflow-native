import { useEffect, useRef } from 'react';
import { Animated, PanResponder } from 'react-native';
import type { GestureResponderHandlers, LayoutChangeEvent } from 'react-native';
import { Song } from '../api/types';

/** Horizontal swipe distance (fraction of width) that changes the track. */
const SWIPE_THRESHOLD = 0.25;
/** Vertical drag distance (px) that triggers the Spotify-style pull-up. */
const PULL_UP_THRESHOLD = 80;
/** Minimum gesture distance before the responder claims the touch. */
const ACTIVATION_DISTANCE = 10;
/** Gap between carousel items (px). */
const ITEM_GAP = 10;
/** Give up waiting for the track swap and snap back after this long. */
const SETTLE_TIMEOUT = 900;

interface UseSwipeCarouselOptions {
  next: () => void | Promise<void>;
  previous: () => void | Promise<void>;
  /** Called when the user drags up past the threshold (opens the full player). */
  onPullUp?: () => void;
  /** When false the responder never claims gestures. */
  enabled?: boolean;
  /**
   * The songs a swipe would actually land on (from the player context).
   * The carousel only scrolls when the target is a real, different track —
   * so the preview always matches what will actually play.
   */
  getSwipeTargets: () => { prev: Song | null; next: Song | null };
  /** id of the currently playing track (same-song targets are ignored). */
  currentSongId: string | null;
}

/**
 * Spotify-style track carousel: render prev/current/next side by side and
 * translate the row with the finger — the neighbor cover peeks in while you
 * drag. Releasing past a threshold scrolls to the neighbor and swaps the
 * track; otherwise it springs back. Optional vertical pull-up (mini player).
 *
 * Layout contract for callers: render the items in prev/current/next order
 * inside an `overflow: hidden` box one item wide, and shift the row by
 * [rowOffset] (as `marginLeft`) so the *current* item — not `prevSong` — is
 * the one in the visible slot.
 */
export function useSwipeCarousel({
  next,
  previous,
  onPullUp,
  enabled = true,
  getSwipeTargets,
  currentSongId,
}: UseSwipeCarouselOptions): {
  panHandlers: GestureResponderHandlers;
  translateX: Animated.Value;
  translateY: Animated.Value;
  onLayout: (e: LayoutChangeEvent) => void;
  /** Neighbor tracks to render (null when a swipe wouldn't reach one). */
  prevSong: Song | null;
  nextSong: Song | null;
  /**
   * Static left shift for the item row (px, negative or 0). Apply as
   * `marginLeft` so the current item sits in the visible slot even when a
   * `prevSong` card is rendered before it.
   */
  rowOffset: (itemWidth: number) => number;
} {
  const widthRef = useRef(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const slidingRef = useRef(false);
  const axisRef = useRef<'x' | 'y' | null>(null);
  /** true between "animation finished" and "the track actually changed". */
  const awaitingSwapRef = useRef(false);
  const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callbacks are recreated by the context, so read the freshest via ref.
  const optsRef = useRef({
    next,
    previous,
    onPullUp,
    enabled,
    getSwipeTargets,
    currentSongId,
  });
  optsRef.current = {
    next,
    previous,
    onPullUp,
    enabled,
    getSwipeTargets,
    currentSongId,
  };

  /**
   * Land the carousel once the new track is actually current. The row is left
   * parked at the settled offset until then: the neighbor card the user
   * dragged in becomes the current card in the same commit that resets the
   * offset, so nothing ever flashes back to the old track.
   */
  const finishSwap = () => {
    if (swapTimerRef.current) {
      clearTimeout(swapTimerRef.current);
      swapTimerRef.current = null;
    }
    awaitingSwapRef.current = false;
    translateX.setValue(0);
    slidingRef.current = false;
  };

  useEffect(() => {
    if (awaitingSwapRef.current) {
      finishSwap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSongId]);

  useEffect(
    () => () => {
      if (swapTimerRef.current) {
        clearTimeout(swapTimerRef.current);
      }
    },
    [],
  );

  const springBack = () => {
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 20,
        bounciness: 10,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        speed: 20,
        bounciness: 10,
      }),
    ]).start(() => {
      slidingRef.current = false;
    });
  };

  /**
   * Scroll the carousel by one item. dir = 1 → next (slide left),
   * dir = -1 → previous (slide right). The track swap is requested once the
   * neighbor is centered; the row stays parked there until the swap lands
   * (see finishSwap), which keeps the transition seamless.
   */
  const settle = (dir: 1 | -1) => {
    const step = widthRef.current + ITEM_GAP;
    slidingRef.current = true;
    Animated.timing(translateX, {
      toValue: dir * -step,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        translateX.setValue(0);
        slidingRef.current = false;
        return;
      }
      awaitingSwapRef.current = true;
      // Safety net: if the player never reports a new track (skip failed),
      // snap back instead of leaving the row parked off-screen.
      swapTimerRef.current = setTimeout(finishSwap, SETTLE_TIMEOUT);
      if (dir === 1) {
        optsRef.current.next();
      } else {
        optsRef.current.previous();
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      // claim horizontal drags, vertical-up drags (pull-up), never taps
      onMoveShouldSetPanResponder: (_, g) => {
        const opts = optsRef.current;
        if (!opts.enabled || slidingRef.current) {
          return false;
        }
        const dx = Math.abs(g.dx);
        const dy = Math.abs(g.dy);
        if (dx > ACTIVATION_DISTANCE && dx > dy * 1.5) {
          return true;
        }
        if (
          dy > ACTIVATION_DISTANCE &&
          dy > dx * 1.5 &&
          g.dy < 0 &&
          opts.onPullUp
        ) {
          return true;
        }
        return false;
      },
      onPanResponderGrant: (_, g) => {
        axisRef.current = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';
      },
      onPanResponderMove: (_, g) => {
        const axis =
          axisRef.current ?? (Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y');
        if (axis === 'x') {
          const maxDrag = (widthRef.current || 360) * 1.2;
          translateX.setValue(Math.max(-maxDrag, Math.min(maxDrag, g.dx)));
        } else {
          // only follow upward drags (pull-up)
          const maxDrag = (widthRef.current || 600) * 0.9;
          translateY.setValue(Math.max(-maxDrag, Math.min(0, g.dy)));
        }
      },
      onPanResponderRelease: (_, g) => {
        const opts = optsRef.current;
        const axis = axisRef.current;
        if (axis === 'y' && opts.onPullUp) {
          if (g.dy < -PULL_UP_THRESHOLD) {
            // navigate to the full player — its slide-from-bottom animation
            // covers the mini player, giving the pull-up effect
            opts.onPullUp();
          }
          springBack();
        } else {
          const targets = opts.getSwipeTargets();
          const w = widthRef.current || 360;
          const threshold = Math.max(w * SWIPE_THRESHOLD, 70);
          if (g.dx < -threshold) {
            // swipe left → next (only when a real next track exists)
            if (targets.next && targets.next.id !== opts.currentSongId) {
              settle(1);
            } else {
              springBack();
            }
          } else if (g.dx > threshold) {
            // swipe right → previous (only when a real prev track exists)
            if (targets.prev && targets.prev.id !== opts.currentSongId) {
              settle(-1);
            } else {
              springBack();
            }
          } else {
            springBack();
          }
        }
      },
      onPanResponderTerminate: () => {
        springBack();
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
  };

  // neighbors to render — same-song targets (restart/no-change) are hidden
  const targets = optsRef.current.getSwipeTargets();
  const currentId = optsRef.current.currentSongId;
  const prevSong =
    targets.prev && targets.prev.id !== currentId ? targets.prev : null;
  const nextSong =
    targets.next && targets.next.id !== currentId ? targets.next : null;

  return {
    panHandlers: panResponder.panHandlers,
    translateX,
    translateY,
    onLayout,
    prevSong,
    nextSong,
    // A rendered prev card takes the first slot, so shift the row one item
    // left to bring the current card back into view.
    rowOffset: (itemWidth: number) =>
      prevSong ? -(itemWidth + ITEM_GAP) : 0,
  };
}
