// Root ESLint config — all packages extend this.
// Packages can override individual rules in their own .eslintrc.js.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2020: true,
  },
  rules: {
    // ── TypeScript ───────────────────────────────────────────────────────────
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    // Enforces `import type { Foo }` — keeps runtime bundle clean
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    '@typescript-eslint/no-non-null-assertion': 'warn',

    // ── General ──────────────────────────────────────────────────────────────
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    // Allow console.warn/error/info — ban console.log in production code
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'no-debugger': 'error',
    'no-alert': 'error',     // use proper error UI, never raw alert()
  },
  ignorePatterns: [
    'dist/',
    'lib/',
    'node_modules/',
    '.expo/',
    '*.config.js',
    '*.config.ts',
    'babel.config.js',
    'metro.config.js',
  ],
};
