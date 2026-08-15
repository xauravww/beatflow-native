import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LyricLine } from '../../services/lyricsService';

const LINE_HEIGHT = 40;
const ACTIVE_FONT = 20;
const INACTIVE_FONT = 16;

// Spotify lyric colors: inactive lines dim, active line brighter, and within
// it words sweep to full white as they are sung.
const INACTIVE_COLOR = 'rgba(255,255,255,0.35)';
const ACTIVE_UNSUNG_COLOR = 'rgba(255,255,255,0.6)';
const SUNG_COLOR = '#ffffff';

interface WordSpan {
  text: string;
  start: number; // fraction of the line duration (0..1) when this word starts
  end: number;
}

/**
 * Split a lyric line into words with interpolated timing. LRC only gives
 * line-level timestamps, so the line's duration is distributed across words
 * proportional to their character length — the standard karaoke estimate.
 */
function buildLineWords(text: string): WordSpan[] {
  const words = text.split(' ');
  const total = words.reduce((sum, w) => sum + w.length + 1, 0) || 1;
  let acc = 0;
  return words.map((w) => {
    const start = acc / total;
    acc += w.length + 1;
    return { text: w, start, end: acc / total };
  });
}

interface LyricRow {
  time: number;
  text: string;
  words: WordSpan[];
}

export default function LyricsView({
  lines,
  position,
  plain,
  cover,
  duration,
}: {
  lines: LyricLine[];
  position: number;
  plain?: string;
  cover?: string;
  duration?: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [viewportHeight, setViewportHeight] = useState(0);
  const prevIndexRef = useRef(-2);

  // Precompute rows once per lyrics array (word spans are static).
  const syncedRows: LyricRow[] = useMemo(
    () =>
      lines.map((line) => ({
        time: line.time,
        text: line.text,
        words: buildLineWords(line.text),
      })),
    [lines],
  );

  // Plain (unsynced) lyrics: estimate a timestamp per line by spreading the
  // song duration evenly — so they auto-scroll and highlight like Spotify.
  const estimatedRows: LyricRow[] = useMemo(() => {
    if (syncedRows.length > 0 || !plain || !duration || duration <= 0) {
      return [];
    }
    const textLines = plain
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (textLines.length === 0) {
      return [];
    }
    const perLine = duration / textLines.length;
    return textLines.map((text, i) => ({
      time: i * perLine,
      text,
      words: buildLineWords(text),
    }));
  }, [syncedRows.length, plain, duration]);

  const rows = syncedRows.length > 0 ? syncedRows : estimatedRows;

  useEffect(() => {
    let idx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].time <= position) {
        idx = i;
      } else {
        break;
      }
    }
    setActiveIndex(idx);
  }, [position, rows]);

  // Smoothly center the newly-active line — only on line change so manual
  // scrolling is respected between lines.
  useEffect(() => {
    if (
      activeIndex >= 0 &&
      activeIndex !== prevIndexRef.current &&
      viewportHeight > 0
    ) {
      prevIndexRef.current = activeIndex;
      scrollRef.current?.scrollTo({
        y: Math.max(
          0,
          activeIndex * LINE_HEIGHT - (viewportHeight - LINE_HEIGHT) / 2,
        ),
        animated: true,
      });
    }
  }, [activeIndex, viewportHeight]);

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
      >
        <View style={{ height: viewportHeight > 0 ? viewportHeight / 2 : 200 }} />
        {rows.length === 0 ? (
          <Text className="text-white/45 text-center mt-8 text-[15px]">
            No lyrics found for this track
          </Text>
        ) : (
          rows.map((row, i) => {
            const active = i === activeIndex;
            if (!active) {
              return (
                <Text
                  key={i}
                  numberOfLines={1}
                  style={[styles.line, styles.inactiveLine]}
                >
                  {row.text}
                </Text>
              );
            }
            // Progress through the active line (fraction 0..1).
            const lineStart = row.time;
            const lineEnd =
              i + 1 < rows.length ? rows[i + 1].time : lineStart + 4;
            const span = lineEnd - lineStart;
            const fraction =
              span > 0
                ? Math.min(Math.max((position - lineStart) / span, 0), 1)
                : 1;
            return (
              <Text
                key={i}
                numberOfLines={1}
                style={[styles.line, styles.activeLine]}
              >
                {row.words.map((word, wi) => (
                  <Text
                    key={wi}
                    style={{
                      color:
                        fraction >= word.start ? SUNG_COLOR : ACTIVE_UNSUNG_COLOR,
                    }}
                  >
                    {wi > 0 ? ' ' : ''}
                    {word.text}
                  </Text>
                ))}
              </Text>
            );
          })
        )}
        <View style={{ height: viewportHeight > 0 ? viewportHeight / 2 : 200 }} />
      </ScrollView>
      <FadeEdges />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,8,10,0.6)',
  },
  line: {
    height: LINE_HEIGHT,
    lineHeight: LINE_HEIGHT,
    textAlign: 'center',
    paddingHorizontal: 28,
  },
  inactiveLine: {
    fontSize: INACTIVE_FONT,
    color: INACTIVE_COLOR,
  },
  activeLine: {
    fontSize: ACTIVE_FONT,
    fontWeight: '800',
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
