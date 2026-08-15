module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: {
    '\\.css$': '<rootDir>/jest.styleMock.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-track-player|react-native-vector-icons|react-native-sqlite-storage|react-native-fs|react-native-reanimated|react-native-worklets|nativewind|react-native-css-interop|@react-navigation|react-native-safe-area-context|react-native-screens|@react-native-community/slider)/)',
  ],
};
