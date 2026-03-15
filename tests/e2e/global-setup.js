const { test: setup } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const AUTH_FILE = path.join(__dirname, '.auth', 'state.json');
const PASSWORD = 'testpass123';
const EMAIL = 'e2e@test.com';

setup('create account and authenticate', async ({ page }) => {
  // Clean slate — remove stale DB so setup screen appears
  const dbPath = path.join(__dirname, '..', '..', 'test-e2e.db');
  try { fs.unlinkSync(dbPath); } catch {}

  await page.goto('/app');

  // Should land on setup screen (no password set yet)
  await page.waitForSelector('#setup-password', { timeout: 10000 });

  await page.fill('#setup-password', PASSWORD);
  await page.fill('#setup-confirm', PASSWORD);
  await page.fill('#setup-email', EMAIL);
  await page.click('#submit-btn');

  // Wait for redirect after setup — app loads the main view
  await page.waitForURL(/.*#\//, { timeout: 10000 });

  // Save auth state (session cookie)
  await page.context().storageState({ path: AUTH_FILE });
});
