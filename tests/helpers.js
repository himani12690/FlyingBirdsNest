const { CONFIG, MENU, PROMOS, SESSION } = require('./fixtures');

const APP_URL = process.env.APP_URL || 'https://himani12690.github.io/';
const SCRIPT_HOST = 'script.google.com';

// ── Mutable server state — har test se pehle reset ──
function freshState() {
  return {
    orders: [],        // { row, deliveryDate, meal, status, total, phone }
    users: [{ phone:'9876543210', name:'Test User', email:'t@test.com',
              created:'01 Jan 25', lastLogin:'01 Jan 25', status:'Active', orders:0 }],
    promos: [{ row:2, code:'WELCOME50', type:'FLAT', value:50, maxDiscount:0, minOrder:0,
               firstOnly:true, perUser:1, totalLimit:0, expiry:'', active:true,
               visible:true, used:0 }],
    vendors: [{ vendorId:'nestandnosh', name:'Nest & Nosh', sheetId:'SHEET1',
                notifyEmail:'a@b.com', status:'Active', isDefault:true }],
    config: JSON.parse(JSON.stringify(CONFIG)),
    menu: JSON.parse(JSON.stringify(MENU)),
    nextRow: 2,
    calls: []          // audit trail — tests isse assert karte hain
  };
}

function todayIST(offset = 0) {
  const n = new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Kolkata' }));
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

// GET handler — bootstrap/config/menu/myorders/mysub/me/publicstats
function handleGet(state, url) {
  const action = (url.searchParams.get('action') || '').toLowerCase();
  const token  = url.searchParams.get('token');

  if (action === 'bootstrap')
    return { status:'success', menu:state.menu, config:state.config,
             promos: state.promos.filter(p => p.active && p.visible)
                       .map(p => ({ code:p.code, label:'₹'+p.value+' off',
                                    minOrder:p.minOrder, firstOnly:p.firstOnly })) };
  if (action === 'config') return { status:'success', config:state.config };
  if (action === 'menu')   return { status:'success', menu:state.menu };
  if (action === 'publicstats')
    return { status:'success', stats:{ date:url.searchParams.get('date'),
             totalCustomers:42,
             breakfast:{ordered:0,preparing:0,delivered:0},
             lunch:{ordered:3,preparing:1,delivered:0},
             dinner:{ordered:2,preparing:0,delivered:0} } };

  if (action === 'me')
    return token === SESSION.token
      ? { status:'success', name:SESSION.name, phone:SESSION.phone, email:'t@test.com' }
      : { status:'invalid_session' };

  if (action === 'myorders') {
    if (token !== SESSION.token) return { status:'invalid_session' };
    const date = url.searchParams.get('date');
    let out = state.orders.filter(o => o.phone === SESSION.phone);
    out = date ? out.filter(o => o.deliveryDate === date)
               : out.filter(o => o.deliveryDate >= todayIST(0));
    return { status:'success', orders: out };
  }

  if (action === 'mysub')
    return token === SESSION.token ? { status:'success', sub:null }
                                   : { status:'invalid_session' };

  return { status:'success' };
}

// POST handler — orders, admin CRUD, promo, superadmin
function handlePost(state, body) {
  const p = body || {};
  const action = (p.action || '').toLowerCase();
  state.calls.push({ action, payload: p });

  const adminOK  = p.user === 'demo' && p.pass === 'demo123';
  const superOK  = p.user === 'yuvraj_owner' && p.pass === 'ChangeThisSuperPassword!123';
  const denied   = { status:'error', message:'Invalid credentials' };

  // ── Super admin ──
  if (action === 'listvendors') return superOK ? { status:'success', vendors:state.vendors } : denied;
  if (action === 'savevendor') {
    if (!superOK) return denied;
    const id = String(p.vendorId || '').trim().toLowerCase();
    if (!id) return { status:'error', message:'Vendor ID zaroori hai' };
    if (!/^[a-z0-9]+$/.test(id)) return { status:'error', message:'Slug galat hai' };
    if (id === 'nestandnosh') return { status:'error', message:'default vendor ka slug hai' };
    if (!p.sheetId || !p.adminUser || !p.adminPass)
      return { status:'error', message:'Sheet ID, Admin Username aur Password zaroori hain' };
    if (state.vendors.some(v => v.sheetId === p.sheetId))
      return { status:'error', message:'Ye Sheet pehle se kisi vendor ke paas hai' };
    state.vendors.push({ vendorId:id, name:p.name || id, sheetId:p.sheetId,
                         notifyEmail:p.notifyEmail || '', status:'Active', isDefault:false });
    return { status:'success', vendors:state.vendors };
  }

  // ── Customer session ──
  if (action === 'emaillogin')
    return p.email && p.password === 'correct-pw'
      ? { status:'success', ...SESSION }
      : { status:'error', code:'wrong_pw', message:'Incorrect password.' };
  if (action === 'demologin') return { status:'success', ...SESSION };
  if (action === 'logout')    return { status:'success' };

  // ── Promo ──
  if (action === 'checkpromo') {
    if (p.token !== SESSION.token) return { status:'invalid_session' };
    const pr = state.promos.find(x =>
      x.code === String(p.code || '').trim().toUpperCase() && x.active);
    if (!pr) return { status:'error', message:'Invalid coupon code' };
    const amt = parseInt(p.amount, 10) || 0;
    if (amt < pr.minOrder)
      return { status:'error', message:'Minimum order of ₹'+pr.minOrder+' required' };
    if (pr.firstOnly && state.orders.some(o => o.status !== 'Cancelled'))
      return { status:'error', message:'valid only on your first order' };
    let d = pr.type === 'PERCENT' ? Math.floor(amt * pr.value / 100) : pr.value;
    if (pr.type === 'PERCENT' && pr.maxDiscount) d = Math.min(d, pr.maxDiscount);
    d = Math.max(0, Math.min(d, amt));
    return { status:'success', discount:d, code:pr.code, label:'₹'+pr.value+' off' };
  }
  if (action === 'getpromos')  return adminOK ? { status:'success', promos:state.promos } : denied;
  if (action === 'savepromo') {
    if (!adminOK) return denied;
    const code = String(p.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return { status:'error', message:'Code required' };
    const ex = state.promos.find(x => x.code === code);
    const rec = { row: ex ? ex.row : state.promos.length + 2, code,
      type: p.type === 'PERCENT' ? 'PERCENT' : 'FLAT',
      value: Math.max(1, parseInt(p.value, 10) || 0),
      maxDiscount: parseInt(p.maxDiscount, 10) || 0,
      minOrder: parseInt(p.minOrder, 10) || 0,
      firstOnly: p.firstOnly === '1', perUser: Math.max(1, parseInt(p.perUser, 10) || 1),
      totalLimit: parseInt(p.totalLimit, 10) || 0, expiry: p.expiry || '',
      active: p.active === '1', visible: p.visible === '1', used: ex ? ex.used : 0 };
    if (ex) Object.assign(ex, rec); else state.promos.push(rec);
    return { status:'success', promos:state.promos };
  }
  if (action === 'deletepromo') {
    if (!adminOK) return denied;
    state.promos = state.promos.filter(x => x.code !== String(p.code).toUpperCase());
    return { status:'success', promos:state.promos };
  }

  // ── Admin reads ──
  if (action === 'stats') {
    if (!adminOK) return denied;
    const live = state.orders.filter(o => o.status !== 'Cancelled');
    const rev = live.reduce((s,o) => s + (parseInt(String(o.total).replace(/\D/g,''),10)||0), 0);
    return { status:'success',
      today:{ count:live.filter(o=>o.deliveryDate===todayIST(0)).length, revenue:rev },
      week:{ count:live.length, revenue:rev },
      total:{ count:live.length, revenue:rev },
      recent: live.slice(-10).reverse() };
  }
  if (action === 'orders') {
    if (!adminOK) return denied;
    const d = p.date || todayIST(0);
    return { status:'success', orders: state.orders.filter(o => o.deliveryDate === d) };
  }
  if (action === 'users')     return adminOK ? { status:'success', users:state.users } : denied;
  if (action === 'lastorder')
    return adminOK ? { status:'success', lastRow: state.nextRow - 1, latest:null } : denied;

  // ── Admin writes ──
  if (action === 'setstatus') {
    if (!adminOK) return denied;
    const o = state.orders.find(x => x.row === parseInt(p.row, 10));
    if (!o) return { status:'error', message:'Invalid row' };
    if (['Pending','Preparing','Delivered'].indexOf(p.status) < 0)
      return { status:'error', message:'Invalid status' };
    o.status = p.status;
    o.mealStatus = { breakfast:p.status, lunch:p.status, dinner:p.status };
    return { status:'success' };
  }
  if (action === 'setmealstatus') {
    if (!adminOK) return denied;
    const o = state.orders.find(x => x.row === parseInt(p.row, 10));
    if (!o) return { status:'error', message:'Invalid row' };
    o.mealStatus = Object.assign({}, o.mealStatus, { [p.meal]: p.status });
    const active = ['breakfast','lunch','dinner'].filter(m => Number(o[m+'Qty']) > 0);
    const live = active.map(m => o.mealStatus[m]);
    o.status = live.every(s => s === 'Delivered') ? 'Delivered'
             : live.some(s => s === 'Preparing')  ? 'Preparing' : 'Pending';
    return { status:'success', mealStatus:o.mealStatus, orderStatus:o.status };
  }
  if (action === 'setstatusbulk') {
    if (!adminOK) return denied;
    const rows = (p.rows || []).map(Number);
    state.orders.forEach(o => { if (rows.includes(o.row)) o.status = p.status; });
    return { status:'success', updated: rows.length, statusVal: p.status };
  }
  if (action === 'setpaid') {
    if (!adminOK) return denied;
    const o = state.orders.find(x => x.row === parseInt(p.row, 10));
    if (!o) return { status:'error', message:'Order not found' };
    o.paymentStatus = String(p.paid) === '1' ? 'Paid' : 'Unpaid';
    return { status:'success', paymentStatus:o.paymentStatus };
  }
  if (action === 'setuserstatus') {
    if (!adminOK) return denied;
    const u = state.users.find(x => x.phone === p.phone);
    if (!u) return { status:'error', message:'User not found.' };
    u.status = p.status;
    return { status:'success' };
  }
  if (action === 'resetuser') {
    if (!adminOK) return denied;
    const before = state.orders.length;
    state.orders = state.orders.filter(o => o.phone !== p.phone);
    state.users  = state.users.filter(u => u.phone !== p.phone);
    return { status:'success', counts:{ orders: before - state.orders.length,
             sessions:1, subs:0, promoUses:0, user:1 } };
  }
  if (action === 'savemenu')   { if (!adminOK) return denied; state.menu = p.menu; return { status:'success' }; }
  if (action === 'saveconfig') {
    if (!adminOK) return denied;
    Object.assign(state.config, p.config);
    return { status:'success' };
  }
  if (action === 'savevariants') {
    if (!adminOK) return denied;
    state.config.variants = p.variants;
    return { status:'success', variants:p.variants, banners:p.banners };
  }
  if (action === 'uploadimage')
    return adminOK ? { status:'success', url:'https://example.test/img.jpg', id:'x1' } : denied;

  // ── Customer order + cancel ──
  if (action === 'cancelorder') {
    if (p.token !== SESSION.token) return { status:'invalid_session' };
    const o = state.orders.find(x => x.row === parseInt(p.row, 10));
    if (!o) return { status:'error', message:'Invalid order' };
    if (o.status === 'Cancelled')
      return { status:'error', code:'already_cancelled', message:'already cancelled' };
    o.status = 'Cancelled';
    return { status:'success' };
  }

  // Default = place order
  if (p.token !== SESSION.token) return { status:'invalid_session' };
  const meal = ['breakfast','lunch','dinner'].find(m => Number(p[m+'Qty']) > 0);
  if (!meal) return { status:'error', code:'no_meal', message:'Your order is empty' };
  if (Number(p[meal+'Qty']) > 1)
    return { status:'error', code:'qty_limit', message:'1 tiffin per meal per day' };
  if (state.orders.some(o => o.deliveryDate === p.deliveryDate &&
        o.meal === meal && o.status !== 'Cancelled' && o.phone === SESSION.phone))
    return { status:'duplicate', code:'dup_date', message:'You already have an order for this date.' };

  // Server-side total — client ke total pe bharosa nahi
  const V = state.config.variants, PR = state.config.prices;
  let subtotal = 0;
  (p.items || []).forEach(it => {
    const list = V[it.meal] || [];
    const v = list.find(x => x.id === it.tiffinType) || list[0];
    let unit = v.price;
    if (it.meal !== 'breakfast') {
      unit += (it.extraRoti || 0) * (it.butterRoti ? PR.extraRotiButter : PR.extraRotiPlain);
      if (it.dahi) unit += PR.dahi;
      if (it.extraSabzi) unit += PR.extraSabzi;
    }
    subtotal += unit * (it.qty || 1);
  });
  const sameDate = state.orders.some(o => o.deliveryDate === p.deliveryDate &&
                                          o.status !== 'Cancelled' && o.phone === SESSION.phone);
  const fee = sameDate ? 0
    : (state.config.farSocieties.includes(p.society) ? state.config.deliveryFar
                                                     : state.config.deliveryNear);
  let total = subtotal + fee;

  let promoStr = '', couponRejected = '';
  if (p.applyCoupon === '1' && p.couponCode) {
    const pr = state.promos.find(x => x.code === String(p.couponCode).toUpperCase() && x.active);
    if (!pr) couponRejected = 'Invalid coupon code';
    else if (pr.firstOnly && state.orders.some(o => o.status !== 'Cancelled'))
      couponRejected = 'valid only on your first order';
    else {
      const d = Math.min(pr.type === 'PERCENT'
        ? Math.floor(total * pr.value / 100) : pr.value, total);
      total -= d;
      promoStr = pr.code + ' −₹' + d;
      pr.used++;
    }
  }

  const row = state.nextRow++;
  state.orders.push({
    row, deliveryDate:p.deliveryDate, meal, phone:SESSION.phone,
    name:p.name, society:p.society, flat:p.flatNo,
    status:'Pending', mealStatus:{ [meal]:'Pending' },
    total:'₹'+total, payment:p.payment, paymentStatus:'Unpaid', promo:promoStr,
    breakfastQty: Number(p.breakfastQty)||0,
    lunchQty: Number(p.lunchQty)||0,
    dinnerQty: Number(p.dinnerQty)||0,
    lunchSabzi:p.lunchSabzi||'', dinnerSabzi:p.dinnerSabzi||'',
    lunchTiffin:p.lunchTiffin||'', dinnerTiffin:p.dinnerTiffin||'',
    lunchRoti:p.lunchRoti||'', dinnerRoti:p.dinnerRoti||'',
    lunchAddons:p.lunchAddons||'None', dinnerAddons:p.dinnerAddons||'None',
    lunchTimeSlot:p.lunchTimeSlot||'', dinnerTimeSlot:p.dinnerTimeSlot||'',
    breakfastTimeSlot:p.breakfastTimeSlot||'',
    note:p.note||'', deliveryType:p.deliveryType||'home',
    time:'01/01 10:00 AM', day:p.day||'', createdIso:new Date().toISOString().slice(0,16)
  });
  return { status:'success', total, promo:promoStr, couponRejected };
}

// ── Mock install ──
async function mockBackend(page, state) {
  await page.route(url => url.hostname === SCRIPT_HOST, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let payload;
    if (req.method() === 'POST') {
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
      payload = handlePost(state, body);
    } else {
      payload = handleGet(state, url);
    }
    await route.fulfill({ status:200, contentType:'application/json',
                          body: JSON.stringify(payload) });
  });
  // Google Sign-In script — network se mat lao
  await page.route('**/gsi/client', r =>
    r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  // QR image
  await page.route('**/api.qrserver.com/**', r =>
    r.fulfill({ status:200, contentType:'image/png', body:'' }));
}

// ── App open karo (guest ya logged-in) ──
async function openApp(page, opts = {}) {
  const state = opts.state || freshState();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await mockBackend(page, state);

  await page.addInitScript(({ session, theme, loggedIn, addr }) => {
    if (loggedIn) localStorage.setItem('fbt_session', JSON.stringify(session));
    if (theme) localStorage.setItem('fbt_theme', JSON.stringify(theme));
    if (addr)  localStorage.setItem('fbt_addr', JSON.stringify(addr));
    localStorage.setItem('fbt_infostrip_x', JSON.stringify(1));
  }, { session:SESSION, theme:opts.theme,
       loggedIn: opts.loggedIn !== false,
       addr: opts.addr || { deliveryType:'home', society:'Vrindavan', flatNo:'D-706' } });

  await page.goto(opts.url || APP_URL);
  await page.waitForSelector('#bootLoader.gone', { timeout:15000 }).catch(() => {});
  return { errors, state };
}

async function setTheme(page, theme) {
  await page.evaluate(t => window.setTheme(t), theme);
  await page.waitForTimeout(150);
}

async function goTo(page, tab) {
  await page.evaluate(t => window.navTo(t), tab);
  await page.waitForTimeout(250);
}

async function adminLogin(page, user = 'demo', pass = 'demo123') {
  await page.evaluate(() => window.showAdminLogin());
  await page.fill('#adminUser', user);
  await page.fill('#adminPass', pass);
  await page.click('#loginBtn');
  await page.waitForTimeout(400);
}

async function superLogin(page, user = 'yuvraj_owner', pass = 'ChangeThisSuperPassword!123') {
  await page.evaluate(() => window.showView('superLogin'));
  await page.fill('#superUser', user);
  await page.fill('#superPass', pass);
  await page.click('#superLoginBtn');
  await page.waitForTimeout(400);
}

module.exports = { openApp, setTheme, goTo, adminLogin, superLogin,
                   freshState, todayIST, APP_URL, SESSION };
