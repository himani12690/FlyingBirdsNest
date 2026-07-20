// Playwright config — Nest & Nosh
// Chalane ke liye tests/README.md padho.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Ek-ek karke chalao — screenshots aur console errors gadbad na hon
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'tests/report', open: 'never' }]],
  outputDir: 'tests/artifacts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    // Asli phone jaisa — app mobile-first hai
    ...devices['Pixel 7'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
