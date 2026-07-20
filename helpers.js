/**
 * Shared helpers — har test yahi se app kholta hai.
 *
 * Backend (Google Apps Script) ko test me HIT NAHI karte:
 *   • test deterministic rehta hai (asli data badalta rehta hai)
 *   • offline bhi chalta hai
 *   • asli orders/sheet kabhi ganda nahi hota
 */
const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

const today = (off = 0) => {
  const d = new Date(Date.now() + off * 864e5);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const CONFIG = {
  prices: { breakfast:110, lunch:180, dinner:160, tiffinMini:120,
            extraRotiPlain:10, extraRotiButter:14, dahi:15, extraSabzi:20, deliveryFee:10 },
  township:'Godrej Garden City', societies:['Vrindavan','Eden'],
  closedDates:[], capacity:{ breakfast:25, lunch:25, dinner:25 },
  homeEnabled:true, officeEnabled:true,
  companies:[{ name:'Thomson Reuters', building:'West Gate', fee:10 }],
  upiId:'', upiName:'Nest & Nosh', fssai:'', whatsappAuto:true,
  mealsEnabled:{ breakfast:true, lunch:true, dinner:true },
  variants:{
    breakfast:[{ name:'Standard', price:110, items:['Poha','Chai'] }],
    lunch:[{ name:'Mini Tiffin', price:120, items:['Roti (4)','1 Sabzi'] },
           { name:'Full Tiffin', price:180, items:['Roti (5)','1 Sabzi','Daal','Chawal'] }],
    dinner:[{ name:'Mini Tiffin', price:120, items:['Roti (4)','1 Sabzi'] },
            { name:'Full Tiffin', price:160, items:['Roti (5)','1 Sabzi'] }],
  },
};

const DAY = { lunchSabzi:['Paneer Butter Masala','Dal Tadka'], dinnerSabzi:['Aloo Gobi','Chole'] };
const MENU = { monday:DAY, tuesday:DAY, wednesday:DAY, thursday:DAY,
               friday:DAY, saturday:DAY, sunday:DAY };

const ORDERS = [{
  row:2, deliveryDate:today(1), status:'Pending',
  lunchQty:1, lunchSabzi:'Paneer Butter Masala', lunchTiffin:'Mini Tiffin',
  lunchRoti:'Plain', lunchTimeSlot:'12–1 PM',
  total:'₹130', payment:'UPI', society:'Vrindavan', flat:'D-708', name:'Test User',
}];

/** Saare network calls stub kar deta hai — asli backend kabhi call nahi hota. */
async function stubBackend(page, overrides = {}) {
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();

    if (url.includes('script.google.com')) {
      const action = (new URL(url).searchParams.get('action') || '').toLowerCase();
      const map = {
        bootstrap  : { status:'success', menu:MENU, config:CONFIG, promos:[] },
        menu       : { status:'success', menu:MENU },
        config     : { status:'success', config:CONFIG },
        myorders   : { status:'success', orders:ORDERS },
        me         : { status:'success', name:'Test User' },
        publicstats: { status:'success', stats:{} },
        mysub      : { status:'success', sub:null },
      };
      const body = overrides[action] || map[action] || { status:'success' };
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) });
    }
    // Google fonts / GSI / maps — network nahi chahiye
    return route.fulfill({ status:200, contentType:'text/plain', body:'' });
  });
}

/** Logged-in user ke saath app kholta hai + console errors collect karta hai. */
async function openApp(page, { loggedIn = true, theme = 'light' } = {}) {
  const errors = [];
  page.on('console',  m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('JS ERROR: ' + e.message));

  await stubBackend(page);

  if (loggedIn) {
    await page.addInitScript(() => {
      localStorage.setItem('fbt_session', JSON.stringify(
        { token:'test-token', name:'Test User', phone:'9737945464' }));
      localStorage.setItem('fbt_addr', JSON.stringify({ society:'Vrindavan', flatNo:'D-708' }));
    });
  }

  await page.goto(APP_URL);
  await page.waitForTimeout(2000);                    // boot loader + bootstrap
  await setTheme(page, theme);
  return errors;
}

async function setTheme(page, theme) {
  await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(200);
}

/** Bottom nav se navigate karo — bilkul jaise user karta hai. */
async function goTo(page, tab) {
  await page.click(`#bn-${tab}`);
  await page.waitForTimeout(600);
}

module.exports = { APP_URL, CONFIG, MENU, ORDERS, today, stubBackend, openApp, setTheme, goTo };
