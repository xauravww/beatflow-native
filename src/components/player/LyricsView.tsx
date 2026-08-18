import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import TrackPlayer, { useProgress } from 'react-native-track-player';
import Icon from 'react-native-vector-icons/Ionicons';
import { isSyncUsable, LyricsResult } from '../../services/lyricsService';

/**
 * Spotify's lyric sheet: one type size for every line, left aligned, heavy
 * weight. Only colour separates the line being sung from the rest — no size
 * jump, because a growing line shoves the whole sheet around.
 */
const FONT_SIZE = 25;
const LINE_HEIGHT = 32;
const LINE_SPACING = 13;

const IDLE_COLOR = 'rgba(255,255,255,0.45)';
const ACTIVE_COLOR = '#ffffff';

interface Row {
  /** Timestamp in seconds, or -1 for unsynced text. */
  time: number;
  text: string;
}

/**
 * Why the sheet isn't scrolling itself, in the user's terms:
 *  - `live`       timestamps fit the audio; highlight and auto-scroll run
 *  - `unsynced`   plain lyrics only — LRCLIB has no timed version
 *  - `mismatched` timed lyrics, but for another edit of the song
 *  - `pending`    the player hasn't reported a duration yet
 *
 * `pending` exists so a genuinely synced track doesn't flash "not synced" in
 * the moment before its duration lands — there's nothing to tell the user yet.
 */
type SyncState = 'live' | 'pending' | 'unsynced' | 'mismatched';

export default function LyricsView({
  lyrics,
  cover,
}: {
  lyrics: LyricsResult | null;
  cover?: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  /** Content-relative y offset and height of every rendered line. */
  const layoutsRef = useRef<{ y: number; h: number }[]>([]);
  const lastScrolledRef = useRef(-1);
  const userScrollUntilRef = useRef(0);

  // Poll fast enough to look live while the highlight is actually running;
  // idle down to a crawl when there's nothing to animate.
  const [syncOn, setSyncOn] = useState(false);
  const { position, duration } = useProgress(syncOn ? 250 : 2000);

  /**
   * Auto-highlight and auto-scroll only run on timestamps that genuinely
   * belong to this recording. Everything else — plain lyrics, or a synced
   * version whose runtime doesn't match the audio — is rendered as a still,
   * scrollable sheet. A highlight that drifts is worse than none.
   */
  const canSync = useMemo(
    () => isSyncUsable(lyrics, duration),
    [lyrics, duration],
  );
  useEffect(() => {
    setSyncOn(canSync);
  }, [canSync]);

  const rows: Row[] = useMemo(() => {
    if (lyrics?.synced?.length) {
      return lyrics.synced.map((l) => ({ time: l.time, text: l.text }));
    }
    const plain = lyrics?.plain ?? '';
    return plain
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text) => ({ time: -1, text }));
  }, [lyrics]);

  useEffect(() => {
    // reset measurements when the lyric sheet itself changes
    layoutsRef.current = [];
    lastScrolledRef.current = -1;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [rows]);

  const activeIndex = useMemo(() => {
    if (!canSync) {
      return -1;
    }
    let idx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].time <= position) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [canSync, rows, position]);

  // Centre the newly-active line. Only fires on a line change, and yields to
  // the user for a few seconds after they scroll by hand.
  useEffect(() => {
    if (!canSync || activeIndex < 0 || viewportHeight <= 0) {
      return;
    }
    if (activeIndex === lastScrolledRef.current) {
      return;
    }
    if (Date.now() < userScrollUntilRef.current) {
      return;
    }
    const layout = layoutsRef.current[activeIndex];
    if (!layout) {
      return;
    }
    lastScrolledRef.current = activeIndex;
    scrollRef.current?.scrollTo({
      y: Math.max(0, layout.y - (viewportHeight - layout.h) / 2),
      animated: true,
    });
  }, [activeIndex, canSync, viewportHeight]);

  const seekToLine = (row: Row) => {
    if (!canSync || row.time < 0) {
      return;
    }
    TrackPlayer.seekTo(row.time);
  };

  const spacer = viewportHeight > 0 ? viewportHeight * 0.42 : 200;
  // Two timestamps is the minimum that can drive a highlight, and matches what
  // isSyncUsable() accepts — a single stray "[00:00]" line isn't a synced sheet.
  const hasTimestamps = (lyrics?.synced?.length ?? 0) > 1;
  const syncState: SyncState = canSync
    ? 'live'
    : !hasTimestamps
      ? 'unsynced'
      : duration > 0
        ? 'mismatched'
        : 'pending';

  return (
    <View
      className="flex-1 overflow-hidden"
      onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
    >
      {/* Spotify-style blurred album-art background */}
      {cover ? (
        <Image
          source={{ uri: cover }}
          blurRadius={50}
          resizeMode="cover"
          style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.3 }] }]}
        />
      ) : null}
      <View style={styles.overlay} />

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          // hand control back to the user for a moment after a manual scroll
          userScrollUntilRef.current = Date.now() + 6000;
        }}
      >
        {rows.length === 0 ? (
          <Text className="text-white/45 text-center mt-10 text-[15px]">
            No lyrics found for this track
          </Text>
        ) : (
          <>
            {(syncState === 'unsynced' || syncState === 'mismatched') && (
              <View className="items-start px-6" style={{ marginTop: 18 }}>
                <View className="flex-row items-center bg-white/10 rounded-full pl-2.5 pr-3 py-1.5">
                  <Icon
                    name={
                      syncState === 'unsynced' ? 'text-outline' : 'time-outline'
                    }
                    size={12}
                    color="rgba(255,255,255,0.7)"
                  />
                  <Text className="text-white/70 text-[11px] font-semibold ml-1.5">
                    {syncState === 'unsynced'
                      ? 'Lyrics not synced — scroll to follow'
                      : 'Timing doesn’t match this version'}
                  </Text>
                </View>
              </View>
            )}
            <View style={{ height: canSync ? spacer : 24 }} />
            {rows.map((row, i) => (
              <LyricRow
                key={`${i}-${row.text}`}
                text={row.text}
                active={i === activeIndex}
                dim={canSync && activeIndex >= 0 && i < activeIndex}
                seekable={canSync && row.time >= 0}
                onPress={() => seekToLine(row)}
                onMeasure={(y, h) => {
                  layoutsRef.current[i] = { y, h };
                }}
              />
            ))}
            <View style={{ height: canSync ? spacer : 48 }} />
          </>
        )}
      </ScrollView>
      <FadeEdges />
    </View>
  );
}

/**
 * One lyric line. Memoized because the sheet re-renders on every progress
 * tick — only the two lines whose state flipped should actually re-render.
 */
const LyricRow = React.memo(
  function LyricRowInner({
    text,
    active,
    dim,
    seekable,
    onPress,
    onMeasure,
  }: {
    text: string;
    active: boolean;
    /** Already sung — slightly further back than upcoming lines. */
    dim: boolean;
    seekable: boolean;
    onPress: () => void;
    onMeasure: (y: number, h: number) => void;
  }) {
    return (
      <Pressable
        onPress={seekable ? onPress : undefined}
        onLayout={(e) =>
          onMeasure(e.nativeEvent.layout.y, e.nativeEvent.layout.height)
        }
      >
        <Text
          style={[
            styles.line,
            active
              ? styles.activeLine
              : dim
                ? styles.sungLine
                : styles.idleLine,
          ]}
        >
          {text}
        </Text>
      </Pressable>
    );
  },
  (a, b) =>
    a.text === b.text &&
    a.active === b.active &&
    a.dim === b.dim &&
    a.seekable === b.seekable,
);

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,8,10,0.62)',
  },
  line: {
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    fontWeight: '800',
    textAlign: 'left',
    paddingHorizontal: 24,
    marginBottom: LINE_SPACING,
  },
  idleLine: {
    color: IDLE_COLOR,
  },
  sungLine: {
    color: 'rgba(255,255,255,0.32)',
  },
  activeLine: {
    color: ACTIVE_COLOR,
  },
});

/** Soft fade at the top/bottom edges so lines melt in/out like Spotify. */
function FadeEdges() {
  const strips = [0.6, 0.45, 0.32, 0.2, 0.12, 0.06, 0.03];
  return (
    <>
      {strips.map((op, i) => (
        <View
          key={`top-${i}`}
          pointerEvents="none"
          className="absolute left-0 right-0"
          style={{
            top: i * 7,
            height: 7,
            backgroundColor: '#000000',
            opacity: op,
          }}
        />
      ))}
      {strips.map((op, i) => (
        <View
          key={`bottom-${i}`}
          pointerEvents="none"
          className="absolute left-0 right-0"
          style={{
            bottom: i * 7,
            height: 7,
            backgroundColor: '#000000',
            opacity: op,
          }}
        />
      ))}
    </>
  );
}
