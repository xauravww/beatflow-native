/**
 * YouTube Music's own browse API (InnerTube `WEB_REMIX`), called straight from
 * the device — no backend, no third-party geo-IP service.
 *
 * This is what makes the home feed real. `FEmusic_home` is geolocated by the
 * request IP by YouTube itself, so shelves come back already localized
 * ("India's biggest hits", "Punjabi Hits", …) and the country code arrives in
 * the page config as `GL`. The old feed instead asked ipapi.co for a country
 * name and then ran three plain *text searches* ("Top hits India") — ipapi
 * rate-limits to a few hundred calls a day and answers 429/HTML once tripped,
 * which collapsed the whole feed to "Top hits Global".
 *
 * Everything here is Hermes-safe: plain JS, no Node builtins, no `matchAll`.
 */
import { Shelf, ShelfItem, Song } from './types';
import { bestScore } from '../utils/relevance';

const MUSIC_ORIGIN = 'https://music.youtube.com';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Page config scraped from music.youtube.com — the InnerTube credentials. */
interface YtConfig {
  apiKey: string;
  clientName: string;
  clientVersion: string;
  clientId: string;
  visitorData: string;
  /** Two-letter country YouTube resolved from our IP, e.g. "IN". */
  gl: string;
  hl: string;
  fetchedAt: number;
}

let config: YtConfig | null = null;
let configPromise: Promise<YtConfig | null> | null = null;
const CONFIG_TTL_MS = 6 * 60 * 60 * 1000;

/** fetch with a timeout — a hung request must never wedge the home feed. */
async function timedFetch(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scrape the `ytcfg.set({...})` blobs off the music.youtube.com shell.
 * They carry the InnerTube API key, client version, visitor id, and — the
 * useful part — the country YouTube geolocated us to.
 */
async function loadConfig(): Promise<YtConfig | null> {
  try {
    const res = await timedFetch(
      `${MUSIC_ORIGIN}/`,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      12000,
    );
    if (!res.ok) {
      console.warn('ytmusic config fetch failed:', res.status);
      return null;
    }
    const html = await res.text();
    const merged: Record<string, any> = {};
    // Several ytcfg.set() calls, each a JSON object; merge them all.
    const re = /ytcfg\.set\((\{.*?\})\);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        Object.assign(merged, JSON.parse(m[1]));
      } catch {
        // one malformed blob shouldn't lose the rest
      }
    }
    if (!merged.INNERTUBE_API_KEY) {
      console.warn('ytmusic config: no INNERTUBE_API_KEY in page');
      return null;
    }
    return {
      apiKey: merged.INNERTUBE_API_KEY,
      clientName: merged.INNERTUBE_CLIENT_NAME || 'WEB_REMIX',
      clientVersion: merged.INNERTUBE_CLIENT_VERSION || '1.20240101.01.00',
      clientId: String(merged.INNERTUBE_CONTEXT_CLIENT_NAME ?? 67),
      visitorData: merged.VISITOR_DATA || '',
      gl: merged.GL || '',
      hl: merged.HL || 'en',
      fetchedAt: Date.now(),
    };
  } catch (e) {
    console.warn('ytmusic config error:', e);
    return null;
  }
}

/** Cached config, refreshed every few hours. Concurrent callers share one fetch. */
async function ensureConfig(): Promise<YtConfig | null> {
  if (config && Date.now() - config.fetchedAt < CONFIG_TTL_MS) {
    return config;
  }
  if (!configPromise) {
    configPromise = loadConfig().then((c) => {
      configPromise = null;
      if (c) {
        config = c;
      }
      return c;
    });
  }
  return configPromise;
}

/** POST to an InnerTube endpoint ("browse", "search"). Null on any failure. */
async function innertube(
  endpoint: 'browse' | 'search',
  payload: Record<string, unknown>,
): Promise<any | null> {
  const cfg = await ensureConfig();
  if (!cfg) {
    return null;
  }
  try {
    const res = await timedFetch(
      `${MUSIC_ORIGIN}/youtubei/v1/${endpoint}?key=${cfg.apiKey}&prettyPrint=false`,
      {
        method: 'POST',
        headers: {
          'User-Agent': BROWSER_UA,
          'Content-Type': 'application/json',
          'X-Goog-Visitor-Id': cfg.visitorData,
          'X-YouTube-Client-Name': cfg.clientId,
          'X-YouTube-Client-Version': cfg.clientVersion,
          Origin: MUSIC_ORIGIN,
          Referer: `${MUSIC_ORIGIN}/`,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: cfg.clientName,
              clientVersion: cfg.clientVersion,
              gl: cfg.gl,
              hl: cfg.hl,
            },
            user: { lockedSafetyMode: false },
          },
          ...payload,
        }),
      },
      15000,
    );
    if (!res.ok) {
      console.warn(`ytmusic ${endpoint} failed:`, res.status, payload);
      // A stale API key / visitor id shows up as 400/403 — drop it so the
      // next call re-bootstraps instead of failing forever.
      if (res.status === 400 || res.status === 403) {
        config = null;
      }
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`ytmusic ${endpoint} error:`, e);
    return null;
  }
}

function browse(payload: Record<string, unknown>): Promise<any | null> {
  return innertube('browse', payload);
}

// ---- Response walking ----------------------------------------------------
// InnerTube nests renderers at unpredictable depths and reshuffles the path
// between client versions, so shelves are collected by key rather than by a
// fixed path. Brittle paths are the usual reason a scraped feed silently
// empties out after a YouTube deploy.

/** Every value stored under `key`, at any depth. */
function collect(node: any, key: string, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') {
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, key, out);
    }
    return out;
  }
  for (const k of Object.keys(node)) {
    const v = (node as any)[k];
    if (k === key) {
      out.push(v);
    }
    collect(v, key, out);
  }
  return out;
}

/** First `text` string found under a node (titles, labels, …). */
function firstText(node: any): string {
  const texts = collect(node, 'text');
  for (const t of texts) {
    if (typeof t === 'string' && t.trim()) {
      return t;
    }
  }
  return '';
}

/** Highest-resolution thumbnail, upgraded to a size worth showing full-width. */
function bestThumbnail(node: any): string {
  const lists = collect(node, 'thumbnails');
  let best = '';
  let bestWidth = -1;
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const t of list) {
      const w = Number(t?.width) || 0;
      if (typeof t?.url === 'string' && w > bestWidth) {
        best = t.url;
        bestWidth = w;
      }
    }
  }
  // Google serves any size off the same URL; ask for one that isn't blurry.
  return best.replace(/w\d+-h\d+/, 'w544-h544').replace(/[=]s\d+/, '=s544');
}

/** "3:45" / "1:02:03" → seconds. 0 when absent or unparseable. */
function parseDuration(label: string): number {
  const parts = label.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) {
    return 0;
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

const DURATION_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

/**
 * "821M plays", "1.2M views" — Quick picks puts one of these where other
 * shelves put the album, so it must never be mistaken for an artist name.
 */
const METRIC_RE =
  /^[\d.,]+\s*[kmb]?\s*(?:plays|views|likes|songs?|subscribers?)$/i;

/** Runs of one flex column, separators dropped. */
function columnRuns(row: any, index: number): any[] {
  const col =
    row?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer;
  const runs = col?.text?.runs;
  if (!Array.isArray(runs)) {
    return [];
  }
  return runs.filter(
    (r: any) => typeof r?.text === 'string' && r.text.trim() !== '•',
  );
}

function pageTypeOf(run: any): string {
  return (
    run?.navigationEndpoint?.browseEndpoint
      ?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
      ?.pageType ?? ''
  );
}

/**
 * Row type labels YouTube puts in the second column of a search result
 * ("Song • Jinsang • 1:58"). Excluded from artist detection, or a song row
 * with no linked artist would report its artist as "Song".
 */
const ROW_TYPE_LABEL_RE =
  /^(?:song|video|album|ep|single|playlist|artist|episode|podcast|profile)$/i;

/**
 * Artist from the play button's accessibility label — "Play After Hours - The
 * Weeknd". Search rows for an artist's own name drop the artist column
 * entirely (col 1 is just "Song • 6:02"), and this label is the only place the
 * name survives, so without it those rows all read "Unknown Artist".
 *
 * The label is "<verb> <title> - <artist>", and the title can itself contain
 * dashes, so the artist is what follows the *last* separator.
 */
function artistFromA11y(row: any): string {
  for (const label of collect(row, 'label')) {
    if (typeof label !== 'string' || !/^play\s/i.test(label)) {
      continue;
    }
    const cut = label.lastIndexOf(' - ');
    if (cut === -1) {
      continue;
    }
    const name = label.slice(cut + 3).trim();
    if (name && !DURATION_RE.test(name) && !METRIC_RE.test(name)) {
      return name;
    }
  }
  return '';
}

/**
 * Parse a `musicResponsiveListItemRenderer` (the song-row renderer used by
 * Quick picks, playlists, and chart lists) into a Song. Returns null for rows
 * that aren't playable tracks — shelves mix artists and albums into the same
 * renderer.
 */
function parseSongRow(row: any): Song | null {
  const videoId =
    row?.playlistItemData?.videoId ??
    collect(row?.overlay, 'watchEndpoint')[0]?.videoId ??
    collect(row?.flexColumns?.[0], 'watchEndpoint')[0]?.videoId;
  if (typeof videoId !== 'string' || videoId.length !== 11) {
    return null;
  }
  const title = columnRuns(row, 0)[0]?.text;
  if (!title) {
    return null;
  }

  // Second column is "Artist • Album • 3:45" in some shelves and just the
  // artist in others; pick by endpoint type rather than by position.
  const meta = [...columnRuns(row, 1), ...columnRuns(row, 2)];
  const artistRun = meta.find((r) => pageTypeOf(r) === 'MUSIC_PAGE_TYPE_ARTIST');
  const albumRun = meta.find((r) => pageTypeOf(r) === 'MUSIC_PAGE_TYPE_ALBUM');
  const plainRun = meta.find((r) => {
    const t = r.text.trim();
    return (
      !DURATION_RE.test(t) && !METRIC_RE.test(t) && !ROW_TYPE_LABEL_RE.test(t)
    );
  });

  const durationLabel =
    collect(row?.fixedColumns, 'runs')
      .flat()
      .map((r: any) => String(r?.text ?? '').trim())
      .find((t: string) => DURATION_RE.test(t)) ??
    meta.map((r) => r.text.trim()).find((t) => DURATION_RE.test(t)) ??
    '';

  return {
    id: videoId,
    title,
    artist: (artistRun?.text ?? plainRun?.text ?? artistFromA11y(row)).trim() ||
      'Unknown Artist',
    cover: bestThumbnail(row?.thumbnail),
    album: albumRun?.text?.trim() || undefined,
    duration: parseDuration(durationLabel) || undefined,
  };
}

/**
 * Parse a `musicTwoRowItemRenderer` — the square card used for playlists,
 * albums, artists, and music videos.
 */
function parseCard(card: any): ShelfItem | null {
  const title = firstText(card?.title);
  if (!title) {
    return null;
  }
  const cover = bestThumbnail(card?.thumbnailRenderer);
  const subtitle = (
    (card?.subtitle?.runs ?? [])
      .map((r: any) => String(r?.text ?? ''))
      .join('')
      .trim() || ''
  ).replace(/\s*•\s*/g, ' · ');

  const endpoint = card?.navigationEndpoint ?? {};
  const browseId: string = endpoint?.browseEndpoint?.browseId ?? '';
  const pageType: string =
    endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType ?? '';
  const watchVideoId: string | undefined = endpoint?.watchEndpoint?.videoId;
  const watchPlaylistId: string | undefined =
    endpoint?.watchPlaylistEndpoint?.playlistId;

  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' && browseId) {
    return { kind: 'artist', artistId: browseId, name: title, cover };
  }

  // A single music video. Two shapes: a bare watch endpoint, or a track page
  // whose browse id is literally "MPED" + the 11-char video id — the latter
  // has no track list to open, so treating it as a collection gives a card
  // that opens an empty screen.
  const mpedVideoId =
    browseId.startsWith('MPED') && browseId.length === 15
      ? browseId.slice(4)
      : undefined;
  const videoId = watchVideoId ?? mpedVideoId;
  if (videoId && (mpedVideoId || !browseId)) {
    return {
      kind: 'song',
      song: {
        id: videoId,
        title,
        artist: subtitle.split(' · ')[0] || 'Unknown Artist',
        cover,
      },
    };
  }

  // Playlists arrive as "VL<playlistId>"; albums as an "MPREb_…" browse id,
  // which the browse endpoint expands on its own.
  const collectionId =
    watchPlaylistId ??
    (browseId.startsWith('VL') ? browseId.slice(2) : browseId);
  if (!collectionId) {
    return null;
  }
  return {
    kind: 'collection',
    id: collectionId,
    title,
    subtitle,
    cover,
    type: pageType === 'MUSIC_PAGE_TYPE_ALBUM' ? 'album' : 'playlist',
  };
}

/** Turn one shelf renderer into a titled list of items. */
function parseShelf(shelf: any): Shelf | null {
  const title = firstText(shelf?.header ?? shelf?.title);
  const contents = shelf?.contents ?? shelf?.items ?? [];
  if (!Array.isArray(contents)) {
    return null;
  }
  const items: ShelfItem[] = [];
  for (const entry of contents) {
    if (entry?.musicResponsiveListItemRenderer) {
      const song = parseSongRow(entry.musicResponsiveListItemRenderer);
      if (song) {
        items.push({ kind: 'song', song });
        continue;
      }
      const asCard = parseArtistRow(entry.musicResponsiveListItemRenderer);
      if (asCard) {
        items.push(asCard);
      }
      continue;
    }
    if (entry?.musicTwoRowItemRenderer) {
      const card = parseCard(entry.musicTwoRowItemRenderer);
      if (card) {
        items.push(card);
      }
    }
  }
  if (!title || items.length === 0) {
    return null;
  }
  return { title, items };
}

/**
 * Chart "Top artists" uses the song-row renderer for artists (no videoId),
 * so a row that isn't a track may still be a usable artist entry.
 */
function parseArtistRow(row: any): ShelfItem | null {
  const browseId = collect(row, 'browseId').find(
    (b: any) => typeof b === 'string' && b.startsWith('UC'),
  );
  const name = columnRuns(row, 0)[0]?.text;
  if (!browseId || !name) {
    return null;
  }
  return {
    kind: 'artist',
    artistId: browseId,
    name,
    cover: bestThumbnail(row?.thumbnail),
  };
}

/** Every shelf in a response, in page order. */
function shelvesOf(data: any): Shelf[] {
  const raw = [
    ...collect(data, 'musicCarouselShelfRenderer'),
    ...collect(data, 'musicShelfRenderer'),
  ];
  const out: Shelf[] = [];
  for (const shelf of raw) {
    const parsed = parseShelf(shelf);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

/** Continuation token for the next page of shelves, if any. */
function continuationOf(data: any): string | null {
  const cmd = collect(data, 'continuationCommand')[0]?.token;
  if (typeof cmd === 'string' && cmd) {
    return cmd;
  }
  const legacy = collect(data, 'nextContinuationData')[0]?.continuation;
  return typeof legacy === 'string' && legacy ? legacy : null;
}

/** Drop shelves whose title repeats one we already have. */
function dedupeShelves(shelves: Shelf[]): Shelf[] {
  const seen = new Set<string>();
  const out: Shelf[] = [];
  for (const shelf of shelves) {
    const key = shelf.title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(shelf);
  }
  return out;
}

// ---- Public API ----------------------------------------------------------

/**
 * The real YouTube Music home feed, geolocated by our IP.
 *
 * The first page only carries a couple of shelves — the rest arrive through
 * continuations, which is why a naive single request looks like a broken,
 * two-section feed. `pages` bounds how many we follow.
 */
export async function getHomeShelves(pages = 3): Promise<Shelf[]> {
  const first = await browse({ browseId: 'FEmusic_home' });
  if (!first) {
    return [];
  }
  const shelves = shelvesOf(first);
  let token = continuationOf(first);
  for (let i = 0; i < pages && token; i++) {
    const next = await browse({ continuation: token });
    if (!next) {
      break;
    }
    shelves.push(...shelvesOf(next));
    token = continuationOf(next);
  }
  return dedupeShelves(shelves);
}

/** Regional charts: top artists, video charts, chart playlists. */
export async function getChartShelves(): Promise<Shelf[]> {
  const data = await browse({ browseId: 'FEmusic_charts' });
  return data ? dedupeShelves(shelvesOf(data)) : [];
}

/** New albums, singles and music videos. */
export async function getNewReleaseShelves(): Promise<Shelf[]> {
  const data = await browse({ browseId: 'FEmusic_new_releases' });
  return data ? dedupeShelves(shelvesOf(data)) : [];
}

/**
 * Defaults from a collection page's header. Album pages list their tracks
 * bare — no per-row thumbnail and no artist, because both sit in the header —
 * so rows parsed on their own come out as "Unknown Artist" with no artwork.
 */
function headerDefaults(data: any): {
  artist: string;
  cover: string;
  album: string;
} {
  const header =
    collect(data, 'musicResponsiveHeaderRenderer')[0] ??
    collect(data, 'musicDetailHeaderRenderer')[0] ??
    collect(data, 'musicImmersiveHeaderRenderer')[0];
  if (!header) {
    return { artist: '', cover: '', album: '' };
  }
  const runs: any[] = header.subtitle?.runs ?? [];
  // "Album • 2026" / "Playlist • …" — only an album lends its name to a track.
  const isAlbum = /^(album|ep|single)$/i.test(String(runs[0]?.text ?? '').trim());
  const linkedArtist = runs.find(
    (r) => pageTypeOf(r) === 'MUSIC_PAGE_TYPE_ARTIST',
  )?.text;
  return {
    artist: (firstText(header.straplineTextOne) || linkedArtist || '').trim(),
    cover: bestThumbnail(header.thumbnail),
    album: isAlbum ? firstText(header.title).trim() : '',
  };
}

/**
 * Expand a playlist or album into playable songs. `id` may be a bare playlist
 * id, the "VL…" browse form, or an album/track browse id ("MPRE…").
 */
export async function getCollectionTracks(
  id: string,
  pages = 2,
): Promise<Song[]> {
  // Albums and track pages are browsed under their own id; playlists need the
  // "VL" prefix. Anything already prefixed passes through untouched.
  const browseId =
    id.startsWith('VL') || id.startsWith('MP') || id.startsWith('UC')
      ? id
      : `VL${id}`;
  const data = await browse({ browseId });
  if (!data) {
    return [];
  }
  const songs: Song[] = [];
  const fallback = headerDefaults(data);
  const addRows = (response: any) => {
    for (const row of collect(response, 'musicResponsiveListItemRenderer')) {
      const song = parseSongRow(row);
      if (song) {
        songs.push({
          ...song,
          artist:
            song.artist === 'Unknown Artist' && fallback.artist
              ? fallback.artist
              : song.artist,
          cover: song.cover || fallback.cover,
          album: song.album ?? (fallback.album || undefined),
        });
      }
    }
  };
  addRows(data);
  let token = continuationOf(data);
  for (let i = 0; i < pages && token; i++) {
    const next = await browse({ continuation: token });
    if (!next) {
      break;
    }
    addRows(next);
    token = continuationOf(next);
  }
  // Shelves sometimes repeat a track across continuation boundaries.
  const seen = new Set<string>();
  return songs.filter((s) => {
    if (seen.has(s.id)) {
      return false;
    }
    seen.add(s.id);
    return true;
  });
}

const COUNTRY_NAMES: Record<string, string> = {
  AE: 'UAE', AR: 'Argentina', AT: 'Austria', AU: 'Australia', BD: 'Bangladesh',
  BE: 'Belgium', BR: 'Brazil', CA: 'Canada', CH: 'Switzerland', CL: 'Chile',
  CN: 'China', CO: 'Colombia', CZ: 'Czechia', DE: 'Germany', DK: 'Denmark',
  EG: 'Egypt', ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'the UK',
  GR: 'Greece', HK: 'Hong Kong', HU: 'Hungary', ID: 'Indonesia', IE: 'Ireland',
  IL: 'Israel', IN: 'India', IT: 'Italy', JP: 'Japan', KE: 'Kenya',
  KR: 'South Korea', LK: 'Sri Lanka', MA: 'Morocco', MX: 'Mexico',
  MY: 'Malaysia', NG: 'Nigeria', NL: 'the Netherlands', NO: 'Norway',
  NP: 'Nepal', NZ: 'New Zealand', PE: 'Peru', PH: 'the Philippines',
  PK: 'Pakistan', PL: 'Poland', PT: 'Portugal', RO: 'Romania', RU: 'Russia',
  SA: 'Saudi Arabia', SE: 'Sweden', SG: 'Singapore', TH: 'Thailand',
  TR: 'Türkiye', TW: 'Taiwan', UA: 'Ukraine', US: 'the US',
  VN: 'Vietnam', ZA: 'South Africa',
};

/**
 * Country YouTube resolved from our IP, straight off the page config — no
 * geo-IP API, no rate limit, and always consistent with the feed we just got.
 */
export async function getCountry(): Promise<{ code: string; name: string }> {
  const cfg = await ensureConfig();
  const code = cfg?.gl ?? '';
  if (!code) {
    return { code: '', name: 'your area' };
  }
  return { code, name: COUNTRY_NAMES[code] ?? code };
}

// ---- Search --------------------------------------------------------------

/** The kinds of thing a music search can return, in default display order. */
const BUCKET_ORDER = [
  'Songs',
  'Artists',
  'Albums',
  'Playlists',
  'Videos',
] as const;
export type SearchBucket = (typeof BUCKET_ORDER)[number];

export interface SearchResults {
  /**
   * YouTube's own pick for the query — the big card their app shows above the
   * lists. Null when the response carries no card.
   */
  top: ShelfItem | null;
  /** One section per kind that produced results, best-matching kind first. */
  sections: Shelf[];
}

/** Podcasts, episodes and channel profiles aren't playable music here. */
const SKIP_ROW_LABEL_RE = /^(?:profile|episode|podcast)$/i;

/** Most items per section — the UI shows fewer and expands on demand. */
const MAX_PER_BUCKET = 20;

function itemKey(item: ShelfItem): string {
  if (item.kind === 'song') {
    return `s:${item.song.id}`;
  }
  return item.kind === 'artist' ? `a:${item.artistId}` : `c:${item.id}`;
}

/** The text a query should be scored against, per kind. */
function itemFields(item: ShelfItem): string[] {
  if (item.kind === 'song') {
    return [item.song.title, item.song.artist];
  }
  return item.kind === 'artist' ? [item.name] : [item.title, item.subtitle];
}

/**
 * Classify one search result row. The search response groups everything into
 * untitled `itemSectionRenderer`s and labels each row with its own type, so the
 * row itself is what says whether it's a song, an album or an artist.
 */
function parseSearchRow(
  row: any,
): { bucket: SearchBucket; item: ShelfItem } | null {
  const label = (columnRuns(row, 1)[0]?.text ?? '').trim();
  if (SKIP_ROW_LABEL_RE.test(label)) {
    return null;
  }
  const endpoint = row?.navigationEndpoint ?? {};
  const browseId: string = endpoint?.browseEndpoint?.browseId ?? '';
  const pageType: string =
    endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType ?? '';

  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
    const artist = parseArtistRow(row);
    return artist ? { bucket: 'Artists', item: artist } : null;
  }
  if (
    pageType === 'MUSIC_PAGE_TYPE_ALBUM' ||
    pageType === 'MUSIC_PAGE_TYPE_PLAYLIST'
  ) {
    const title = columnRuns(row, 0)[0]?.text;
    if (!browseId || !title) {
      return null;
    }
    const isAlbum = pageType === 'MUSIC_PAGE_TYPE_ALBUM';
    return {
      bucket: isAlbum ? 'Albums' : 'Playlists',
      item: {
        kind: 'collection',
        id: browseId.startsWith('VL') ? browseId.slice(2) : browseId,
        title,
        subtitle: columnRuns(row, 1)
          .map((r) => String(r.text ?? '').trim())
          .filter(Boolean)
          .join(' · '),
        cover: bestThumbnail(row?.thumbnail),
        type: isAlbum ? 'album' : 'playlist',
      },
    };
  }
  const song = parseSongRow(row);
  if (!song) {
    return null;
  }
  // "Video" rows are music videos — same playback, but ranked below real songs.
  return {
    bucket: /^video$/i.test(label) ? 'Videos' : 'Songs',
    item: { kind: 'song', song },
  };
}

/** YouTube's "top result" card (`musicCardShelfRenderer`). */
function parseCardShelf(card: any): ShelfItem | null {
  if (!card) {
    return null;
  }
  const title = firstText(card.title);
  if (!title) {
    return null;
  }
  const cover = bestThumbnail(card.thumbnail);
  const runs: any[] = card.subtitle?.runs ?? [];
  const subtitle = runs
    .map((r) => String(r?.text ?? ''))
    .join('')
    .replace(/\s*•\s*/g, ' · ')
    .trim();

  const tap = card.onTap ?? {};
  const browseId: string = tap?.browseEndpoint?.browseId ?? '';
  const pageType: string =
    tap?.browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType ?? '';
  const videoId: string | undefined = tap?.watchEndpoint?.videoId;

  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' && browseId) {
    return { kind: 'artist', artistId: browseId, name: title, cover };
  }
  if (videoId) {
    const artist = runs.find(
      (r) => pageTypeOf(r) === 'MUSIC_PAGE_TYPE_ARTIST',
    )?.text;
    const durationLabel =
      runs
        .map((r) => String(r?.text ?? '').trim())
        .find((t) => DURATION_RE.test(t)) ?? '';
    return {
      kind: 'song',
      song: {
        id: videoId,
        title,
        artist: (artist ?? '').trim() || 'Unknown Artist',
        cover,
        duration: parseDuration(durationLabel) || undefined,
      },
    };
  }
  if (browseId) {
    return {
      kind: 'collection',
      id: browseId.startsWith('VL') ? browseId.slice(2) : browseId,
      title,
      subtitle,
      cover,
      type: pageType === 'MUSIC_PAGE_TYPE_ALBUM' ? 'album' : 'playlist',
    };
  }
  return null;
}

/**
 * Search YouTube Music for everything at once — songs, artists, albums,
 * playlists and music videos — with the sections ordered by how well they
 * answer the query. Searching an artist's name therefore leads with that
 * artist instead of burying them under two dozen tracks.
 */
export async function searchAll(query: string): Promise<SearchResults> {
  const term = query.trim();
  if (!term) {
    return { top: null, sections: [] };
  }
  const data = await innertube('search', { query: term });
  if (!data) {
    return { top: null, sections: [] };
  }

  const buckets = new Map<SearchBucket, ShelfItem[]>();
  const seen = new Set<string>();
  for (const row of collect(data, 'musicResponsiveListItemRenderer')) {
    const parsed = parseSearchRow(row);
    if (!parsed) {
      continue;
    }
    const key = itemKey(parsed.item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const list = buckets.get(parsed.bucket) ?? [];
    if (list.length >= MAX_PER_BUCKET) {
      continue;
    }
    list.push(parsed.item);
    buckets.set(parsed.bucket, list);
  }

  // Score each section by its best item, and order sections by that. Ties fall
  // back to BUCKET_ORDER, so a vague query ("lofi") still opens on songs.
  const scored = BUCKET_ORDER.map((bucket, i) => {
    const items = buckets.get(bucket) ?? [];
    let score = 0;
    for (const item of items) {
      const s = bestScore(term, ...itemFields(item));
      if (s > score) {
        score = s;
      }
    }
    return { bucket, items, score, tieBreak: i };
  })
    .filter((s) => s.items.length > 0)
    .sort((a, b) => b.score - a.score || a.tieBreak - b.tieBreak);

  const sections: Shelf[] = scored.map((s) => ({
    title: s.bucket,
    items: s.items,
  }));

  // Prefer YouTube's own card; fall back to the strongest item we found.
  const top =
    parseCardShelf(collect(data, 'musicCardShelfRenderer')[0]) ??
    scored[0]?.items[0] ??
    null;

  return { top, sections };
}

/**
 * Just the playable tracks for a query, best match first — the search path for
 * everything that only wants songs (artist pages, Spotify matching).
 *
 * YouTube's own order puts whatever is popular first, which for "Kesariya"
 * means a 14-minute TV clip ahead of the actual song, so tracks are re-ranked
 * by how well title/artist answer the query. Songs still outrank videos: an
 * equally-scoring official track is always the better pick over a fan upload.
 */
export async function searchTracks(
  query: string,
  limit = 25,
): Promise<Song[]> {
  const { sections } = await searchAll(query);
  const pick = (title: string) =>
    (sections.find((s) => s.title === title)?.items ?? [])
      .filter(
        (i): i is Extract<ShelfItem, { kind: 'song' }> => i.kind === 'song',
      )
      .map((i) => i.song);
  const ranked = [
    ...pick('Songs').map((song, i) => ({ song, i, bonus: 0.05 })),
    ...pick('Videos').map((song, i) => ({ song, i, bonus: 0 })),
  ].map((e) => ({
    ...e,
    score: bestScore(query, e.song.title, e.song.artist) + e.bonus,
  }));
  // Stable within a score band so YouTube's own ranking still decides ties.
  ranked.sort((a, b) => b.score - a.score || a.i - b.i);
  return ranked.slice(0, limit).map((e) => e.song);
}
