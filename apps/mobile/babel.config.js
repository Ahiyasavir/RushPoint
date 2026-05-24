module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // jsxImportSource enables NativeWind className prop without explicit imports
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      // Reanimated plugin MUST be last
      'react-native-reanimated/plugin',
    ],
  };
};
