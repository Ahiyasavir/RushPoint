// Participant app ESLint — mirrors creator-web's config.
//
// This file did not exist until the "rendered fewer hooks" production crash:
// `npm run lint` is `turbo run lint`, which only runs workspaces that DECLARE a
// lint script, so play-web — the app players actually hold in their hands — was
// the one app never linted. A `useState` sitting below an `if (!task) return`
// in TaskRunner therefore shipped to production and crashed the whole tree to
// the ErrorBoundary on almost every action. `react-hooks/rules-of-hooks` catches
// exactly that, so the participant app now runs it in the gate like every other.
module.exports = {
  extends: [
    '../../.eslintrc.js',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: {
    ecmaFeatures: { jsx: true },
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  env: {
    browser: true,
    node: false,
  },
  plugins: ['react'],
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    'react/react-in-jsx-scope': 'off',  // React 17+ automatic transform
    'react/prop-types':         'off',  // TypeScript handles prop typing
    'react/display-name':       'off',

    // The crash above was a hooks-order bug — keep this at error, never warn.
    'react-hooks/rules-of-hooks': 'error',

    // Unhandled promises — Firestore listeners and async handlers must be handled
    '@typescript-eslint/no-floating-promises': 'error',
  },
};
