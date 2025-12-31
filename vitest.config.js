import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Browser mode for real DOM testing
    browser: {
      enabled: true,
      name: 'chromium',
      provider: 'playwright',
      headless: true,
    },

    // Setup file
    setupFiles: ['./tests/setup.js'],

    // Test globals (describe, it, expect, etc.)
    globals: true,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.js', 'components/**/*.js'],
      exclude: ['**/*.test.js', '**/*.spec.js', '**/node_modules/**'],
    },

    // Test file patterns
    include: ['tests/**/*.test.js', 'tests/**/*.spec.js'],

    // Timeout for tests
    testTimeout: 10000,
  },

  // Resolve configuration for imports
  resolve: {
    alias: {
      '@': '/Users/seg/work/ML_environment/claude/sonofire',
    },
  },
});
