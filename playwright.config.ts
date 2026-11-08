import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'ATRIUM_ADMIN_TOKEN=test-admin ATRIUM_COLLECTOR_PORT=8787 npm run collector:dev',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
