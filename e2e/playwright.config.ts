import { defineConfig, devices } from '@playwright/test';

// Runs against the already-started dev stack; nothing is launched from here.
export default defineConfig({
  testDir: './tests',
  // The dev frontend compiles each page on first visit, which can take a while on the M1.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'it-IT',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
