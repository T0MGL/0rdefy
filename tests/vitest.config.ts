import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Global test timeout (30 seconds for API calls)
    testTimeout: 30000,

    // Hook timeout
    hookTimeout: 60000,

    // Run tests sequentially (important for E2E to avoid race conditions)
    sequence: {
      shuffle: false,
      concurrent: false
    },

    // Don't run tests in parallel (production safety)
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },

    // File patterns
    include: ['e2e/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],

    // Reporter configuration
    reporters: ['verbose'],

    // Global setup/teardown
    globalSetup: './e2e/setup.ts',

    // Retry failed tests (production can be flaky)
    retry: 1,

    // Bail on first failure in CI
    bail: process.env.CI ? 1 : 0,

    // Coverage (optional)
    coverage: {
      enabled: false,
      provider: 'v8'
    },

    // TypeScript
    typecheck: {
      enabled: false
    }
  }
});
