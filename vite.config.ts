import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works under a GitHub Pages subpath.
  base: './',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
