const { test, expect } = require('@playwright/test');
const { openApp, goTo, todayIST } = require('./helpers');

test.describe('Cart & pricing', () => {
  test('quick add se cart badge aur total banta hai', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'menu');
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.waitForTimeout(200);
    await expect(page.locator('#cartBadge')).toHaveText('1');
    // Full tiffin ₹80 + near delivery ₹10
    await expect(page.locator('#barTotal')).toHaveText('₹90');
  });

  test('mini variant lene par unit price girta hai', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'menu');
    await page.evaluate(() => window.openMealSheet('lunch'));
    await page.evaluate(() => window.shSetSize('mini'));
    await page.evaluate(() => window.shAddToCartConfirmed());
    await page.waitForTimeout(200);
    await expect(page.locator('#cartBadge')).toHaveText('1');
    await expect(page.locator('#barTotal')).toHaveText('₹70');   // 60 + 10
  });

  test('add-ons total mein jud rahe hain', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'menu');
    await page.evaluate(() => {
      window.openMealSheet('lunch');
      window.shSet('dahi', true);          // +20
      window.shSet('extraSabzi', true);    // +30
      window.shToggleExtraRoti();          // +12 (plain)
      window.shAddToCartConfirmed();
    });
    await page.waitForTimeout(200);
    // 80 + 20 + 30 + 12 + 10 delivery
    await expect(page.locator('#barTotal')).toHaveText('₹152');
  });

  test('butter roti plain se mehenga padta hai', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'menu');
    const plain = await page.evaluate(() => {
      window.openMealSheet('lunch');
      window.shToggleExtraRoti();
      return window.builderUnitPrice('lunch');
    });
    const butter = await page.evaluate(() => {
      window.shSetRoti(true);
      return window.builderUnitPrice('lunch');
    });
    expect(butter - plain).toBe(4);   // 16 − 12
  });

  test('far society par delivery ₹20 lagti hai', async ({ page }) => {
    await openApp(page, { addr:{ deliveryType:'home', society:'Eden', flatNo:'A-101' } });
    await goTo(page, 'menu');
    await page.evaluate(() => window.quickAdd('lunch'));
    await goTo(page, 'cart');
    await page.evaluate(() => { document.getElementById('society').value = 'Eden'; });
    await page.evaluate(() => window.renderCart());
    await page.waitForTimeout(200);
    await expect(page.locator('#cartBarTotal')).toHaveText('₹100');   // 80 + 20
  });

  test('do alag date par delivery fee do baar', async ({ page }) => {
    await openApp(page);
    await page.evaluate(t => {
      window.dateOffset = 1; window.quickAdd('lunch');
      window.dateOffset = 2; window.quickAdd('lunch');
    });
    await page.waitForTimeout(200);
    const total = await page.evaluate(() => window.cartTotalDisplay());
    expect(total).toBe(180);   // (80+80) + (10×2)
  });

  test('remove aur clear cart', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'menu');
    await page.evaluate(() => { window.quickAdd('lunch'); window.quickAdd('dinner'); });
    await page.waitForTimeout(200);
    await expect(page.locator('#cartBadge')).toHaveText('2');
    await page.evaluate(() => window.removeCart(window.cart[0].id));
    await expect(page.locator('#cartBadge')).toHaveText('1');
    await page.evaluate(() => window.clearCart());
    await expect(page.locator('#cartBadge')).toHaveText('0');
  });

  test('cart refresh ke baad bhi bacha rehta hai', async ({ page }) => {
    const { state } = await openApp(page);
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.waitForTimeout(200);
    await openApp(page, { state });
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => window.cart.length);
    expect(n).toBe(1);
  });
});

test.describe('Promo', () => {
  test('valid code apply hota hai aur total ghatta hai', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.quickAdd('lunch'));
    await goTo(page, 'cart');
    await page.fill('#promoCode', 'WELCOME50');
    await page.click('#promoApplyBtn');
    await page.waitForTimeout(400);
    await expect(page.locator('.promo-applied')).toContainText('WELCOME50');
    await expect(page.locator('#cartBarTotal')).toHaveText('₹40');   // 90 − 50
  });

  test('galat code reject hota hai', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.quickAdd('lunch'));
    await goTo(page, 'cart');
    await page.fill('#promoCode', 'NOPE99');
    await page.click('#promoApplyBtn');
    await page.waitForTimeout(400);
    await expect(page.locator('#toast')).toContainText('Invalid coupon');
    await expect(page.locator('#cartBarTotal')).toHaveText('₹90');
  });

  test('promo hatane par total wapas', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.quickAdd('lunch'));
    await goTo(page, 'cart');
    await page.fill('#promoCode', 'WELCOME50');
    await page.click('#promoApplyBtn');
    await page.waitForTimeout(400);
    await page.click('.pr-x');
    await page.waitForTimeout(200);
    await expect(page.locator('#cartBarTotal')).toHaveText('₹90');
  });

  test('discount total se zyada nahi ho sakta', async ({ page }) => {
    await openApp(page, { state: (() => {
      const s = require('./helpers').freshState();
      s.promos[0].value = 500;
      return s;
    })() });
    await page.evaluate(() => window.quickAdd('lunch'));
    await goTo(page, 'cart');
    await page.fill('#promoCode', 'WELCOME50');
    await page.click('#promoApplyBtn');
    await page.waitForTimeout(400);
    const total = await page.evaluate(() => window.cartTotalDisplay());
    expect(total).toBe(0);
    expect(total).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Checkout & orders', () => {
  test('order place hone par success card aata hai', async ({ page }) => {
    const { state } = await openApp(page);
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.evaluate(() => window.goToCheckout());
    await page.waitForTimeout(200);
    await page.fill('#customerName', 'Test User');
    await page.click('#placeBtn');
    await page.waitForTimeout(600);
    await expect(page.locator('#successCard')).toBeVisible();
    expect(state.orders.length).toBe(1);
    expect(state.orders[0].total).toBe('₹90');
  });

  test('server ka total dikhta hai, client ka nahi', async ({ page }) => {
    const { state } = await openApp(page);
    await page.evaluate(() => {
      window.quickAdd('lunch');
      window.cart[0].qty = 1;
      window.CFG.prices.lunch = 5;    // client ko dhokha dene ki koshish
    });
    await page.evaluate(() => window.goToCheckout());
    await page.fill('#customerName', 'Test User');
    await page.click('#placeBtn');
    await page.waitForTimeout(600);
    expect(state.orders[0].total).toBe('₹90');   // server ne 80+10 hi liya
  });

  test('duplicate order same date+meal reject', async ({ page }) => {
    const { state } = await openApp(page);
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { window.cart = []; window.quickAdd('lunch'); });
      await page.evaluate(() => window.goToCheckout());
      await page.fill('#customerName', 'Test User');
      await page.click('#placeBtn');
      await page.waitForTimeout(600);
      await page.evaluate(() => window.resetAll());
    }
    expect(state.orders.length).toBe(1);
  });

  test('khaali cart par checkout nahi', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.goToCheckout());
    await page.waitForTimeout(200);
    await expect(page.locator('#page2')).toHaveClass(/hidden/);
    await expect(page.locator('#toast')).toContainText('empty');
  });

  test('address blank ho to validation rukta hai', async ({ page }) => {
    await openApp(page, { addr:{ deliveryType:'home', society:'', flatNo:'' } });
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.evaluate(() => window.goToCheckout());
    await page.waitForTimeout(200);
    await page.fill('#customerName', 'Test User');
    await page.click('#placeBtn');
    await page.waitForTimeout(400);
    await expect(page.locator('#err-society')).toHaveClass(/show/);
    await expect(page.locator('#successCard')).toHaveClass(/hidden/);
  });

  test('flat number format normalize hota hai', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.evaluate(() => window.goToCheckout());
    await page.fill('#flatNo', 'd706');
    await page.evaluate(() => window.validateFlat());
    await expect(page.locator('#flatNo')).toHaveValue('D-706');
  });

  test('UPI chunne par QR box dikhta hai', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.evaluate(() => window.goToCheckout());
    await page.evaluate(() => window.setPay('UPI'));
    await page.fill('#customerName', 'Test User');
    await page.click('#placeBtn');
    await page.waitForTimeout(600);
    await expect(page.locator('#upiPayBox')).toBeVisible();
    await expect(page.locator('#upiPayBox')).toContainText('₹90');
  });

  test('COD chunne par cash note dikhta hai', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.evaluate(() => window.goToCheckout());
    await page.evaluate(() => window.setPay('COD'));
    await page.fill('#customerName', 'Test User');
    await page.click('#placeBtn');
    await page.waitForTimeout(600);
    await expect(page.locator('.cod-note')).toBeVisible();
  });

  test('My Orders mein order dikhta hai aur cancel hota hai', async ({ page }) => {
    const { state } = await openApp(page);
    state.orders.push({ row:2, deliveryDate:todayIST(1), meal:'lunch', phone:'9876543210',
      name:'Test User', society:'Vrindavan', flat:'D-706', status:'Pending',
      mealStatus:{ lunch:'Pending' }, total:'₹90', payment:'COD', paymentStatus:'Unpaid',
      lunchQty:1, breakfastQty:0, dinnerQty:0, lunchSabzi:'Dal Tadka',
      lunchTiffin:'1 Full Tiffin', lunchRoti:'Plain', lunchAddons:'None',
      promo:'', note:'', createdIso:new Date().toISOString().slice(0,16) });

    await goTo(page, 'orders');
    await page.waitForTimeout(500);
    await expect(page.locator('.ord-row')).toHaveCount(1);

    await page.click('.ord-row');
    await page.waitForTimeout(300);
    await expect(page.locator('#orderModal')).toBeVisible();
    await expect(page.locator('#omBody')).toContainText('₹90');

    page.on('dialog', d => d.accept());
    await page.evaluate(() =>
      window.cancelMyOrder(2, window.myOrdersCache[0].deliveryDate, ''));
    await page.waitForTimeout(300);
    await page.click('#cfYes');
    await page.waitForTimeout(500);
    expect(state.orders[0].status).toBe('Cancelled');
  });
});

test.describe('Session', () => {
  test('invalid session par login page', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.forceLogout());
    await page.waitForTimeout(300);
    await expect(page.locator('#authPage')).toBeVisible();
  });

  test('logout se cart bhi khaali', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.evaluate(() => window.logout());
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => window.cart.length);
    expect(n).toBe(0);
    await expect(page.locator('#pubView')).toBeVisible();
  });

  test('guest ko order par login dikhta hai', async ({ page }) => {
    await openApp(page, { loggedIn:false });
    await page.evaluate(() => window.goOrderNow());
    await page.waitForTimeout(300);
    await expect(page.locator('#authPage')).toBeVisible();
  });
});
