const { test, expect } = require('@playwright/test');
const { openApp, adminLogin, freshState, todayIST } = require('./helpers');

function seedOrder(state, over = {}) {
  const row = state.nextRow++;
  state.orders.push(Object.assign({
    row, deliveryDate:todayIST(0), meal:'lunch', phone:'9876543210',
    name:'Test User', society:'Vrindavan', flat:'D-706',
    status:'Pending', mealStatus:{ lunch:'Pending' },
    total:'₹90', payment:'COD', paymentStatus:'Unpaid',
    breakfastQty:0, lunchQty:1, dinnerQty:0,
    lunchSabzi:'Dal Tadka', lunchTiffin:'1 Full Tiffin', lunchRoti:'Plain',
    lunchAddons:'None', lunchTimeSlot:'12–1 PM', dinnerSabzi:'', dinnerTiffin:'',
    dinnerRoti:'', dinnerAddons:'None', note:'', promo:'', deliveryType:'home',
    time:'01/01 10:00 AM', day:'Monday', createdIso:new Date().toISOString().slice(0,16)
  }, over));
  return row;
}

test.describe('Admin auth', () => {
  test('sahi credentials se panel khulta hai', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await expect(page.locator('#adminPanel')).toBeVisible();
  });

  test('galat password reject', async ({ page }) => {
    await openApp(page);
    await adminLogin(page, 'demo', 'wrong');
    await expect(page.locator('#adminPanel')).toHaveClass(/hidden/);
    await expect(page.locator('#toast')).toContainText('Invalid');
  });

  test('khaali fields par warning', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.showAdminLogin());
    await page.click('#loginBtn');
    await expect(page.locator('#toast')).toContainText('username and password');
  });

  test('logout se panel band', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminLogout());
    await page.waitForTimeout(300);
    await expect(page.locator('#adminPanel')).toHaveClass(/hidden/);
  });
});

test.describe('Admin orders', () => {
  test('order list dikhti hai', async ({ page }) => {
    const state = freshState();
    seedOrder(state); seedOrder(state, { meal:'dinner', dinnerQty:1, lunchQty:0 });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    await expect(page.locator('#ordersList .oc')).toHaveCount(2);
  });

  test('status filter kaam karta hai', async ({ page }) => {
    const state = freshState();
    seedOrder(state);
    seedOrder(state, { status:'Delivered', mealStatus:{ lunch:'Delivered' } });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.setOrderFilter('Delivered'));
    await page.waitForTimeout(200);
    await expect(page.locator('#ordersList .oc')).toHaveCount(1);
  });

  test('meal status badalne se order status derive hota hai', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(r => window.setMealSt(r, 'lunch', 'Preparing'), row);
    await page.waitForTimeout(400);
    expect(state.orders[0].status).toBe('Preparing');
    await page.evaluate(r => window.setMealSt(r, 'lunch', 'Delivered'), row);
    await page.waitForTimeout(400);
    expect(state.orders[0].status).toBe('Delivered');
  });

  test('bulk status update', async ({ page }) => {
    const state = freshState();
    seedOrder(state); seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => window.bulkStatus('Pending', 'Preparing'));
    await page.waitForTimeout(500);
    expect(state.orders.every(o => o.status === 'Preparing')).toBe(true);
  });

  test('kitchen summary sahi qty jodta hai', async ({ page }) => {
    const state = freshState();
    seedOrder(state);
    seedOrder(state);
    seedOrder(state, { meal:'dinner', lunchQty:0, dinnerQty:1,
                       mealStatus:{ dinner:'Pending' } });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    const cells = await page.locator('#kitchenSummary .ks-n').allTextContents();
    expect(cells).toEqual(['0', '2', '1']);   // breakfast, lunch, dinner
  });

  test('money bar COD/UPI alag ginta hai', async ({ page }) => {
    const state = freshState();
    seedOrder(state, { payment:'COD', total:'₹90' });
    seedOrder(state, { payment:'UPI', total:'₹150' });
    seedOrder(state, { payment:'COD', total:'₹999', status:'Cancelled' });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    const nums = await page.locator('#moneyBar .mb-n').allTextContents();
    expect(nums).toEqual(['₹90', '₹150', '₹240']);   // cancelled count nahi hua
  });

  test('paid toggle', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(r => window.togglePaid(r, 'Unpaid'), row);
    await page.waitForTimeout(400);
    expect(state.orders[0].paymentStatus).toBe('Paid');
  });

  test('society filter', async ({ page }) => {
    const state = freshState();
    seedOrder(state, { society:'Vrindavan' });
    seedOrder(state, { society:'Eden' });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.setSocFilter('Eden'));
    await page.waitForTimeout(200);
    await expect(page.locator('#ordersList .oc')).toHaveCount(1);
  });
});

test.describe('Admin users', () => {
  test('user list aur search', async ({ page }) => {
    const state = freshState();
    state.users.push({ phone:'9000000002', name:'Priya Patel', email:'p@t.com',
      created:'01 Jan 25', lastLogin:'01 Jan 25', status:'Active', orders:3 });
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('users'));
    await page.waitForTimeout(500);
    await expect(page.locator('#usersList .oc')).toHaveCount(2);
    await page.fill('#userSearch', 'Priya');
    await page.waitForTimeout(200);
    await expect(page.locator('#usersList .oc')).toHaveCount(1);
  });

  test('block / unblock', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('users'));
    await page.waitForTimeout(500);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => window.toggleUserBlock('9876543210', 'Blocked'));
    await page.waitForTimeout(400);
    expect(state.users[0].status).toBe('Blocked');
  });

  test('reset user tabhi chalta hai jab number sahi type ho', async ({ page }) => {
    const state = freshState();
    seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('users'));
    await page.waitForTimeout(500);

    // Pehle galat number — reset nahi hona chahiye
    page.once('dialog', d => d.accept());                    // warning confirm
    page.once('dialog', d => d.accept('1111111111'));        // galat prompt
    await page.evaluate(() => window.resetUserData('9876543210', 'Test User', 1));
    await page.waitForTimeout(400);
    expect(state.users.length).toBe(1);

    // Ab sahi number
    page.once('dialog', d => d.accept());
    page.once('dialog', d => d.accept('9876543210'));
    await page.evaluate(() => window.resetUserData('9876543210', 'Test User', 1));
    await page.waitForTimeout(600);
    expect(state.users.length).toBe(0);
    expect(state.orders.length).toBe(0);
  });
});

test.describe('Admin menu & config', () => {
  test('menu save hota hai', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('menu'));
    await page.waitForTimeout(300);
    await page.fill('#ed-lunchSabzi', 'Kadhi\nBhindi Masala');
    await page.click('#saveMenuBtn');
    await page.waitForTimeout(500);
    expect(state.menu.monday.lunch.sabziOptions).toEqual(['Kadhi','Bhindi Masala']);
  });

  test('khaali menu save nahi hota', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('menu'));
    await page.waitForTimeout(300);
    await page.fill('#ed-lunchSabzi', '');
    await page.click('#saveMenuBtn');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('incomplete');
  });

  test('price update customer side pe dikhta hai', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('config'));
    await page.waitForTimeout(300);
    await page.fill('#pr-lunch', '95');
    await page.click('#saveConfigBtn');
    await page.waitForTimeout(500);
    expect(state.config.prices.lunch).toBe(95);
  });

  test('dono delivery mode band nahi ho sakte', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('config'));
    await page.waitForTimeout(300);
    await page.uncheck('#cfg-homeEnabled');
    await page.uncheck('#cfg-officeEnabled');
    await page.click('#saveConfigBtn');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('at least one delivery mode');
  });

  test('office ON par company zaroori', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('config'));
    await page.waitForTimeout(300);
    await page.check('#cfg-officeEnabled');
    await page.fill('#cfg-companies', '');
    await page.click('#saveConfigBtn');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('at least one company');
  });

  test('closed date add / remove', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('config'));
    await page.waitForTimeout(300);
    await page.fill('#closedDateInput', '2026-01-26');
    await page.click('text=+ Add');
    await page.waitForTimeout(200);
    await expect(page.locator('#closedDatesList .oc')).toHaveCount(1);
    await page.click('text=✖ Remove');
    await page.waitForTimeout(200);
    await expect(page.locator('#closedDatesList')).toContainText('No closed dates');
  });
});

test.describe('Admin variants', () => {
  test('variant add aur save', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('variants'));
    await page.waitForTimeout(300);
    await page.click('text=➕ Add New Variant');
    await page.waitForTimeout(200);
    await expect(page.locator('#varList .var-card')).toHaveCount(3);
    await page.click('#saveVarBtn');
    await page.waitForTimeout(500);
    expect(state.config.variants.lunch.length).toBe(3);
  });

  test('aakhri variant delete nahi hota', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('variants'));
    await page.evaluate(() => window.varSetMeal('breakfast'));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.delVariant(0));
    await page.waitForTimeout(200);
    await expect(page.locator('#toast')).toContainText('At least 1 variant');
  });
});

test.describe('Admin promos', () => {
  test('promo create', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('promos'));
    await page.waitForTimeout(400);
    await page.fill('#pmCode', 'SAVE20');
    await page.selectOption('#pmType', 'PERCENT');
    await page.fill('#pmValue', '20');
    await page.fill('#pmMaxD', '40');
    await page.click('#pmSaveBtn');
    await page.waitForTimeout(500);
    const p = state.promos.find(x => x.code === 'SAVE20');
    expect(p.type).toBe('PERCENT');
    expect(p.value).toBe(20);
    expect(p.maxDiscount).toBe(40);
  });

  test('code ya value bina save nahi', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('promos'));
    await page.waitForTimeout(400);
    await page.click('#pmSaveBtn');
    await page.waitForTimeout(200);
    await expect(page.locator('#toast')).toContainText('required');
  });

  test('promo toggle aur delete', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('promos'));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.togglePromoFE(0));
    await page.waitForTimeout(400);
    expect(state.promos[0].active).toBe(false);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => window.delPromoFE(0));
    await page.waitForTimeout(400);
    expect(state.promos.length).toBe(0);
  });
});

test.describe('Admin stats', () => {
  test('cancelled order revenue mein nahi', async ({ page }) => {
    const state = freshState();
    seedOrder(state, { total:'₹100' });
    seedOrder(state, { total:'₹999', status:'Cancelled' });
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('stats'));
    await page.waitForTimeout(500);
    await expect(page.locator('#st-todayRev')).toHaveText('₹100');
  });
});
