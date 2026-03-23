const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.js/,
    },
    {
      name: 'smoke',
      dependencies: ['setup'],
      use: {
        storageState: './tests/e2e/.auth/state.json',
      },
    },
  ],
  webServer: {
    command: 'node server.js',
    port: 3001,
    env: {
      PORT: '3001',
      SESSION_SECRET: 'e2e-test-secret',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/platestack_test_e2e',
    },
    reuseExistingServer: false,
  },
});
