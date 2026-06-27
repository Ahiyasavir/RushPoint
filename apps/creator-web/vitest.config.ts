import { defineConfig } from 'vitest/config';

// Unit-test config for the v2.1 Builder redesign suite (node env: the redesign's
// logic — card previews, dynamic-quiz array mapping, template loading, and the
// context-panel draft-isolation reducer — is pure and DOM-free).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
