/* eslint-env jest */

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(() => ({
    executeSql: jest.fn(() =>
      Promise.resolve([
        { rows: { raw: () => [], item: () => null }, insertId: 1 },
      ]),
    ),
    transaction: jest.fn(),
  })),
}));

jest.mock('react-native-track-player', () => ({
  setupPlayer: jest.fn(() => Promise.resolve()),
  updateOptions: jest.fn(() => Promise.resolve()),
  setRepeatMode: jest.fn(() => Promise.resolve()),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  add: jest.fn(() => Promise.resolve()),
  reset: jest.fn(() => Promise.resolve()),
  skip: jest.fn(() => Promise.resolve()),
  play: jest.fn(() => Promise.resolve()),
  pause: jest.fn(() => Promise.resolve()),
  seekTo: jest.fn(() => Promise.resolve()),
  getPlaybackState: jest.fn(() => Promise.resolve({ state: 'none' })),
  getActiveTrackIndex: jest.fn(() => Promise.resolve(null)),
  getQueue: jest.fn(() => Promise.resolve([])),
  skipToNext: jest.fn(() => Promise.resolve()),
  skipToPrevious: jest.fn(() => Promise.resolve()),
  setQueue: jest.fn(() => Promise.resolve()),
  usePlaybackState: jest.fn(() => ({ state: 'none' })),
  useProgress: jest.fn(() => ({ position: 0, duration: 0, buffered: 0 })),
  State: {
    None: 'none',
    Ready: 'ready',
    Playing: 'playing',
    Paused: 'paused',
    Buffering: 'buffering',
    Ended: 'ended',
  },
  Event: {},
  Capability: {},
  RepeatMode: { Off: 0, Track: 1, Queue: 2 },
  AppKilledPlaybackBehavior: { ContinuePlayback: 0 },
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  mkdir: jest.fn(() => Promise.resolve()),
  exists: jest.fn(() => Promise.resolve(false)),
  unlink: jest.fn(() => Promise.resolve()),
  downloadFile: jest.fn(() => ({
    promise: Promise.resolve({ statusCode: 200 }),
  })),
}));

jest.mock('react-native-vector-icons/Ionicons', () => 'Icon');
