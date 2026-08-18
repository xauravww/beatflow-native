/**
 * How well a result's text answers what the user typed.
 *
 * Search used to render in a fixed order — every song, then playlists, then
 * artists — so searching an artist's name buried the artist below two dozen
 * tracks. Scoring each result lets the best match lead instead, which is what
 * makes Spotify's search feel like it understood the query.
 *
 * Hermes-safe: no `normalize()`, no `matchAll`.
 */

/** Lowercase, punctuation flattened to single spaces. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/gi, ' ')
    .trim();
}

function tokens(text: string): string[] {
  const t = normalize(text);
  return t ? t.split(' ') : [];
}

/**
 * 0 (no relation) … 1 (exact). Graded so the tiers can't overlap:
 *   1.00  the same string
 *   0.85  starts with the query ("arijit singh" → "Arijit Singh Hits")
 *   0.80  the query appears whole, somewhere inside
 *   ≤0.65 every query word appears, scored by how much of the text is query
 *   ≤0.35 only some words appear
 */
export function matchScore(query: string, text: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (!q || !t) {
    return 0;
  }
  if (q === t) {
    return 1;
  }
  if (t.startsWith(q)) {
    return 0.85;
  }
  if (t.indexOf(q) !== -1) {
    return 0.8;
  }

  const qWords = tokens(query);
  const tWords = tokens(text);
  if (qWords.length === 0) {
    return 0;
  }
  const hits = qWords.filter((w) =>
    tWords.some((tw) => tw === w || (w.length > 3 && tw.startsWith(w))),
  ).length;
  if (hits === 0) {
    return 0;
  }
  const coverage = hits / qWords.length;
  // A short result made mostly of the query words beats a long one that merely
  // contains them ("Lofi" over "Lofi hip hop radio beats to relax/study to").
  const density = qWords.length / Math.max(tWords.length, qWords.length);
  return coverage === 1 ? 0.45 + 0.2 * density : 0.35 * coverage;
}

/** Best score across several fields (title, artist, owner…). */
export function bestScore(query: string, ...fields: (string | undefined)[]): number {
  let best = 0;
  for (const f of fields) {
    if (!f) {
      continue;
    }
    const s = matchScore(query, f);
    if (s > best) {
      best = s;
    }
  }
  return best;
}
