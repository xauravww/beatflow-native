/**
 * YouTube Music radio — the endless "keep playing something like this" queue,
 * from InnerTube's `next` endpoint.
 *
 * This is how the app gets recommendations without owning a recommender.
 * Spotify's suggestions come from collaborative filtering over hundreds of
 * millions of listeners; that data is the product, and it can't be
 * reimplemented locally. YouTube Music runs the same class of model and
 * exposes it per-track through radio playlists, so seeding a radio from what
 * the user is playing borrows their engine for free.
 *
 * Same response-walking rules as ytmusicBrowse: collect renderers by key, not
 * by path, so a YouTube deploy that re-nests things doesn't empty the queue.
 */
import {
  bestThumbnail,
  collect,
  firstText,
  innertube,
  parseDuration,
} from './ytmusicBrowse';
import { Song } from './types';

/** Byline entries that are metadata, not an artist name. */
const DURATION_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const METRIC_RE =
  /^[\d.,]+\s*[kmb]?\s*(?:plays|views|likes|songs?|subscribers?)$/i;

/**
 * Parse a `playlistPanelVideoRenderer` — the row renderer the watch queue uses.
 * It's a different shape from the browse/search song row, hence its own parser:
 * title and byline are plain run lists here rather than flex columns.
 */
function parsePanelVideo(v: any): Song | null {
  const id: unknown =
    v?.videoId ?? collect(v?.navigationEndpoint, 'videoId')[0];
  if (typeof id !== 'string' || id.length !== 11) {
    return null;
  }
  const title = firstText(v?.title);
  if (!title) {
    return null;
  }

  const runs: any[] = (
    v?.longBylineText?.runs ??
    v?.shortBylineText?.runs ??
    []
  ).filter(
    (r: any) => typeof r?.text === 'string' && r.text.trim() && r.text.trim() !== '•',
  );
  const pageTypeOf = (run: any): string =>
    run?.navigationEndpoint?.browseEndpoint
      ?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
      ?.pageType ?? '';
  const artistRun = runs.find(
    (r) => pageTypeOf(r) === 'MUSIC_PAGE_TYPE_ARTIST',
  );
  const albumRun = runs.find((r) => pageTypeOf(r) === 'MUSIC_PAGE_TYPE_ALBUM');
  // Radio rows for topic/auto-generated channels carry no artist endpoint, so
  // fall back to the first run that isn't a view count or a running time.
  const plainRun = runs.find((r) => {
    const t = r.text.trim();
    return !DURATION_RE.test(t) && !METRIC_RE.test(t);
  });

  return {
    id,
    title,
    artist:
      (artistRun?.text ?? plainRun?.text ?? '').trim() || 'Unknown Artist',
    cover: bestThumbnail(v?.thumbnail),
    album: albumRun?.text?.trim() || undefined,
    duration: parseDuration(firstText(v?.lengthText)) || undefined,
  };
}

function parsePanel(data: any, seedId: string): Song[] {
  const songs: Song[] = [];
  const seen = new Set<string>([seedId]);
  for (const v of collect(data, 'playlistPanelVideoRenderer')) {
    const song = parsePanelVideo(v);
    // The seed track is always item 1 of its own radio — drop it, plus any
    // repeats YouTube includes across continuation pages.
    if (song && !seen.has(song.id)) {
      seen.add(song.id);
      songs.push(song);
    }
  }
  return songs;
}

/**
 * Tracks YouTube Music would play on after `videoId` — its "song radio".
 *
 * `RDAMVM<videoId>` is the radio playlist for a track and `params: 'wAEB'`
 * asks for the radio mix rather than the plain "up next" list, which is what
 * the web player sends when you pick "Start radio".
 */
export async function getRadioTracks(
  videoId: string,
  limit = 25,
): Promise<Song[]> {
  const data = await innertube('next', {
    enablePersistentPlaylistPanel: true,
    isAudioOnly: true,
    tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
    videoId,
    playlistId: `RDAMVM${videoId}`,
    params: 'wAEB',
  });
  if (!data) {
    return [];
  }
  return parsePanel(data, videoId).slice(0, limit);
}

/**
 * The "Up next" queue for a playlist or album — YouTube's own ordering,
 * including the mixes it appends once the collection runs out.
 */
export async function getWatchQueue(
  playlistId: string,
  limit = 50,
): Promise<Song[]> {
  const data = await innertube('next', {
    enablePersistentPlaylistPanel: true,
    isAudioOnly: true,
    tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
    playlistId,
  });
  if (!data) {
    return [];
  }
  return parsePanel(data, '').slice(0, limit);
}
