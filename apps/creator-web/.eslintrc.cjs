// Admin dashboard ESLint — extends root, adds React (web) rules
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

    // Unhandled promises — Firestore listeners and async handlers must be handled
    '@typescript-eslint/no-floating-promises': 'error',
  },
};
