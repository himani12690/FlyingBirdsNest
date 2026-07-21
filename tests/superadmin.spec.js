const { test, expect } = require('@playwright/test');
const { openApp, superLogin, freshState } = require('./helpers');

test.describe('Super admin', () => {
  test('sahi creds se vendor list', async ({ page }) => {
    await openApp(page);
    await superLogin(page);
    await expect(page.locator('#superPanel')).toBeVisible();
    await expect(page.locator('#superVendorList .pf-box')).toHaveCount(1);
  });

  test('galat creds reject', async ({ page }) => {
    await openApp(page);
    await superLogin(page, 'yuvraj_owner', 'nope');
    await expect(page.locator('#superPanel')).toHaveClass(/hidden/);
    await expect(page.locator('#toast')).toContainText('Invalid');
  });

  test('naya vendor add hota hai', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await page.fill('#svName', 'Shyam Rasoi');
    await page.fill('#svId', 'shyamrasoi');
    await page.fill('#svSheetId', 'SHEET_NEW_123');
    await page.fill('#svAdminUser', 'shyam');
    await page.fill('#svAdminPass', 'pass123');
    await page.click('#svSaveBtn');
    await page.waitForTimeout(500);
    expect(state.vendors.some(v => v.vendorId === 'shyamrasoi')).toBe(true);
    await expect(page.locator('#superVendorList .pf-box')).toHaveCount(2);
  });

  test('URL paste karne par slug clean hota hai', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await page.fill('#svName', 'Test');
    await page.fill('#svId', 'https://app.com/?v=shyamrasoi');
    await page.fill('#svSheetId', 'https://docs.google.com/spreadsheets/d/ABC123/edit');
    await page.fill('#svAdminUser', 'a');
    await page.fill('#svAdminPass', 'b');
    await page.click('#svSaveBtn');
    await page.waitForTimeout(500);
    const v = state.vendors.find(x => x.vendorId === 'shyamrasoi');
    expect(v).toBeTruthy();
    expect(v.sheetId).toBe('ABC123');
  });

  test('duplicate sheet ID reject', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await page.fill('#svName', 'Dupe');
    await page.fill('#svId', 'dupe');
    await page.fill('#svSheetId', 'SHEET1');     // default vendor ka
    await page.fill('#svAdminUser', 'a');
    await page.fill('#svAdminPass', 'b');
    await page.click('#svSaveBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('#toast')).toContainText('pehle se');
    expect(state.vendors.length).toBe(1);
  });

  test('zaroori fields bina save nahi', async ({ page }) => {
    await openApp(page);
    await superLogin(page);
    await page.fill('#svName', 'Adhura');
    await page.click('#svSaveBtn');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('zaroori');
  });

  test('superadmin logout', async ({ page }) => {
    await openApp(page);
    await superLogin(page);
    await page.evaluate(() => window.superLogout());
    await page.waitForTimeout(300);
    await expect(page.locator('#superPanel')).toHaveClass(/hidden/);
  });
});
