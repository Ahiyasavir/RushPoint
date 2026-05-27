// Mobile app ESLint — extends root, adds React Native + hooks rules
module.exports = {
  extends: ['../../.eslintrc.js'],
  parserOptions: {
    ecmaFeatures: { jsx: true },
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  env: {
    browser: false,   // RN is not a browser
    'react-native/react-native': true,
  },
  plugins: ['react', 'react-native', 'react-hooks'],
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    // ── Hooks ────────────────────────────────────────────────────────────────
    'react-hooks/rules-of-hooks':  'error',
    'react-hooks/exhaustive-deps': 'warn',

    // ── React Native quality ─────────────────────────────────────────────────
    'react-native/no-unused-styles':        'warn',
    'react-native/no-inline-styles':        'warn',  // inline styles bypass NativeWind
    'react-native/no-raw-text':             'off',   // NativeWind wraps primitives
    'react-native/no-color-literals':       'off',   // colours live in tailwind.config.js
    'react/react-in-jsx-scope':             'off',   // React 17+ automatic JSX transform

    // ── Offline safety ───────────────────────────────────────────────────────
    // No unhandled promises — all network calls must be wrapped in try/catch
    '@typescript-eslint/no-floating-promises': 'error',
  },
};
