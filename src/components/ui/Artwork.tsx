import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

/**
 * Network artwork that swaps instantly when the song changes.
 *
 * React Native's Image keeps showing the previous bitmap while a new uri
 * loads — that's what made the now-playing card flash the *previous* song's
 * cover (new title + old image) when skipping tracks. This component keys the
 * native Image by songId so the old bitmap is dropped immediately.
 *
 * Two things make the swap feel instant instead of "title updates, image
 * lags":
 *
 *  - `fadeDuration={0}` — Android fades every network image in over 300ms by
 *    default, which reads as the cover arriving late.
 *  - a module-level set of uris already decoded once (or prefetched via
 *    {@link prefetchArtwork}). A known uri starts in the loaded state, so no
 *    spinner frame is rendered at all — the bitmap comes straight from the
 *    image cache.
 */

/** uris that have been decoded or prefetched at least once this app run. */
const warmed = new Set<string>();

/**
 * Warm the image cache for covers the user is about to see (the neighbouring
 * queue tracks). Fire-and-forget: failures are irrelevant, the Image will just
 * load normally.
 */
export function prefetchArtwork(uris: (string | undefined | null)[]) {
  for (const uri of uris) {
    if (!uri || warmed.has(uri)) {
      continue;
    }
    // mark first so parallel callers don't double-fetch
    warmed.add(uri);
    Image.prefetch(uri).catch(() => {
      warmed.delete(uri);
    });
  }
}

export default function Artwork({
  songId,
  uri,
  className,
  spinnerSize = 'small',
  spinnerColor = 'rgba(255,255,255,0.45)',
}: {
  songId: string;
  uri: string;
  /** Sizing/shape classes for the wrapper (e.g. "w-11 h-11 rounded"). */
  className?: string;
  spinnerSize?: number | 'small' | 'large';
  spinnerColor?: string;
}) {
  const [loaded, setLoaded] = useState(() => warmed.has(uri));
  // Reset the loading state when the song changes (derived-state pattern).
  const [prevSongId, setPrevSongId] = useState(songId);
  if (prevSongId !== songId) {
    setPrevSongId(songId);
    setLoaded(warmed.has(uri));
  }
  return (
    <View className={className} style={styles.wrapper}>
      {!loaded && (
        <View style={StyleSheet.absoluteFill} className="items-center justify-center">
          <ActivityIndicator size={spinnerSize} color={spinnerColor} />
        </View>
      )}
      <Image
        key={songId}
        source={{ uri }}
        onLoad={() => {
          warmed.add(uri);
          setLoaded(true);
        }}
        onError={() => setLoaded(true)} // stop the spinner on dead URLs
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        fadeDuration={0}
        progressiveRenderingEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
});
