/**
 * Volume / scale tests — Nest & Nosh
 *
 * Alag file rakha hai (npm run test:volume se chalta hai, `npm test` me shamil
 * NAHI hai) kyunki ye baaki suite se zyada bhaari/dheeme hote hain.
 *
 * Ye SAB kuch mocked backend (helpers.js) ke against chalta hai — real Apps
 * Script deployment ko bilkul touch nahi karta. Isliye ye batata hai ki
 * FRONTEND 100 vendors / 100 orders jaisi volume par bina toote/bina lag ke
 * kaam karta hai ya nahi — REAL backend (Google Sheets + LockService) itna
 * throughput saha payega ya nahi, ye alag sawaal hai (README.md dekho).
 *
 * Scale configurable hai (default 100, chhoti machine par LOAD_VENDORS=30
 * jaisa env var se ghata sakte ho):
 *   LOAD_VENDORS=100 LOAD_ORDERS=100 npx playwright test tests/volume.spec.js
 */
const { test, expect } = require('@playwright/test');
const { openApp, adminLogin, freshState, todayIST, SESSION } = require('./helpers');

const N_VENDORS = Number(process.env.LOAD_VENDORS) || 100;
const N_ORDERS  = Number(process.env.LOAD_ORDERS)  || 100;
const MEALS = ['breakfast', 'lunch', 'dinner'];
const AREAS = ['Gota', 'Chandkheda', 'Vastrapur', 'Bopal', 'SG Highway'];

function seedOrder(state, over = {}) {
  const row = state.nextRow++;
  state.orders.push(Object.assign({
    row, deliveryDate: todayIST(0), meal: 'lunch', phone: '9876500000',
    name: 'Load User', society: 'Vrindavan', flat: 'D-1',
    status: 'Pending', mealStatus: { lunch: 'Pending' },
    total: '₹90', payment: 'COD', paymentStatus: 'Unpaid',
    breakfastQty: 0, lunchQty: 1, dinnerQty: 0,
    lunchSabzi: 'Dal Tadka', lunchTiffin: '1 Full Tiffin', lunchRoti: 'Plain',
    lunchAddons: 'None', lunchTimeSlot: '12–1 PM', dinnerSabzi: '', dinnerTiffin: '',
    dinnerRoti: '', dinnerAddons: 'None', note: '', promo: '', deliveryType: 'home',
    time: '01/01 10:00 AM', day: 'Monday', createdIso: new Date().toISOString().slice(0, 16),
  }, over));
  return row;
}

test.describe('Discovery — many vendors', () => {
  test(`${N_VENDORS} vendors discovery page pe lag ke bina render hote hain`, async ({ page }) => {
    const state = freshState();
    state.discoveryVendors = Array.from({ length: N_VENDORS }, (_, i) => ({
      vendorId: 'kitchen' + i,
      name: 'Kitchen ' + i,
      cuisine: i % 2 ? 'Gujarati' : 'Punjabi',
      areas: [AREAS[i % AREAS.length]],
      logo: '',
      minOrder: 100,
      ratingCount: i % 4,
      rating: 4.2,
    }));
    await openApp(page, { state, loggedIn: false });

    const t0 = Date.now();
    await page.evaluate(() => window.openDiscovery());
    // Sabse bada area group load karo taaki poora count mile
    await page.evaluate(() => {
      const areas = window.dscAreas || [];
      if (areas.length) {
        const biggest = areas.reduce((a, b) => (b.count > a.count ? b : a));
        window.pickDscArea(biggest.area);
      }
    });
    const expectedInBiggestArea = Math.ceil(N_VENDORS / AREAS.length);
    await page.waitForFunction(
      (want) => document.querySelectorAll('#dscList .kit').length >= want,
      expectedInBiggestArea,
      { timeout: 15000 },
    );
    const elapsed = Date.now() - t0;
    console.log(`Discovery render (${N_VENDORS} total vendors): ${elapsed}ms`);
    expect(elapsed).toBeLessThan(8000);

    // Errors ke bina render hona chahiye
    const count = await page.locator('#dscList .kit').count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Admin — many orders', () => {
  test(`${N_ORDERS} orders wali list admin panel bina atke khulti hai`, async ({ page }) => {
    const state = freshState();
    for (let i = 0; i < N_ORDERS; i++) {
      seedOrder(state, {
        phone: '98765' + String(i).padStart(5, '0'),
        name: 'Customer ' + i,
        meal: MEALS[i % 3],
        lunchQty: i % 3 === 1 ? 1 : 0,
        breakfastQty: i % 3 === 0 ? 1 : 0,
        dinnerQty: i % 3 === 2 ? 1 : 0,
      });
    }
    await openApp(page, { state });

    const t0 = Date.now();
    await adminLogin(page);
    await page.waitForFunction(
      (want) => document.querySelectorAll('#ordersList .oc').length >= want,
      N_ORDERS,
      { timeout: 15000 },
    );
    const elapsed = Date.now() - t0;
    console.log(`Admin login + ${N_ORDERS}-order render: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(10000);

    await expect(page.locator('#ordersList .oc')).toHaveCount(N_ORDERS);
    // Kitchen summary bhi bina crash render hui ho (stuck "Loading..." nahi)
    await expect(page.locator('#kitchenSummary')).not.toContainText('Loading...');
  });
});

test.describe('Concurrent order throughput (mocked backend)', () => {
  test(`${N_ORDERS} concurrent order submissions sab succeed hote hain`, async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });

    const t0 = Date.now();
    const outcomes = await page.evaluate(async ({ n, token }) => {
      const MEALS_ = ['breakfast', 'lunch', 'dinner'];
      const jobs = [];
      for (let i = 0; i < n; i++) {
        const meal = MEALS_[i % 3];
        // Har (dateOffset, meal) combo sirf EK baar aata hai — is-phone-ke-liye
        // "1 order per date+meal" mock rule se kabhi collide nahi karega,
        // chaahe N kitna bhi bada ho.
        const dateOffset = Math.floor(i / 3);
        const d = new Date();
        d.setDate(d.getDate() + dateOffset);
        const dd = d.toISOString().slice(0, 10);
        const payload = {
          action: 'order', token, deliveryDate: dd, deliveryLabel: dd, day: 'Monday',
          society: 'Vrindavan', flatNo: 'D-' + i, deliveryType: 'home',
          name: 'Load User ' + i, note: '', payment: 'COD',
          items: [{ meal, tiffinType: 'full', qty: 1 }],
        };
        payload[meal + 'Qty'] = 1;
        jobs.push(window.apiPost(payload));
      }
      const results = await Promise.all(jobs);
      return results.map((r) => r.status);
    }, { n: N_ORDERS, token: SESSION.token });
    const elapsed = Date.now() - t0;

    const succeeded = outcomes.filter((s) => s === 'success').length;
    const failed = outcomes.filter((s) => s !== 'success');
    console.log(`${N_ORDERS} concurrent orders: ${succeeded} succeeded in ${elapsed}ms`
      + (failed.length ? ` (non-success statuses: ${[...new Set(failed)].join(', ')})` : ''));

    expect(succeeded).toBe(N_ORDERS);
    expect(state.orders.length).toBe(N_ORDERS);
  });
});
