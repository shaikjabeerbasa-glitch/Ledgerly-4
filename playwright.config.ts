import { defineConfig, devices } from '@playwright/test';
const reportRoot = process.env.LEDGERLY_REPORT_DIR || '.';
const executablePath = process.env.LEDGERLY_CHROMIUM_PATH;
export default defineConfig({
  testDir: './tests/e2e', outputDir: reportRoot + '/test-results', timeout: 45000, expect: { timeout: 7000 },
  fullyParallel: true, workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: reportRoot + '/playwright-report' }], ['json', { outputFile: reportRoot + '/test-results/results.json' }]],
  use: { baseURL: process.env.LEDGERLY_BASE_URL || 'http://127.0.0.1:8776', timezoneId: 'Asia/Kolkata', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: process.env.LEDGERLY_BASE_URL ? undefined : { command: 'python3 -m http.server 8776 --bind 127.0.0.1', url:'http://127.0.0.1:8776', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: {...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath, args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] } : {} } },
    { name: 'firefox', use: {...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'accessibility.tabfocus': 7 } } } },
    { name: 'webkit', use: {...devices['Desktop Safari']} },
    { name: 'mobile-chrome', use: {...devices['Pixel 5'], launchOptions: executablePath ? { executablePath, args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] } : {} } }
  ]
});
