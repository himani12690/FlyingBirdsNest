// ═══════════════════════════════════════════════════════
// FLYING BIRDS TIFFIN — Backend v7 (Google Sign-In + i18n + Dynamic Config + Cart)
// Naya: Google Sign-In login (no OTP/SMS) | Users/Sessions/Audit sheets
//       Token-secured APIs | Server-side validation
// ═══════════════════════════════════════════════════════

// NOTIFY_EMAIL / Telegram bot token/chat ID — ab har vendor ka apna hota hai,
// neeche VENDORS registry mein set karo (notifyEmail / tgBotToken / tgChatId).
// Setup: @BotFather se bot banao → token VENDORS mein daalo → bot ko "hi" bhejo →
// getTelegramChatId('vendorId') Run karo → jo chat ID mile wahi tgChatId mein paste karo.
// Dono khaali chhodoge to us vendor ke Telegram alerts band rahenge (email chalta rahega).

// Standalone script (not created via Sheet's Extensions menu) has no "active"
// spreadsheet, so getActiveSpreadsheet() returns null. We open it explicitly
// by ID instead — works regardless of how/where the script runs.
const SHEET_ID = '1T6tTy_I-C8VH8JKOsB8wyUW7h1NgbPmy0eFjCrmMGPo';

// ═══════════ SECRETS — code me NAHI, Script Properties me ═══════════
// ⚠️ Ye file kabhi public repo me commit mat karna. Secrets ab Apps Script ke
// Script Properties me rehte hain (Project Settings → Script Properties).
//
// Ek baar setup: neeche setupSecrets() ko apni values ke saath edit karke Run karo,
// PHIR usme se values hata do. Ya seedha UI se add karo — ye keys chahiye:
//   SUPER_ADMIN_USER, SUPER_ADMIN_PASS, PASSWORD_PEPPER,
//   GEMINI_API_KEY, TG_BOT_TOKEN, TG_CHAT_ID, ADMIN_USER, ADMIN_PASS
function secret(key, fallback) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    if (v) return v;
  } catch (e) {}
  return fallback === undefined ? '' : fallback;
}
// Ek baar chalane ke liye — apni values daalo, Run karo, phir values hata do
function setupSecrets() {
  PropertiesService.getScriptProperties().setProperties({
    SUPER_ADMIN_USER : 'PASTE_KARO',
    SUPER_ADMIN_PASS : 'PASTE_KARO',
    PASSWORD_PEPPER  : 'PASTE_KARO',
    GEMINI_API_KEY   : 'PASTE_KARO',
    TG_BOT_TOKEN     : 'PASTE_KARO',
    TG_CHAT_ID       : 'PASTE_KARO',
    ADMIN_USER       : 'PASTE_KARO',
    ADMIN_PASS       : 'PASTE_KARO'
  }, false);
  Logger.log('✅ Secrets save ho gaye — ab upar wali values code se hata do');
}

// ═══════════ MULTI-TENANT: VENDOR REGISTRY ═══════════
// Default vendor (tumhara, Nest & Nosh) yahan hardcoded hai — kabhi Sheet se depend
// nahi karta, isliye ye bilkul kabhi na toote. Naye vendors "Vendors" tab mein
// (default vendor ki Sheet mein hi) store hote hain — Super Admin panel se add hote
// hain, koi code-edit/redeploy nahi karna padta.
const DEFAULT_VENDOR_ID = 'nestandnosh';
const VENDORS_SEED = {
  nestandnosh: {
    name: 'Nest & Nosh',
    sheetId: SHEET_ID,
    adminUser: secret('ADMIN_USER'),
    adminPass: secret('ADMIN_PASS'),
    notifyEmail: 'himani12690@gmail.com',
    tgBotToken: secret('TG_BOT_TOKEN'),
    tgChatId: secret('TG_CHAT_ID'),
    status: 'Active'
  }
};
const VENDORS_SHEET = 'Vendors';
// Registry hamesha DEFAULT vendor ki Sheet mein rehti hai — chahe abhi koi bhi
// vendor "current" ho, "Vendors" tab dhundhne ke liye hamesha yehi Sheet khulti hai.
function getMasterSS() { return SpreadsheetApp.openById(SHEET_ID); }
function vendorsSheet() {
  return sheetWithHeaders(VENDORS_SHEET,
    ['VendorId','Name','SheetId','AdminUser','AdminPassHash','NotifyEmail','TgBotToken','TgChatId','WhatsApp','Status','Created','AdminSalt','ScriptUrl','Areas','Cuisine','Logo','RatingSum','RatingCount','MinOrder'],
    getMasterSS());
}
// Vendors registry ko CacheService mein rakhte hain (60 sec) — Apps Script ki har
// "execution" alag hoti hai, isliye plain JS variable cache ka koi fayda nahi tha;
// har request pe Vendors Sheet khulti thi (extra ~1-2 sec latency, SABHI actions pe,
// including subscription page). CacheService bahut fast hai aur executions ke beech
// bhi share hota hai — yehi asli fix hai.
const VENDORS_CACHE_KEY = 'fbt_vendors_registry_v1';
function resetVendorsCache() { try{ CacheService.getScriptCache().remove(VENDORS_CACHE_KEY); }catch(e){} }
function loadVendors() {
  try {
    const cached = CacheService.getScriptCache().get(VENDORS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* cache miss ya error — neeche se fresh padh lo */ }
  const reg = {};
  Object.keys(VENDORS_SEED).forEach(function(k){ reg[k] = VENDORS_SEED[k]; });
  try {
    const sh = vendorsSheet();
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const rows = sh.getRange(2, 1, lr - 1, 19).getValues();
      rows.forEach(function(r){
        const id = String(r[0] || '').trim().toLowerCase();
        if (!id || id === DEFAULT_VENDOR_ID) return;   // default hardcoded hi rehta hai, Sheet se override nahi
        reg[id] = {
          name: r[1] || id, sheetId: r[2], adminUser: r[3], adminPassHash: r[4], adminSalt: r[11] || '',
          notifyEmail: r[5] || '', tgBotToken: r[6] || '', tgChatId: r[7] || '',
          whatsapp: r[8] || '', status: r[9] || 'Active', scriptUrl: r[12] || '',
          areas: String(r[13] || ''), cuisine: String(r[14] || ''), logo: String(r[15] || ''),
          ratingSum: Number(r[16]) || 0, ratingCount: Number(r[17]) || 0, minOrder: Number(r[18]) || 0
        };
      });
    }
  } catch (e) { /* master sheet read fail ho to bhi default vendor chalta rahe */ }
  try { CacheService.getScriptCache().put(VENDORS_CACHE_KEY, JSON.stringify(reg), 60); } catch (e) {}
  return reg;
}
// Ek request ke lifetime mein resolve hone wala "current vendor" — sab jagah isi se
// Sheet/admin-creds/notification uthate hain. Unknown/blank vendorId → default vendor
// (isse purane links/behavior kabhi nahi tootenge).
let CURRENT_VENDOR_ID = DEFAULT_VENDOR_ID;
// ⚠️ Inactive vendor ko pehle DEFAULT_VENDOR_ID pe bhej diya jaata tha — matlab
// us vendor ke customer ka link kholne par unhe DEFAULT VENDOR ka menu/orders
// dikhne lagte the. Ab inactive vendor apni hi id rakhta hai aur request
// saaf-saaf block hoti hai (neeche vendorBlocked() se).
function resolveVendor(vendorId) {
  const id = String(vendorId || '').trim().toLowerCase();
  const reg = loadVendors();
  return (id && reg[id]) ? id : DEFAULT_VENDOR_ID;
}
function vendorBlocked() {
  const v = currentVendor();
  return !!(v && String(v.status || 'Active') === 'Inactive');
}
function currentVendor() { const reg = loadVendors(); return reg[CURRENT_VENDOR_ID] || reg[DEFAULT_VENDOR_ID]; }
function getSS() { return SpreadsheetApp.openById(currentVendor().sheetId); }

// ═══════════ AI HELP ASSISTANT (Gemini free tier) ═══════════
// Setup: https://aistudio.google.com/apikey → API key banao → yahan paste karo.
// Khaali chhodoge to AI band rahega (rule-based jawab phir bhi chalte rahenge).
const GEMINI_API_KEY = secret('GEMINI_API_KEY');
// Ek model pe free quota na mile (429 "limit: 0") to agla try hota hai.
// Jo chal jaata hai wo 6 ghante cache ho jaata hai — har baar list nahi chalti.
// Ye naam tumhare account ki asli model list se liye hain (listAIModels ka output).
// LITE models pehle — inpe free quota milne ke chance sabse zyada hote hain.
const GEMINI_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite'
];
const GEMINI_MODEL   = GEMINI_MODELS[0];   // testAI/diagnostics ke liye
const AI_DAILY_LIMIT = 10;      // per user, per din — quota abuse se bachav

function aiRateKey(who){ return 'ai_' + CURRENT_VENDOR_ID + '_' + todayIST() + '_' + who; }
function aiCheckLimit(who) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get(aiRateKey(who)) || 0);
  if (n >= AI_DAILY_LIMIT) return false;
  c.put(aiRateKey(who), String(n + 1), 21600);   // 6 ghante cache (din bhar ke liye kaafi)
  return true;
}
// App ka apna data — AI sirf ISI se jawab dega, khud se menu/price invent nahi karega
function aiContext() {
  const cfg = readConfig(), menu = readMenu() || {};
  const day = Utilities.formatDate(new Date(), TZ, 'EEEE').toLowerCase();
  const d = menu[day] || {};
  const meals = [];
  ['breakfast','lunch','dinner'].forEach(function(m){
    if (cfg.mealsEnabled && cfg.mealsEnabled[m] === false) return;
    let item = '';
    try { item = (m === 'breakfast') ? String((d[m]||[])[0]||'') : String(((d[m]||{}).sabziOptions||[])[0]||''); } catch(e){}
    meals.push('- ' + m + ': ' + (item || 'not set') + ' | price Rs.' + ((cfg.prices||{})[m] || '?'));
  });
  return [
    'TODAY MENU (' + day + '):', meals.join('\n'),
    'DELIVERY SLOTS: breakfast 7-10 AM, lunch 12-2 PM, dinner 7-9 PM.',
    'ORDER CUTOFFS: breakfast by 10 PM previous night, lunch by 9 AM, dinner by 3 PM.',
    'DELIVERY AREAS: ' + ((cfg.societies||[]).join(', ') || 'not set'),
    'CONTACT: ' + OWNER_PHONE_DISPLAY
  ].join('\n');
}
const OWNER_PHONE_DISPLAY = '7043491481';
function askAI(p) {
  const q = String(p.q || '').trim().slice(0, 300);
  if (!q) return { status:'error' };
  if (!GEMINI_API_KEY) return { status:'error', message:'AI not configured' };

  // Rate limit — logged-in user ka phone, warna generic bucket
  let who = 'guest';
  try { const s = getSession(p.token); if (s && s.phone) who = s.phone; } catch(e){}
  if (!aiCheckLimit(who)) return { status:'limit' };

  const langName = ({en:'English', hi:'Hindi', gu:'Gujarati'})[p.lang] || 'Hinglish (Hindi written in English letters)';
  const sys = [
    'You are the friendly help assistant for "Nest & Nosh", a home-kitchen tiffin service in Ahmedabad, India.',
    'Answer ONLY using the DATA below. Never invent menu items, prices, timings or offers.',
    'If the answer is not in the DATA, say you are not sure and suggest calling ' + OWNER_PHONE_DISPLAY + '.',
    'You cannot create discounts, change prices, cancel orders or make promises on behalf of the kitchen.',
    'If the question is NOT about this tiffin service or its food, reply with exactly: OFFTOPIC',
    'Keep answers under 60 words. Be warm and simple. Reply in ' + langName + '.',
    '', 'DATA:', aiContext()
  ].join('\n');

  const payload = JSON.stringify({
    system_instruction: { parts: [{ text: sys }] },
    contents: [{ role:'user', parts: [{ text: q }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 220 }
  });
  const cache = CacheService.getScriptCache();
  const goodKey = 'ai_model_ok';
  const known = cache.get(goodKey);
  const order = known ? [known].concat(GEMINI_MODELS.filter(function(m){ return m !== known; })) : GEMINI_MODELS;

  let lastErr = '';
  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    try {
      const res = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY,
        { method:'post', contentType:'application/json', muteHttpExceptions:true, payload: payload });
      const code = res.getResponseCode();
      if (code !== 200) {
        lastErr = code + ' [' + model + '] ' + String(res.getContentText()).slice(0, 200);
        // 429/404 = is model pe quota/access nahi → agla model try karo
        if (code === 429 || code === 404 || code === 400) continue;
        break;
      }
      const j = JSON.parse(res.getContentText());
      let out = '';
      try { out = j.candidates[0].content.parts.map(function(x){ return x.text || ''; }).join('').trim(); } catch(e){}
      if (!out) { lastErr = 'empty [' + model + ']'; continue; }
      try { cache.put(goodKey, model, 21600); } catch(e){}   // jo chala use yaad rakho
      if (out.toUpperCase().indexOf('OFFTOPIC') === 0) return { status:'offtopic' };
      return { status:'success', answer: out };
    } catch (e) { lastErr = String(e).slice(0,150); }
  }
  audit('AI_FAIL', '', lastErr);
  Logger.log('Gemini: sab models fail — ' + lastErr);
  return { status:'error', detail: lastErr };
}

// ⚙️ DIAGNOSTIC — Apps Script editor me isko select karke ▶ Run karo.
// Execution log me exact problem dikhegi (key galat, model naam galat, permission, etc.)
function testAI() {
  if (!GEMINI_API_KEY) { Logger.log('❌ GEMINI_API_KEY khaali hai — key paste karo.'); return; }
  Logger.log('Key length: ' + GEMINI_API_KEY.length);
  let anyOk = false;
  GEMINI_MODELS.forEach(function(model){
    try {
      const res = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY,
        { method:'post', contentType:'application/json', muteHttpExceptions:true,
          payload: JSON.stringify({ contents: [{ role:'user', parts: [{ text:'Say OK' }] }] }) });
      const c = res.getResponseCode();
      if (c === 200) { anyOk = true; Logger.log('✅ ' + model + ' — CHAL RAHA HAI'); }
      else Logger.log('❌ ' + model + ' — HTTP ' + c + ' :: ' + res.getContentText().slice(0,160));
    } catch (e) { Logger.log('❌ ' + model + ' — ' + e); }
  });
  if (!anyOk) Logger.log('\n⚠️ Kisi bhi model pe free quota nahi. AI Studio me NAYA project bana ke NAYI key banao.');
}

// Kaunse model naam is key pe available hain — agar model-name galat ho to ye batayega
function listAIModels() {
  if (!GEMINI_API_KEY) { Logger.log('❌ Key khaali hai.'); return; }
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + GEMINI_API_KEY,
    { muteHttpExceptions:true });
  Logger.log('HTTP ' + res.getResponseCode());
  try {
    const j = JSON.parse(res.getContentText());
    (j.models || []).forEach(m => Logger.log(m.name));
  } catch (e) { Logger.log(res.getContentText().slice(0, 800)); }
}


// ═══════════════ DEMO MODE ═══════════════
// Naya vendor bina risk ke poora app try kar sake: apna alag sheet, fake data,
// aur ROZ AUTO-RESET. Koi bhi kuch bhi kare — agle din saaf.
// Setup: Super Admin panel se vendorId "demo" add karo (apna sheet + admin login),
// phir ⏰ Triggers me resetDemoDaily ko daily 3-4 AM pe laga do.
const DEMO_VENDOR_ID = 'demo';
function isDemo() { return CURRENT_VENDOR_ID === DEMO_VENDOR_ID; }

const DEMO_CUSTOMER = { phone:'9000000001', name:'Demo Customer', email:'demo@customer.test' };

// Demo customer bina password/OTP ke andar aa jaata hai — vendor ko signup
// jhelna na pade. Ye SIRF demo vendor pe kaam karta hai.
function demoLogin() {
  if (!isDemo()) return { status:'error', message:'Demo login sirf demo account pe hai' };
  const uSh = usersSheet();
  let r = findRowByPhone(uSh, DEMO_CUSTOMER.phone);
  if (r === -1) {
    uSh.appendRow(["'" + DEMO_CUSTOMER.phone, DEMO_CUSTOMER.name, DEMO_CUSTOMER.email,
                   new Date(), new Date(), 'Active', '', '', '', '']);
  } else {
    uSh.getRange(r, 5).setValue(new Date());
    uSh.getRange(r, 6).setValue('Active');
  }
  const token = Utilities.getUuid();
  sessionsSheet().appendRow([token, "'" + DEMO_CUSTOMER.phone, DEMO_CUSTOMER.email,
                             new Date(), new Date(Date.now() + 7 * 86400000)]);
  return { status:'success', token: token, name: DEMO_CUSTOMER.name, phone: DEMO_CUSTOMER.phone };
}

// Sheet ko seed data pe wapas le aata hai
function seedDemo() {
  const ss = getSS();
  ['Orders','Sessions','PromoUses'].forEach(function(n){
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  const uSh = ss.getSheetByName(USERS_SHEET);
  if (uSh && uSh.getLastRow() > 1) uSh.deleteRows(2, uSh.getLastRow() - 1);

  // Sample customers
  const users = [
    [DEMO_CUSTOMER.phone, DEMO_CUSTOMER.name, DEMO_CUSTOMER.email],
    ['9000000002','Priya Patel','priya@demo.test'],
    ['9000000003','Rahul Shah','rahul@demo.test'],
    ['9000000004','Harihar Enterprises','harihar@demo.test'],
    ['9000000005','Nikhil Joshi','nikhil@demo.test']
  ];
  users.forEach(function(u){
    uSh.appendRow(["'" + u[0], u[1], u[2], new Date(), new Date(), 'Active', '', '', '', '']);
  });

  // Sample orders — aaj ke, alag-alag status/meal/payment
  const oSh = ordersSheet();
  const today = todayIST();
  const socs = ['Vrindavan','Eden','Harihar'];
  const sabzi = ['Paneer Butter Masala','Aloo Gobi','Mix Veg','Dal Tadka'];
  const rows = [
    // [name, phone, soc, flat, bQty, lQty, lSabzi, dQty, dSabzi, pay, total, status]
    ['Priya Patel','9000000002',0,'D-708',0,1,0,0,-1,'UPI',200,'Pending'],
    ['Rahul Shah','9000000003',1,'A-204',0,2,1,0,-1,'COD',360,'Pending'],
    ['Harihar Enterprises','9000000004',2,'B-101',0,3,2,0,-1,'UPI',540,'Preparing'],
    ['Nikhil Joshi','9000000005',0,'C-302',1,0,-1,1,1,'COD',250,'Preparing'],
    ['Demo Customer','9000000001',0,'D-708',0,0,-1,2,3,'UPI',320,'Delivered'],
    ['Priya Patel','9000000002',1,'A-204',1,0,-1,1,0,'COD',250,'Delivered'],
    ['Rahul Shah','9000000003',0,'D-708',0,1,3,0,-1,'UPI',180,'Cancelled']
  ];
  rows.forEach(function(r){
    oSh.appendRow([
      new Date(), 'Monday', socs[r[2]], r[3], r[0], "'" + r[1],
      r[4],
      r[5], (r[6] >= 0 ? sabzi[r[6]] : ''), 'Plain', '',
      r[7], (r[8] >= 0 ? sabzi[r[8]] : ''), 'Plain', '',
      '', r[9], '₹' + r[10], r[11], "'" + today,
      '', (r[5] ? '12–1 PM' : ''), (r[7] ? '7–8 PM' : ''),
      (r[5] ? 'full' : ''), (r[7] ? 'full' : ''),
      (r[9] === 'UPI' ? 'Paid' : 'Unpaid'), '', 'home', ''
    ]);
  });
  audit('DEMO_SEEDED', '', rows.length + ' orders, ' + users.length + ' users');
  return { status:'success', orders: rows.length, users: users.length };
}

// ⏰ Trigger: daily 3-4 AM. Demo vendor ka data roz saaf.
function resetDemoDaily() {
  CURRENT_VENDOR_ID = DEMO_VENDOR_ID;
  if (!loadVendors()[DEMO_VENDOR_ID]) { Logger.log('demo vendor registry me nahi hai'); return; }
  try { seedDemo(); Logger.log('✅ Demo reset ho gaya'); }
  catch (e) { Logger.log('❌ Demo reset fail: ' + e); }
}
// Editor se manually chalane ke liye
function seedDemoNow() { resetDemoDaily(); }


// ═══════════ NAYE VENDOR KA SHEET AUTO-SETUP ═══════════
// Vendor add karte hi uska sheet apne aap taiyaar ho jaata hai — Orders, Users,
// Sessions, Config, Menu, Promos, Subs sab tabs headers ke saath ban jaate hain
// aur ek starter menu bhar jaata hai. Vendor ko BLANK sheet dena kaafi hai;
// copy karke purana data delete karne ki koi zaroorat nahi.
function starterMenu() {
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const sabzi = ['Aloo Gobi','Mix Veg','Dal Tadka','Paneer Butter Masala'];
  const bfast = ['Poha','Upma','Thepla','Idli','Paratha','Sandwich','Puri Bhaji'];
  const m = {};
  days.forEach(function(d, i){
    m[d] = {
      breakfast: [ bfast[i % bfast.length] ],
      lunch:  { sabziOptions: [ sabzi[i % sabzi.length], sabzi[(i+1) % sabzi.length] ] },
      dinner: { sabziOptions: [ sabzi[(i+2) % sabzi.length], sabzi[(i+3) % sabzi.length] ] }
    };
  });
  return m;
}

function provisionVendorSheet(sheetId) {
  const ss = SpreadsheetApp.openById(sheetId);   // galat ID ho to yahin throw hoga
  const mk = function(name, headers){ return sheetWithHeaders(name, headers, ss); };

  mk(ORDERS_SHEET, ['Timestamp','Day','Society','Flat','Name','Phone','Breakfast Qty',
    'Lunch Qty','Lunch Sabzi','Lunch Roti','Lunch Addons','Dinner Qty','Dinner Sabzi',
    'Dinner Roti','Dinner Addons','Note','Payment','Total','Status','Delivery Date',
    'Breakfast Time','Lunch Time','Dinner Time','Lunch Tiffin','Dinner Tiffin',
    'PaymentStatus','Promo','DeliveryType','Meal Status']);
  mk(USERS_SHEET,  ['Phone','Name','Email','Created','Last Login','Status','PasswordHash','Salt','ResetToken','ResetExpires']);
  mk(SESS_SHEET,   ['Token','Phone','Email','Created','Expires']);
  mk(AUDIT_SHEET,  ['Time','Phone','Action','Details']);
  mk('PromoUses',  ['Code','Phone','Date','OrderRow','Discount']);

  // Menu + Config ek-cell JSON tabs hain
  ['Menu','Config'].forEach(function(n){ if(!ss.getSheetByName(n)) ss.insertSheet(n); });
  const mSh = ss.getSheetByName(MENU_SHEET);
  if (!mSh.getRange(1,1).getValue()) {
    mSh.getRange(1,1).setValue(JSON.stringify(starterMenu()));
    mSh.getRange(2,1).setValue('⚠️ A1 manually edit mat karo — Admin panel se update karo.');
  }
  const cSh = ss.getSheetByName(CONFIG_SHEET);
  if (!cSh.getRange(1,1).getValue()) {
    cSh.getRange(1,1).setValue(JSON.stringify(defaultConfig()));
    cSh.getRange(2,1).setValue('⚠️ A1 manually edit mat karo — Admin → Setup se update karo.');
  }
  return true;
}


// ═══════════ DISCOVERY (marketplace) + RATINGS ═══════════
// Customer bina login ke apne area ki tiffin services dekh sake.
// ⚠️ Ye PUBLIC hai — sirf wahi bhejo jo sabko dikhna chahiye.
// Sheet ID, admin login, email — kabhi nahi.
function listAreas() {
  const reg = loadVendors(); const set = {};
  Object.keys(reg).forEach(function (id) {
    const v = reg[id];
    if (String(v.status || 'Active') === 'Inactive') return;
    String(v.areas || '').split(',').forEach(function (a) {
      const t = a.trim(); if (t) set[t] = (set[t] || 0) + 1;
    });
  });
  return Object.keys(set).sort().map(function (a) { return { area: a, count: set[a] }; });
}

function discoverVendors(area) {
  const want = String(area || '').trim().toLowerCase();
  const reg = loadVendors(); const out = [];
  Object.keys(reg).forEach(function (id) {
    const v = reg[id];
    if (String(v.status || 'Active') === 'Inactive') return;
    const areas = String(v.areas || '').split(',').map(function (a) { return a.trim(); }).filter(Boolean);
    if (want && areas.map(function (a) { return a.toLowerCase(); }).indexOf(want) === -1) return;
    out.push({
      vendorId: id,
      name: v.name || id,
      logo: v.logo || '',
      cuisine: String(v.cuisine || ''),
      areas: areas,
      minOrder: v.minOrder || 0,
      rating: v.ratingCount ? Math.round((v.ratingSum / v.ratingCount) * 10) / 10 : 0,
      ratingCount: v.ratingCount || 0
    });
  });
  // Zyada rating pehle; bina rating wale (naye) neeche
  out.sort(function (a, b) {
    if (!a.ratingCount && b.ratingCount) return 1;
    if (a.ratingCount && !b.ratingCount) return -1;
    return b.rating - a.rating;
  });
  return out;
}

function ratingsSheet() { return sheetWithHeaders('Ratings', ['Phone','Stars','Comment','OrderRow','Date']); }

// Rating sirf wahi de sakta hai jisne SACH ME order kiya ho aur wo DELIVERED ho —
// warna koi bhi fake review daal ke rating bigaad sakta hai.
function rateVendor(p) {
  const s = getSession(p.token);
  if (!s) return { status:'invalid_session' };
  const stars = parseInt(p.stars, 10);
  if (!(stars >= 1 && stars <= 5)) return { status:'error', message:'Rating 1 se 5 ke beech honi chahiye' };

  const oSh = ordersSheet(); const last = oSh.getLastRow();
  if (last < 2) return { status:'error', code:'no_order', message:'Pehle order kijiye, phir rating de sakte hain.' };
  const vals = oSh.getRange(2, 1, last - 1, STATUS_COL).getValues();
  let delivered = false;
  for (let i = 0; i < vals.length; i++) {
    if (cleanPhone(vals[i][5]) === s.phone && String(vals[i][STATUS_COL - 1]) === 'Delivered') { delivered = true; break; }
  }
  if (!delivered) return { status:'error', code:'no_order', message:'Rating sirf delivered order ke baad de sakte hain.' };

  const rSh = ratingsSheet(); const rl = rSh.getLastRow();
  let oldStars = 0, row = -1;
  if (rl >= 2) {
    const rv = rSh.getRange(2, 1, rl - 1, 2).getValues();
    for (let i = 0; i < rv.length; i++) {
      if (cleanPhone(rv[i][0]) === s.phone) { row = i + 2; oldStars = Number(rv[i][1]) || 0; break; }
    }
  }
  const rowVals = ["'" + s.phone, stars, safeCell(String(p.comment || '').slice(0, 200)), p.row || '', todayIST()];
  if (row > 0) rSh.getRange(row, 1, 1, 5).setValues([rowVals]);   // ek user = ek rating (update)
  else rSh.appendRow(rowVals);

  syncVendorRating(CURRENT_VENDOR_ID, stars - oldStars, row > 0 ? 0 : 1);
  audit('RATED', s.phone, stars + '★');
  return { status:'success', stars: stars };
}

// Vendor ki apni sheet me rating gayi — ab master registry me average update karo
function syncVendorRating(vendorId, sumDelta, countDelta) {
  try {
    const sh = vendorsSheet(); const lr = sh.getLastRow(); if (lr < 2) return;
    const ids = sh.getRange(2, 1, lr - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || '').trim().toLowerCase() === vendorId) {
        const r = i + 2;
        const sum = (Number(sh.getRange(r, 17).getValue()) || 0) + sumDelta;
        const cnt = (Number(sh.getRange(r, 18).getValue()) || 0) + countDelta;
        sh.getRange(r, 17).setValue(Math.max(0, sum));
        sh.getRange(r, 18).setValue(Math.max(0, cnt));
        resetVendorsCache();
        return;
      }
    }
  } catch (e) { /* rating sync fail ho to order flow kabhi na ruke */ }
}

// Customer ne rating di ya nahi — "Rate karo" prompt dikhane ke liye
function myRating(p) {
  const s = getSession(p.token); if (!s) return { status:'invalid_session' };
  const rSh = ratingsSheet(); const rl = rSh.getLastRow();
  if (rl < 2) return { status:'success', stars: 0 };
  const rv = rSh.getRange(2, 1, rl - 1, 2).getValues();
  for (let i = 0; i < rv.length; i++) {
    if (cleanPhone(rv[i][0]) === s.phone) return { status:'success', stars: Number(rv[i][1]) || 0 };
  }
  return { status:'success', stars: 0 };
}

// ═══════════ SUPER ADMIN (sirf platform owner — Yuvraj) ═══════════
// Ye kisi bhi vendor ke admin login se bilkul alag hai. Isse "Manage Vendors"
// panel access hota hai. ⚠️ Deploy se pehle password badal lena.
const SUPER_ADMIN_USER = secret('SUPER_ADMIN_USER');
const SUPER_ADMIN_PASS = secret('SUPER_ADMIN_PASS');
function superLocked() { const c = CacheService.getScriptCache(); return Number(c.get('superFails') || 0) >= 5; }
function superFail() { const c = CacheService.getScriptCache(); const n = Number(c.get('superFails') || 0) + 1; c.put('superFails', String(n), 900); }
function superPass() { CacheService.getScriptCache().remove('superFails'); }
function checkSuperAuth(u, p) {
  if (superLocked()) return false;
  const ok = (u === SUPER_ADMIN_USER && p === SUPER_ADMIN_PASS);
  if (ok) superPass(); else superFail();
  return ok;
}
function listVendorsForSuper() {
  const reg = loadVendors();
  return Object.keys(reg).map(function(id){
    const v = reg[id];
    return { vendorId:id, name:v.name || id, sheetId:v.sheetId || '', notifyEmail:v.notifyEmail || '',
      whatsapp:v.whatsapp || '', status:v.status || 'Active', scriptUrl:v.scriptUrl || '',
      areas:v.areas || '', cuisine:v.cuisine || '', logo:v.logo || '', minOrder:v.minOrder || 0,
      rating: v.ratingCount ? Math.round((v.ratingSum / v.ratingCount) * 10) / 10 : 0,
      ratingCount: v.ratingCount || 0, isDefault:(id === DEFAULT_VENDOR_ID) };
  });
}
function deleteVendor(p) {
  // 'slug' pehle — apiPost ka tenant vendorId form value kuchal deta hai (saveVendor jaisa hi).
  const id = String(p.slug || p.vendorId || '').trim().toLowerCase();
  if (!id) return { status:'error', message:'Vendor ID zaroori hai' };
  if (id === DEFAULT_VENDOR_ID) return { status:'error', message:'Default vendor delete nahi ho sakta' };
  const sh = vendorsSheet();
  const lr = sh.getLastRow();
  let removed = 0;
  if (lr >= 2) {
    const ids = sh.getRange(2, 1, lr - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0] || '').trim().toLowerCase() === id) { sh.deleteRow(i + 2); removed++; }
    }
  }
  resetVendorsCache();
  // ⚠️ Sirf registry se hatta hai — vendor ka Google Sheet aur uska data waisa hi
  // rehta hai (jaanbujh ke, taaki galti se kisi ka business data na ud jaye).
  audit('VENDOR_DELETED', '', id);
  return removed ? { status:'success', vendors: listVendorsForSuper() }
                 : { status:'error', message:'Vendor "' + id + '" mila hi nahi' };
}

function saveVendor(p) {
  // 'slug' = form ka naya-vendor slug. apiPost har request me tenant-routing wala
  // vendorId (default: nestandnosh) daal deta hai jo form value ko kuchal deta tha —
  // isliye slug alag naam se aata hai. (vendorId fallback purane callers ke liye.)
  const id = String(p.slug || p.vendorId || '').trim().toLowerCase();
  if (!id) return { status:'error', message:'Vendor ID zaroori hai' };
  if (!/^[a-z0-9]+$/.test(id)) return { status:'error', message:'Slug "' + id + '" galat hai — sirf lowercase letters/numbers (space, /, : nahi)' };
  if (id === DEFAULT_VENDOR_ID) return { status:'error', message:'Slug "' + id + '" default vendor ka hai — naye vendor ke liye alag slug do (jaise shyamrasoi)' };
  const existing = loadVendors()[id];
  // Edit karte waqt password khaali chhoda ja sakta hai — purana hi rahega.
  // Naye vendor ke liye password zaroori hai.
  if (!p.sheetId || !p.adminUser) return { status:'error', message:'Sheet ID aur Admin Username zaroori hain' };
  if (!existing && !p.adminPass) return { status:'error', message:'Naye vendor ke liye Admin Password zaroori hai' };
  // ⚠️ Sabse khatarnak galti: naye vendor ko default vendor ka hi sheet de dena.
  // Tab dono ka data ek jagah mix ho jaata hai. Isliye yahin rok dete hain.
  if (String(p.sheetId).trim() === SHEET_ID) {
    return { status:'error', message:'Ye to default vendor ka hi Sheet hai! Nayi sheet banao (File → Make a copy), warna dono ka data mix ho jayega.' };
  }
  const dupe = Object.keys(loadVendors()).filter(function(k){
    return k !== id && loadVendors()[k].sheetId === String(p.sheetId).trim();
  });
  if (dupe.length) return { status:'error', message:'Ye Sheet pehle se vendor "' + dupe[0] + '" use kar raha hai — har vendor ki alag sheet honi chahiye.' };
  const sh = vendorsSheet();
  const lr = sh.getLastRow();
  let rowIdx = -1;
  if (lr >= 2) {
    const ids = sh.getRange(2, 1, lr - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) { if (String(ids[i][0] || '').trim().toLowerCase() === id) { rowIdx = i + 2; break; } }
  }
  let salt, passHash;
  if (p.adminPass) { salt = Utilities.getUuid(); passHash = hashPassword(p.adminPass, salt); }
  else { salt = existing.adminSalt; passHash = existing.adminPassHash; }   // purana password waisa hi
  // Naya vendor → uska sheet abhi taiyaar kar do (tabs + starter menu + default config)
  try { provisionVendorSheet(String(p.sheetId).trim()); }
  catch (e) {
    return { status:'error', message:'Sheet khul nahi payi. ID sahi hai? Aur sheet aapke hi Google account me honi chahiye. (' + String(e).slice(0,90) + ')' };
  }
  const row = [id, safeCell(p.name || id), p.sheetId, safeCell(p.adminUser), passHash, p.notifyEmail || '', p.tgBotToken || '', p.tgChatId || '', safeCell(p.whatsapp || ''), p.status || 'Active', todayIST(), salt, String(p.scriptUrl || '').trim(),
    safeCell(p.areas || ''), safeCell(p.cuisine || ''), String(p.logo || '').trim(),
    existing ? (existing.ratingSum || 0) : 0, existing ? (existing.ratingCount || 0) : 0,
    parseInt(p.minOrder, 10) || 0];
  if (rowIdx > 0) sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  resetVendorsCache();
  return { status:'success', vendors: listVendorsForSuper() };
}

// ⚠️ 1) Admin username/password: ab har vendor ka apna hota hai — upar VENDORS
//    registry mein set karo (adminUser/adminPass), yahan global nahi rakha.

// ⚠️ 2) Google Sign-In Client ID — Google Cloud Console → APIs & Services →
//    Credentials → Create OAuth client ID → "Web application" → add your
//    Netlify site under "Authorized JavaScript origins" → paste Client ID here.
//    MUST match the client_id used in the frontend's google.accounts.id.initialize().
const GOOGLE_CLIENT_ID = '326762302482-d6c9l5k804u0oavcrrrqik7cadsvdneq.apps.googleusercontent.com';

// ⚠️ 3) Email/Password login — change this random string once (used to salt
//    password hashes; changing it later would invalidate existing passwords):
const PASSWORD_PEPPER = secret('PASSWORD_PEPPER');

// 📧 Har order pe email (zyada orders pe false rakho — Gmail limit ~100/din):
const SEND_EMAIL_PER_ORDER = false;

// 📲 TELEGRAM INSTANT ALERTS (real notification + ringtone, app band ho tab bhi):
//   Setup (ek baar, 3 min):
//   1) Telegram me @BotFather kholo → /newbot → naam do → jo TOKEN mile yahan paste karo
//   2) Apne naye bot ko Telegram me kholo aur koi bhi message bhejo (jaise "hi")
//   3) Browser me kholo: https://api.telegram.org/bot<TOKEN>/getUpdates
//      → "chat":{"id": 123456789 ...} — ye number CHAT_ID hai, neeche paste karo
//   4) Yahan dono bharo → Deploy (New version). Bas — har order pe Telegram bajega.
const TG_BOT_TOKEN = '';   // e.g. '7123456789:AAH....'
const TG_CHAT_ID   = '';   // e.g. '123456789'

const SESSION_DAYS = 3650;                // login yaad rahega jab tak user khud logout na kare (~10 saal)

const ORDERS_SHEET='Orders', MENU_SHEET='Menu', USERS_SHEET='Users', SESS_SHEET='Sessions', AUDIT_SHEET='Audit', CONFIG_SHEET='Config';
const TZ = 'Asia/Kolkata';
const STATUS_COL = 19, DELDATE_COL = 20;
const ADMIN_STATUS = ['Pending','Preparing','Delivered'];

// Ek hi request ke andar Orders sheet baar-baar na padhe jaaye (capacity check +
// duplicate check dono ko same data chahiye) — isse lock jyada der block nahi
// hoti aur zyada concurrent orders (100+) ek saath handle ho paate hain.
let _ordersRawCache = null;
let _configCache = null;
let _menuCache = null;
function ordersRawCached() {
  if (_ordersRawCache) return _ordersRawCache;
  const sh = ordersSheet();
  const last = sh.getLastRow();
  _ordersRawCache = (last < 2) ? [] : sh.getRange(2, 1, last - 1, 23).getValues();
  return _ordersRawCache;
}
function resetOrdersCache() { _ordersRawCache = null; }

// ─────────────────────────────────────────────
function doGet(e) {
  const q = e.parameter;
  const action = (q.action || '').toLowerCase();
  _configCache = null; _menuCache = null;
  CURRENT_VENDOR_ID = resolveVendor(q.vendorId);   // multi-tenant: pehle vendor decide karo, phir kuch bhi Sheet-related karo
  // Discovery vendor-agnostic hai — inactive check se pehle
  if (action === 'areas')    return json({ status:'success', areas: listAreas() });
  if (action === 'discover') return json({ status:'success', vendors: discoverVendors(q.area) });
  if (vendorBlocked()) return json({ status:'error', code:'vendor_inactive', message:'This kitchen is not taking orders right now.' });

  if (action === 'menu') return json({ status:'success', menu: readMenu() });
  if (action === 'config') return json({ status:'success', config: readConfig() });
  if (action === 'bootstrap') { let pp=[]; try{ pp=publicPromos(); }catch(e){} return json({ status:'success', menu: readMenu(), config: readConfig(), promos: pp }); }
  if (action === 'publicstats') return json({ status:'success', stats: publicStats(q.date) });

  if (action === 'me') {
    const s = getSession(q.token);
    return s ? json({ status:'success', name:s.name, phone:s.phone, email:s.email }) : json({ status:'invalid_session' });
  }

  if (action === 'myorders') {
    const s = getSession(q.token);
    if (!s) return json({ status:'invalid_session' });
    return json({ status:'success', orders: readMyOrders(s.phone, q.date) });
  }

  if (action === 'mysub') {
    const s = getSession(q.token);
    if (!s) return json({ status:'invalid_session' });
    return json({ status:'success', sub: readSub(s.phone) });
  }

  return ContentService.createTextOutput('✅ Nest & Nosh backend v6 is running!');
}

// ─────────────────────────────────────────────
function doPost(e) {
  resetOrdersCache();   // fresh data har request pe (safety, execution-reuse ke against)
  _configCache = null; _menuCache = null;
  try {
    let p = {};
    if (e.postData && e.postData.contents) {
      try { p = JSON.parse(e.postData.contents); } catch (err) { p = e.parameter; }
    } else p = e.parameter;

    const action = (p.action || '').toLowerCase();

    // ── Super Admin (platform owner) — vendorId resolve karne se PEHLE, kyunki
    //    ye vendor-agnostic hai, seedha master registry se baat karta hai ──
    if (action === 'listvendors') {
      if (!checkSuperAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json({ status:'success', vendors: listVendorsForSuper() });
    }
    if (action === 'deletevendor') {
      if (!checkSuperAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(deleteVendor(p));
    }
    if (action === 'savevendor') {
      if (!checkSuperAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(saveVendor(p));
    }

    CURRENT_VENDOR_ID = resolveVendor(p.vendorId);   // multi-tenant: pehle vendor decide karo, phir kuch bhi Sheet-related karo
    if (vendorBlocked()) return json({ status:'error', code:'vendor_inactive', message:'This kitchen is not taking orders right now.' });
    if (action === 'ratevendor')   return json(rateVendor(p));
    if (action === 'myrating')     return json(myRating(p));
    if (action === 'demologin')    return json(demoLogin());
    if (action === 'askai')        return json(askAI(p));
    if (action === 'googlelogin')  return json(googleLogin(p));
    if (action === 'emailsignup')  return json(emailSignup(p));
    if (action === 'emaillogin')   return json(emailLogin(p));
    if (action === 'forgotpassword') return json(forgotPassword(p));
    if (action === 'resetpassword')  return json(resetPassword(p));
    if (action === 'logout')      return json(logoutUser(p));
    if (action === 'cancelorder') return json(cancelOrderAuthed(p));
    if (action === 'savesub')     return json(saveSubAuthed(p));
    if (action === 'cancelsub')   return json(cancelSubAuthed(p));
    if (action === 'skipsub')     return json(skipSubAuthed(p));

    if (action === 'savemenu') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      saveMenu(p.menu);
      return json({ status:'success' });
    }
    if (action === 'saveconfig') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(saveConfig(p.config));
    }
    if (action === 'savevariants') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(saveVariants(p));
    }
    if (action === 'checkpromo') {
      const sCk = getSession(p.token);
      if (!sCk) return json({ status:'invalid_session' });
      const ev = evalPromo(p.code, sCk.phone, parseInt(p.amount, 10) || 0);
      return json(ev.ok ? { status:'success', discount:ev.discount, code:ev.code, label:ev.label } : { status:'error', message:ev.message });
    }
    if (action === 'savepromo') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(savePromo(p));
    }
    if (action === 'deletepromo') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(deletePromo(p));
    }
    if (action === 'setstatusbulk') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(setOrderStatusBulk(p));
    }
    if (action === 'setpaid') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(setPaid(p));
    }
    if (action === 'uploadimage') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(uploadImage(p));
    }
    if (action === 'setstatus') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(setOrderStatus(p));
    }
    if (action === 'setmealstatus') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(setMealStatus(p));
    }
    if (action === 'setuserstatus') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(setUserStatus(p));
    }
    if (action === 'resetuser') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(resetUser(p));
    }

    // ── Admin read-only actions — ab POST me (pehle GET query string me
    //    user/pass jaate the, jo browser history/proxy logs me leak ho sakte
    //    the; POST body me safe hai) ──
    if (action === 'stats') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(buildStats());
    }
    if (action === 'lastorder') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      const sh = ordersSheet();
      const lr = sh.getLastRow();
      let latest = null;
      if (lr >= 2) {
        const o = rowToOrder(sh.getRange(lr, 1, 1, 27).getValues()[0], lr);
        latest = { name:o.name, total:o.total, society:o.society, flat:o.flat, deliveryDate:o.deliveryDate };
      }
      return json({ status:'success', lastRow: lr, latest: latest });
    }
    if (action === 'orders') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json({ status:'success', orders: readOrders(p.range || 'today', p.date || '') });
    }
    if (action === 'getpromos') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json({ status:'success', promos: listPromos() });
    }
    if (action === 'users') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json({ status:'success', users: listUsers() });
    }

    // Default: naya order — LOGIN ZAROORI
    return json(placeOrderAuthed(p));

  } catch (err) {
    return json({ status:'error', message: err.message });
  }
}

// ═══════════ HELPERS ═══════════
// Sheets formula injection guard: '=', '+', '-', '@' se shuru hone wala user text
// formula ban jaata hai (=IMPORTXML(...) se data leak ho sakta hai). Apostrophe laga do.
function safeCell(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? ("'" + s) : s;
}

// ── Admin brute-force throttle: 5 galat try = 15 min lockout ──
// ⚠️ Ye key pehle sabhi vendors ke liye COMMON thi — ek vendor pe 5 galat try
// karne se BAAKI SAB vendors bhi 15 min ke liye lock ho jaate the.
function adminFailKey() { return 'adminFails_' + CURRENT_VENDOR_ID; }
function adminLocked() {
  const c = CacheService.getScriptCache();
  return Number(c.get(adminFailKey()) || 0) >= 5;
}
function adminFail() {
  const c = CacheService.getScriptCache();
  const n = Number(c.get(adminFailKey()) || 0) + 1;
  c.put(adminFailKey(), String(n), 900);   // 15 min
  audit('ADMIN_LOGIN_FAIL', '', CURRENT_VENDOR_ID + ' attempt ' + n);
}
function adminPass() { CacheService.getScriptCache().remove(adminFailKey()); }
// Lock khud hata do (editor se Run karo agar test karte-karte lock ho jaye)
function clearAdminLock() {
  const c = CacheService.getScriptCache();
  Object.keys(loadVendors()).forEach(function(v){ c.remove('adminFails_' + v); });
  c.remove('adminFails'); c.remove('superFails');
  Logger.log('✅ Saare admin locks hata diye');
}
// Diagnostic — editor se Run karke dekho demo vendor registry me hai ya nahi
function checkDemoSetup() {
  const reg = loadVendors();
  Logger.log('Registry me ye vendors hain: ' + Object.keys(reg).join(', '));
  const d = reg['demo'];
  if (!d) { Logger.log('❌ "demo" vendor registry me NAHI hai — Super Admin panel se add karo.'); return; }
  Logger.log('✅ demo mila | adminUser="' + d.adminUser + '" | hash set? ' + (!!d.adminPassHash) + ' | salt set? ' + (!!d.adminSalt) + ' | sheetId set? ' + (!!d.sheetId) + ' | status=' + d.status);
  CURRENT_VENDOR_ID = 'demo';
  Logger.log('demo/demo123 se login test: ' + (checkAuth('demo','demo123') ? '✅ CHAL RAHA HAI' : '❌ FAIL'));
}

function checkAuth(u, p) {
  if (adminLocked()) return false;
  const v = currentVendor();
  let ok;
  if (v.adminPassHash) {
    // Naye (Super Admin panel se added) vendors — password hash+salt se compare, plaintext kabhi store nahi hota
    ok = (u === v.adminUser && v.adminSalt && hashPassword(p, v.adminSalt) === v.adminPassHash);
  } else {
    // Default vendor — legacy plaintext (code-level constant, alag threat model, Super Admin password jaisa)
    ok = (u === v.adminUser && p === v.adminPass);
  }
  if (ok) adminPass(); else adminFail();
  return ok;
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function cleanPhone(v) { return String(v || '').replace(/^'+/, '').trim(); }
function validPhone(v) { return /^[6-9]\d{9}$/.test(String(v || '')); }
function todayIST() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

// Google Sheets often auto-converts a plain "yyyy-MM-dd" string into a real Date
// cell when written via API. Every read of the Delivery Date column MUST go
// through this so string-equality checks (duplicate check, cancel deadline,
// today/week filters) keep working regardless of how the cell got stored.
function ddStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').trim();
}
function fmtDT(d) { return (d instanceof Date) ? Utilities.formatDate(d, TZ, 'dd MMM yy, hh:mm a') : ''; }

function sheetWithHeaders(name, headers, ssOverride) {
  const ss = ssOverride || getSS();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#667eea').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function usersSheet()   { return sheetWithHeaders(USERS_SHEET, ['Phone','Name','Email','Created','Last Login','Status','PasswordHash','Salt','ResetToken','ResetExpires']); }
function sessionsSheet(){ return sheetWithHeaders(SESS_SHEET,  ['Token','Phone','Email','Created','Expires']); }
function auditSheet()   { return sheetWithHeaders(AUDIT_SHEET, ['Time','Phone','Action','Details']); }

function audit(action, phone, details) {
  try { auditSheet().appendRow([new Date(), "'" + (phone || ''), action, details || '']); } catch (e) {}
}

function findRowByPhone(sh, phone) {
  if (!phone) return -1;   // blank phone kabhi match na kare (Google users jinka phone abhi nahi aaya)
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const vals = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (cleanPhone(vals[i][0]) === phone) return i + 2;
  return -1;
}
function findRowByEmail(sh, email) {
  const e = String(email || '').trim().toLowerCase();   // dono taraf lowercase — warna match fail hoke session invalid ho jata tha
  if (!e) return -1;
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const vals = sh.getRange(2, 3, last - 1, 1).getValues(); // Email = column 3
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0] || '').trim().toLowerCase() === e) return i + 2;
  return -1;
}

// ═══════════ GOOGLE SIGN-IN ═══════════
// Verifies the ID token (JWT "credential") that Google Identity Services
// hands the frontend after a successful Google login. We call Google's own
// tokeninfo endpoint so we never have to implement JWT signature checks
// ourselves — Google does the crypto verification and just tells us if it's
// valid, for whom (aud), and the verified email.
function verifyGoogleToken(credential) {
  if (!credential) return { error: 'NO_CREDENTIAL' };
  try {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { muteHttpExceptions: true });
    const body = res.getContentText();
    if (res.getResponseCode() !== 200) return { error: 'HTTP_' + res.getResponseCode() + ': ' + body.slice(0, 200) };
    const data = JSON.parse(body);
    if (data.aud !== GOOGLE_CLIENT_ID) return { error: 'AUD_MISMATCH token_aud=[' + data.aud + '] expected=[' + GOOGLE_CLIENT_ID + ']' };
    if (String(data.email_verified) !== 'true') return { error: 'EMAIL_NOT_VERIFIED' };
    if (!data.email) return { error: 'NO_EMAIL_IN_TOKEN' };
    return { email: String(data.email).toLowerCase(), name: data.name || '', sub: data.sub };
  } catch (e) { return { error: 'EXCEPTION: ' + e.message }; }
}

// First-ever login for a Google account needs a phone number (for delivery
// contact / WhatsApp) — pass { credential, phone, name? }. Every later login
// just needs { credential }; phone/name are pulled from the saved profile.
function googleLogin(p) {
  const g = verifyGoogleToken(p.credential);
  if (!g || !g.email) return { status:'error', message:'Google sign-in could not be verified: ' + (g && g.error ? g.error : 'UNKNOWN') };
  const email = g.email;
  const lock = LockService.getScriptLock();
  let gotLock=false; try { gotLock = lock.tryLock(20000); } catch (e) {}
  if (!gotLock) return { status:'error', code:'busy', message:'Server is busy right now — please try again.' };
  try {
    const uSh = usersSheet();
    let uRow = findRowByEmail(uSh, email);
    let phone, name;
    if (uRow === -1) {
      // Pehli baar Google login — number + naam EK BAAR yahin le lete hain.
      // (Phone poore system ki primary ID hai, isliye account banne se pehle chahiye.)
      phone = cleanPhone(p.phone);
      if (!validPhone(phone)) return { status:'need_phone', code:'need_phone', message:'Please provide your mobile number to complete sign-in.' };
      if (findRowByPhone(uSh, phone) !== -1) return { status:'error', code:'phone_taken', message:'This mobile number is already linked to another account.' };
      name = String(p.name || g.name || '').trim() || 'Guest';
      uSh.appendRow(["'" + phone, safeCell(name), email, new Date(), new Date(), 'Active']);
      bumpUsersVer();
      audit('GOOGLE_LOGIN_NEW_USER', phone, email);
    } else {
      if (uSh.getRange(uRow, 6).getValue() === 'Blocked') return { status:'error', code:'blocked', message:'Your account is blocked. Support: 70434 91481' };
      phone = cleanPhone(uSh.getRange(uRow, 1).getValue());
      name = String(uSh.getRange(uRow, 2).getValue() || g.name || 'Guest');
      // Purane blank-phone accounts (pichhle version me bane the) — ab number bhar do
      if (!phone) {
        const np = cleanPhone(p.phone);
        if (!validPhone(np)) return { status:'need_phone', code:'need_phone', message:'Please provide your mobile number to continue.' };
        if (findRowByPhone(uSh, np) !== -1) return { status:'error', code:'phone_taken', message:'This mobile number is already linked to another account.' };
        uSh.getRange(uRow, 1).setValue("'" + np);
        phone = np;
        audit('PHONE_BACKFILLED', phone, email);
      }
      uSh.getRange(uRow, 5).setValue(new Date());
      audit('GOOGLE_LOGIN', phone, email);
    }
    const token = Utilities.getUuid();
    sessionsSheet().appendRow([token, "'" + phone, email, new Date(), new Date(Date.now() + SESSION_DAYS * 86400000)]);
    return { status:'success', token: token, name: name, phone: phone };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ═══════════ EMAIL + PASSWORD SIGN-IN ═══════════
function hashPassword(password, salt) {
  const raw = String(password) + ':' + salt + ':' + PASSWORD_PEPPER;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()); }

// { email, password, phone, name } — new account via email/password
function emailSignup(p) {
  const email = String(p.email || '').trim().toLowerCase();
  const password = String(p.password || '');
  const phone = cleanPhone(p.phone);
  if (!validEmail(email)) return { status:'error', code:'bad_email', message:'Please enter a valid email address.' };
  if (password.length < 6) return { status:'error', code:'pw_short', message:'Password must be at least 6 characters.' };
  if (!validPhone(phone)) return { status:'error', code:'bad_phone', message:'Please enter a valid 10-digit mobile number.' };

  const lock = LockService.getScriptLock();
  let gotLock=false; try { gotLock = lock.tryLock(20000); } catch (e) {}
  if (!gotLock) return { status:'error', code:'busy', message:'Server is busy right now — please try again.' };
  try {
    const uSh = usersSheet();
    if (findRowByEmail(uSh, email) !== -1) return { status:'error', code:'email_exists', message:'An account with this email already exists — please sign in.' };
    if (findRowByPhone(uSh, phone) !== -1) return { status:'error', code:'phone_taken', message:'This mobile number is already linked to another account.' };

    const name = String(p.name || '').trim() || email.split('@')[0];
    const salt = Utilities.getUuid();
    const hash = hashPassword(password, salt);
    // ⚠️ Apostrophe zaroori — baaki har jagah aise hi likha jaata hai. Bina iske
    // Sheets phone ko NUMBER bana deti hai aur format mismatch ho jaata hai.
    uSh.appendRow(["'" + phone, safeCell(name), email, new Date(), new Date(), 'Active', hash, salt, '', '']);
    bumpUsersVer();
    audit('EMAIL_SIGNUP', phone, email);

    const token = Utilities.getUuid();
    sessionsSheet().appendRow([token, "'" + phone, email, new Date(), new Date(Date.now() + SESSION_DAYS * 86400000)]);
    return { status:'success', token: token, name: name, phone: phone };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ── Customer login brute-force throttle: per-EMAIL, 5 galat try = 15 min lock ──
// (Admin ka checkAuth() alag/global hai — ye customer accounts ke liye hai.)
function loginLocked(email) {
  const c = CacheService.getScriptCache();
  return Number(c.get('loginFails_' + email) || 0) >= 5;
}
function loginFail(email) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get('loginFails_' + email) || 0) + 1;
  c.put('loginFails_' + email, String(n), 900);
}
function loginPass(email) { CacheService.getScriptCache().remove('loginFails_' + email); }

// { email, password } — existing account
function emailLogin(p) {
  const email = String(p.email || '').trim().toLowerCase();
  const password = String(p.password || '');
  if (!validEmail(email) || !password) return { status:'error', code:'need_creds', message:'Please enter your email and password.' };
  if (loginLocked(email)) return { status:'error', code:'too_many_tries', message:'Too many failed attempts. Please try again in 15 minutes.' };

  const lock = LockService.getScriptLock();
  let gotLock=false; try { gotLock = lock.tryLock(20000); } catch (e) {}
  if (!gotLock) return { status:'error', code:'busy', message:'Server is busy right now — please try again.' };
  try {
    const uSh = usersSheet();
    const row = findRowByEmail(uSh, email);
    if (row === -1) { loginFail(email); return { status:'error', code:'no_account', message:'No account found with this email.' }; }
    if (uSh.getRange(row, 6).getValue() === 'Blocked') return { status:'error', code:'blocked', message:'Your account is blocked. Support: 70434 91481' };

    const storedHash = uSh.getRange(row, 7).getValue();
    const salt = uSh.getRange(row, 8).getValue();
    if (!storedHash || !salt) return { status:'error', code:'use_google', message:'This account uses Google Sign-In — please use "Sign in with Google".' };
    if (hashPassword(password, salt) !== storedHash) { loginFail(email); return { status:'error', code:'wrong_pw', message:'Incorrect password.' }; }
    loginPass(email);

    const phone = cleanPhone(uSh.getRange(row, 1).getValue());
    const name = String(uSh.getRange(row, 2).getValue() || '');
    uSh.getRange(row, 5).setValue(new Date());
    audit('EMAIL_LOGIN', phone, email);

    const token = Utilities.getUuid();
    sessionsSheet().appendRow([token, "'" + phone, email, new Date(), new Date(Date.now() + SESSION_DAYS * 86400000)]);
    return { status:'success', token: token, name: name, phone: phone };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// { email, origin } — emails a reset link to the account, if one exists.
// Always returns success (never reveals whether the email is registered).
function forgotPassword(p) {
  const email = String(p.email || '').trim().toLowerCase();
  const origin = String(p.origin || '').replace(/\/$/, '');
  if (!validEmail(email)) return { status:'error', code:'bad_email', message:'Please enter a valid email address.' };
  try {
    const uSh = usersSheet();
    const row = findRowByEmail(uSh, email);
    if (row !== -1 && uSh.getRange(row, 7).getValue()) { // only if it's a password account
      const token = Utilities.getUuid();
      uSh.getRange(row, 9).setValue(token);
      uSh.getRange(row, 10).setValue(new Date(Date.now() + 30 * 60000)); // 30 min
      let base = (origin || 'https://flying-birds-nest.netlify.app').replace(/\/+$/, '');
      const link = base + (/\.html$/i.test(base) ? '' : '/') + '?reset=' + token;
      MailApp.sendEmail({
        to: email,
        subject: 'Nest & Nosh — Reset your password',
        name: 'Nest & Nosh',
        body: 'Password reset link (30 min valid): ' + link,
        htmlBody: 'We received a request to reset your password.<br><br>' +
          '<a href="' + link + '" style="background:#6366f1;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Reset Password</a><br><br>' +
          'Or copy this link: ' + link + '<br><br>' +
          'This link is valid for 30 minutes. If you did not request this, please ignore this email.'
      });
      audit('PASSWORD_RESET_REQUESTED', cleanPhone(uSh.getRange(row, 1).getValue()), email);
    }
  } catch (e) { audit('RESET_EMAIL_FAIL', '', String(e).slice(0, 180)); }
  return { status:'success', code:'reset_sent', message:'If this email is registered, a reset link has been sent.' };
}

// ⚠️ EK BAAR editor se Run karein → Google "Allow" maangega (mail permission).
// Bina iske password-reset emails silently fail hoti hain.
function sendTestEmail() {
  MailApp.sendEmail({ to: currentVendor().notifyEmail, subject: '🍱 FBT — mail test', htmlBody: 'Mail permission OK ✅ Ab reset emails jayengi.' });
}

// { token, password }
function resetPassword(p) {
  const token = String(p.token || '').trim();
  const password = String(p.password || '');
  if (!token) return { status:'error', code:'reset_bad', message:'This reset link is invalid.' };
  if (password.length < 6) return { status:'error', code:'pw_short', message:'Password must be at least 6 characters.' };
  const uSh = usersSheet();
  const last = uSh.getLastRow();
  if (last < 2) return { status:'error', code:'reset_bad', message:'This reset link is invalid.' };
  const vals = uSh.getRange(2, 9, last - 1, 2).getValues(); // ResetToken, ResetExpires
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === token) {
      const row = i + 2;
      const expires = vals[i][1];
      if (!(expires instanceof Date) || new Date() > expires) return { status:'error', code:'reset_expired', message:'This reset link has expired — please request a new one.' };
      const salt = Utilities.getUuid();
      uSh.getRange(row, 7).setValue(hashPassword(password, salt));
      uSh.getRange(row, 8).setValue(salt);
      uSh.getRange(row, 9).setValue('');
      uSh.getRange(row, 10).setValue('');
      const phoneForSessions = cleanPhone(uSh.getRange(row, 1).getValue());
      invalidateAllSessions(phoneForSessions);   // chori hua session bhi ab dead
      audit('PASSWORD_RESET_DONE', phoneForSessions, '');
      return { status:'success' };
    }
  }
  return { status:'error', code:'reset_bad', message:'This reset link is invalid or has expired.' };
}

// ═══════════ SESSION ═══════════
function usersVerKey() { return 'uver_' + CURRENT_VENDOR_ID; }
function usersVer() { try { return CacheService.getScriptCache().get(usersVerKey()) || '0'; } catch (e) { return '0'; } }
// Users sheet me koi bhi row add/delete/status-change ho to ye chalao
function bumpUsersVer() { try { CacheService.getScriptCache().put(usersVerKey(), String(Date.now()), 21600); } catch (e) {} }

function getSession(token) {
  if (!token) return null;
  // ⚠️ Cache me uRow (Users sheet ka row number) bhi hota hai. User delete/reset hone
  // par baaki rows KHISAK jaati hain — purana uRow galat user pe point karne lagta hai
  // ya range se bahar chala jaata hai, aur order "invalid_session" me atak jaata hai.
  // Isliye cache key me users-version bhi hai: Users sheet badli = saari sessions fresh.
  const cacheKey = 'sess_' + CURRENT_VENDOR_ID + '_' + usersVer() + '_' + token;
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}
  const result = getSessionUncached(token);
  // ⚠️ Trade-off: 60 sec tak cached rehta hai, isliye admin ka "Block" ya "Reset"
  // user ko turant nahi, ~60 sec ke andar effect karega — chhote business ke liye
  // acceptable delay, lekin turant chahiye ho to yahan TTL 0 rakh dena.
  if (result) { try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 60); } catch (e) {} }
  return result;
}
function getSessionUncached(token) {
  const sh = sessionsSheet();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const vals = sh.getRange(2, 1, last - 1, 5).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(token)) {
      const exp = vals[i][4];
      if (!(exp instanceof Date) || new Date() > exp) return null;
      const email = String(vals[i][2] || '');
      const uSh = usersSheet();
      // Phone abhi na ho (Google login jisme number nahi maanga) to email se dhoondo.
      let uRow = findRowByPhone(uSh, cleanPhone(vals[i][1]));
      if (uRow === -1 && email) uRow = findRowByEmail(uSh, email);
      if (uRow === -1 || uSh.getRange(uRow, 6).getValue() === 'Blocked') return null;
      // Phone hamesha Users sheet se lo — order ke waqt add hua ho to yahin milega
      const phone = cleanPhone(uSh.getRange(uRow, 1).getValue());
      return { phone: phone, email: email, name: String(uSh.getRange(uRow, 2).getValue() || ''), uRow: uRow };
    }
  }
  return null;
}

// Password reset / account-compromise ke baad saare purane sessions (chura
// hua token bhi) turant dead kar deta hai — user ko dobara login karna hoga.
function invalidateAllSessions(phone) {
  if (!phone) return;
  const sh = sessionsSheet();
  const last = sh.getLastRow();
  if (last < 2) return;
  const vals = sh.getRange(2, 1, last - 1, 2).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (cleanPhone(vals[i][1]) === phone) sh.deleteRow(i + 2);
  }
}

function logoutUser(p) {
  try { CacheService.getScriptCache().remove('sess_' + CURRENT_VENDOR_ID + '_' + usersVer() + '_' + p.token); } catch (e) {}
  const sh = sessionsSheet();
  const last = sh.getLastRow();
  if (last >= 2 && p.token) {
    const vals = sh.getRange(2, 1, last - 1, 2).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === String(p.token)) {
        audit('LOGOUT', cleanPhone(vals[i][1]), '');
        sh.deleteRow(i + 2);
        break;
      }
    }
  }
  return { status:'success' };
}

// ═══════════ ORDER (token-secured, server-validated) ═══════════
function placeOrderAuthed(p) {
  const sess = getSession(p.token);
  if (!sess) return { status:'invalid_session' };
  let phone = sess.phone; // ⚠️ frontend ka phone IGNORE — session se aata hai

  // Google se login kiya tha aur number tab nahi maanga — pehle order par
  // yahin le lo, verify karo, aur profile me save kar do (agli baar nahi poochega).
  if (!phone) {
    const newPhone = cleanPhone(p.phone);
    if (!validPhone(newPhone)) return { status:'error', code:'need_phone', message:'Please enter your 10-digit mobile number to place the order.' };
    const uSh = usersSheet();
    const taken = findRowByPhone(uSh, newPhone);
    if (taken !== -1 && taken !== sess.uRow) return { status:'error', code:'phone_taken', message:'This mobile number is already linked to another account.' };
    if (!sess.uRow) return { status:'invalid_session' };
    uSh.getRange(sess.uRow, 1).setValue("'" + newPhone);   // profile me save
    // Is user ki saari sessions me phone bhar do taaki aage session se hi mile
    const ssh = sessionsSheet(), slast = ssh.getLastRow();
    if (slast >= 2) {
      const sv = ssh.getRange(2, 1, slast - 1, 3).getValues();
      for (let i = 0; i < sv.length; i++) {
        if (String(sv[i][2] || '').toLowerCase() === String(sess.email || '').toLowerCase()) ssh.getRange(i + 2, 2).setValue("'" + newPhone);
      }
    }
    audit('PHONE_ADDED_AT_ORDER', newPhone, sess.email || '');
    bumpUsersVer();   // phone badla = Users sheet badli
    phone = newPhone;
  }

  // Input caps — bade payload / junk data se bachav
  ['society','flatNo','note','name','lunchSabzi','dinnerSabzi','lunchRoti','dinnerRoti','lunchAddons','dinnerAddons','payment','lunchTiffin','dinnerTiffin','lunchTimeSlot','dinnerTimeSlot','breakfastTimeSlot','couponCode']
    .forEach(k => { if (p[k] != null) p[k] = String(p[k]).slice(0, 120); });

  p._phoneForFee = phone;   // deliveryFeeForOrder ko same-date order dekhne ke liye

  const lock = LockService.getScriptLock();
  let gotLock = false;
  try { gotLock = lock.tryLock(30000); } catch (e) {}   // order-rush ke liye extra headroom
  if (!gotLock) return { status:'error', code:'busy', message:'Server is busy right now — please try again in a moment.' };
  try {
    // Capacity/window check LOCK ke andar — warna do simultaneous requests
    // dono ek hi aakhri slot pe "available" dekh sakte the (overselling risk).
    const winErr = orderWindowError(p);
    if (winErr) { audit('ORDER_WINDOW_BLOCKED', phone, winErr); return { status:'error', message: winErr }; }

    const isEdit = !!p.editRow;
    let oldPaidVal = '';
    // 1:1:1 rule — ek din me har meal ka max 1 tiffin
    const qB = parseInt(p.breakfastQty, 10) || 0;
    const qL = parseInt(p.lunchQty, 10) || 0;
    const qD = parseInt(p.dinnerQty, 10) || 0;
    if (qB > 1 || qL > 1 || qD > 1) {
      return { status:'error', code:'qty_limit', message:'You can order 1 tiffin per meal per day. For larger quantities, please contact the kitchen.' };
    }
    // Ek order = ek meal. Ek payload me 2+ meal aaye to reject (frontend har meal alag bhejta hai).
    if ((qB>0?1:0)+(qL>0?1:0)+(qD>0?1:0) > 1) {
      return { status:'error', code:'one_meal', message:'Please place one order per meal.' };
    }
    const thisMeal = orderMealOf(p);
    // ── Delivery type: home (society+flat) ya office (company + employee id) ──
    const cfgD = readConfig();
    const dType = (String(p.deliveryType || 'home') === 'office') ? 'office' : 'home';
    if (dType === 'office') {
      if (!cfgD.officeEnabled) return { status:'error', code:'office_off', message:'Office delivery is not available right now.' };
      const co = findCompany(p.society);
      if (!co) return { status:'error', code:'company_req', message:'Please select your company from the list.' };
    } else {
      if (!cfgD.homeEnabled) return { status:'error', code:'home_off', message:'Home delivery is not available right now.' };
    }
    p.deliveryType = dType;
    const existingRow = findActiveOrderRow(phone, p.deliveryDate, thisMeal);

    if (isEdit) {
      // Editing: the row being edited must exist, be theirs, and still be in cancel window
      const row = parseInt(p.editRow, 10);
      const sh = ordersSheet();
      if (!row || row < 2 || row > sh.getLastRow()) return { status:'error', code:'no_order', message:'Order not found.' };
      if (cleanPhone(sh.getRange(row, 6).getValue()) !== phone) return { status:'error', code:'not_yours', message:'This order does not belong to your account.' };
      const st = sh.getRange(row, STATUS_COL).getValue() || 'Pending';
      if (st === 'Cancelled') return { status:'error', code:'edit_cancelled', message:'A cancelled order cannot be changed.' };
      if (st === 'Delivered') return { status:'error', code:'edit_delivered', message:'A delivered order cannot be changed.' };
      if (cancelDeadlinePassed(ddStr(sh.getRange(row, DELDATE_COL).getValue()), sh.getRange(row, 1).getValue())) return { status:'error', code:'cancel_window', message:'The change window for this order has closed.' };
      // If they somehow point at a different active row for same date, block
      if (existingRow !== -1 && existingRow !== row) return { status:'error', code:'dup_date', message:'You already have an order for this date.' };
      oldPaidVal = String(sh.getRange(row, 26).getValue() || '');   // V2-4: paid flag naye row pe carry hoga
      sh.getRange(row, STATUS_COL).setValue('Cancelled'); // old ko cancel, naya niche add
      audit('ORDER_EDIT_OLD_CANCELLED', phone, p.deliveryDate + ' row' + row);
    } else {
      if (existingRow !== -1) {
        audit('ORDER_DUPLICATE_BLOCKED', phone, p.deliveryDate);
        return { status:'duplicate', code:'dup_date', message:'You already have an order for this date.' };
      }
    }

    let total = computeTotal(p);
    if (total <= 0) return { status:'error', code:'no_meal', message:'Your order is empty — please select at least one meal.' };

    // 🎟️ Coupon (server-side): sirf naye orders par, checkout ki PEHLI date ke payload ke saath
    let promoStr = '', promoDiscount = 0, promoCode = '', couponRejected = '';
    if (!isEdit && String(p.applyCoupon) === '1' && p.couponCode) {
      const ev = evalPromo(p.couponCode, phone, total);
      if (ev.ok) { promoDiscount = ev.discount; promoCode = ev.code; total = Math.max(0, total - ev.discount); promoStr = ev.code + ' −₹' + ev.discount; p.promoApplied = promoStr; }
      else couponRejected = ev.message || 'Invalid coupon';
    }

    const name = String(p.name || sess.name || '').slice(0, 40);
    saveOrder(p, phone, name, total, promoStr);
    if (promoDiscount > 0) { try { recordPromoUse(promoCode, phone, ordersSheet().getLastRow(), promoDiscount); } catch (e) {} }
    if (isEdit && oldPaidVal === 'Paid') {   // V2-4: payment record naye active order pe
      const sh2 = ordersSheet();
      sh2.getRange(sh2.getLastRow(), 26).setValue('Paid');
      audit('PAYMENT_CARRIED_ON_EDIT', phone, p.deliveryDate);
    }
    audit(isEdit ? 'ORDER_EDITED' : 'ORDER_PLACED', phone, p.deliveryDate + ' · ₹' + total);
    try { p.phone = phone; notifyTelegram(tgOrderMsg(p, name, total, isEdit ? '✏️ ORDER EDITED' : '🆕 NEW ORDER')); } catch (e) {}
    if (SEND_EMAIL_PER_ORDER) { try { sendOrderEmail(p, phone, name, total); } catch (e) {} }
    try { sendOrderTelegram(p, phone, name, total); } catch (e) {}   // Telegram hamesha (email flag se alag)
    return { status:'success', total: total, promo: promoStr, couponRejected: couponRejected };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Active (non-cancelled) order row for a phone+date, else -1
// Ek order = ek meal (date + meal). Isse ek hi din ke 3 meal 3 alag orders bante hain
// aur har meal alag se cancel/track ho sakta hai.
function orderMealOf(p) {
  if ((parseInt(p.breakfastQty,10)||0) > 0) return 'breakfast';
  if ((parseInt(p.lunchQty,10)||0) > 0) return 'lunch';
  if ((parseInt(p.dinnerQty,10)||0) > 0) return 'dinner';
  return '';
}
function rowMealOf(r) {
  // Sheet layout: col7=Breakfast Qty, col8=Lunch Qty, col12=Dinner Qty
  // (pehle yahan galti se col11=Lunch Addons aur col15=Dinner Addons padhe ja
  //  rahe the — wo text hote hain, parseInt se NaN, isliye ye function hamesha
  //  '' return karta tha aur duplicate-order check kabhi chalta hi nahi tha.)
  if ((parseInt(r[6], 10) || 0) > 0) return 'breakfast';   // col7  = Breakfast Qty
  if ((parseInt(r[7], 10) || 0) > 0) return 'lunch';       // col8  = Lunch Qty
  if ((parseInt(r[11], 10) || 0) > 0) return 'dinner';     // col12 = Dinner Qty
  return '';
}
function findActiveOrderRow(phone, deliveryDate, meal) {
  const data = ordersRawCached();
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (cleanPhone(r[5]) === phone && ddStr(r[19]) === deliveryDate && r[18] !== 'Cancelled') {
      if (!meal || rowMealOf(r) === meal) return i + 2;   // meal diya to same-meal hi match
    }
  }
  return -1;
}

// Server-side price recompute — frontend ke total pe trust nahi (dynamic config prices)
// Har meal ki qty — items[] ho to wahi asli source, warna flat fields.
// Validation aur pricing dono ISI se qty lein, warna mismatch se cutoff bypass ho sakta hai.
function mealQtys(p) {
  const out = { breakfast: 0, lunch: 0, dinner: 0 };
  if (Array.isArray(p.items) && p.items.length) {
    p.items.forEach(function (it) {
      const m = String(it.meal || '');
      if (out[m] === undefined) return;
      out[m] += Math.min(5, Math.max(1, parseInt(it.qty, 10) || 0));
    });
    return out;
  }
  out.breakfast = parseInt(p.breakfastQty, 10) || 0;
  out.lunch     = parseInt(p.lunchQty, 10) || 0;
  out.dinner    = parseInt(p.dinnerQty, 10) || 0;
  return out;
}

function computeTotal(p) {
  const cfg = readConfig();
  const PRICE = cfg.prices;
  const V = cfg.variants || {};
  const clampQ = v => Math.min(5, Math.max(0, parseInt(v, 10) || 0));
  const clampR = v => Math.min(6, Math.max(0, parseInt(v, 10) || 0));
  // Look up a variant's price by meal + id; fall back to legacy mini/full pricing.
  const priceOf = (meal, variantId) => {
    const list = V[meal] || [];
    const found = list.find(x => x.id === String(variantId));
    if (found) return found.price;
    if (meal === 'breakfast') return PRICE.breakfast;
    return (String(variantId) === 'mini') ? PRICE.tiffinMini : PRICE[meal];
  };

  // Preferred path: per-line items[]. Server recomputes every line — client
  // totals are never trusted. tiffinType carries the variant id.
  if (Array.isArray(p.items) && p.items.length) {
    let t = 0;
    p.items.forEach(it => {
      const meal = String(it.meal || '');
      if (['breakfast','lunch','dinner'].indexOf(meal) === -1) return;
      const q = Math.min(5, Math.max(1, parseInt(it.qty, 10) || 0));
      let unit = priceOf(meal, it.tiffinType || it.variantId);
      if (meal !== 'breakfast') {
        unit += clampR(it.extraRoti) * (it.butterRoti ? PRICE.extraRotiButter : PRICE.extraRotiPlain);
        if (it.dahi) unit += PRICE.dahi;
        if (it.extraSabzi) unit += PRICE.extraSabzi;
      }
      t += unit * q;
    });
    return t + deliveryFeeForOrder(p);
  }

  // Legacy flat-field fallback (old clients)
  // ⚠️ NOTE: flat fields (lunchExtraRoti etc.) me frontend TOTAL bhejta hai
  // (extraRoti × qty), per-unit nahi — isliye ise `× q` se bahar rakha gaya hai,
  // warna qty>1 par extra roti ka charge do baar lag jaata tha.
  let t = clampQ(p.breakfastQty) * PRICE.breakfast;
  ['lunch','dinner'].forEach(m => {
    const q = clampQ(p[m + 'Qty']); if (!q) return;
    // ⚠️ Variants system use karo, legacy tiffinMini nahi — warna dinner ka mini
    // price galat aata tha (frontend ₹130 dikhata, backend ₹140 charge karta).
    let unit = priceOf(m, (String(p[m + 'Tiffin']) === 'Mini') ? 'mini' : 'full');
    const butter = String(p[m + 'Butter']) === '1' || p[m + 'Roti'] === 'Butter';
    if (String(p[m + 'Dahi']) === '1') unit += PRICE.dahi;
    if (String(p[m + 'ExtraSabzi']) === '1') unit += PRICE.extraSabzi;
    t += unit * q;
    t += clampR(p[m + 'ExtraRoti']) * (butter ? PRICE.extraRotiButter : PRICE.extraRotiPlain);
  });
  return t + (t > 0 ? deliveryFeeForOrder(p) : 0);
}

// Server-side IST cutoff rules — frontend bypass nahi kar sakta
function orderWindowError(p) {
  const dd = String(p.deliveryDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dd)) return 'Invalid delivery date.';
  const toEpoch = s => { const a = s.split('-').map(Number); return Date.UTC(a[0], a[1]-1, a[2]); };
  const off = Math.round((toEpoch(dd) - toEpoch(todayIST())) / 86400000);
  if (off < 0 || off > 2) return 'Delivery is available for Today, Tomorrow and Day After only.';

  const cfg = readConfig();
  if ((cfg.closedDates || []).indexOf(dd) >= 0) return 'The kitchen is closed on this date.';

  // Admin ne jo meal band kiya hai uska order server par bhi reject ho
  const me = cfg.mealsEnabled || {};
  const mq = mealQtys(p);
  if (mq.breakfast > 0 && me.breakfast === false) return 'Breakfast is not available right now.';
  if (mq.lunch     > 0 && me.lunch     === false) return 'Lunch is not available right now.';
  if (mq.dinner    > 0 && me.dinner    === false) return 'Dinner is not available right now.';

  const hm = Utilities.formatDate(new Date(), TZ, 'HH:mm').split(':');
  const mins = Number(hm[0]) * 60 + Number(hm[1]);
  // ⚠️ Quantity wahi source se lo jisse PAISA banta hai (computeTotal items[] ko
  // preference deta hai). Pehle ye sirf flat fields padhta tha — matlab koi
  // items[] me lunch aur flat field me dinner bhej ke lunch ka 9 AM cutoff
  // bypass kar sakta tha (charge lunch ka, check dinner ka).
  const q = mealQtys(p);
  const bq = q.breakfast, lq = q.lunch, dq = q.dinner;
  if (bq + lq + dq <= 0) return 'Please select at least one meal.';

  if (off === 0) {
    if (bq > 0) return 'Same-day breakfast is not available.';
    if (lq > 0 && mins >= 540) return 'Today\'s lunch booking has closed (9:00 AM cutoff).';
    if (dq > 0 && mins >= 900) return 'Today\'s dinner booking has closed (3:00 PM cutoff).';
  }
  if (off === 1) {
    if (bq > 0 && mins >= 1320) return 'Kal ke breakfast ki booking band (aaj raat 10:00 PM tak)';
    // lunch & dinner for tomorrow: always open (till their own next-day cutoffs)
  }

  // Daily capacity — 0 means unlimited. Excludes the row being edited (if any)
  // so editing your own order doesn't falsely trip "sold out".
  const cap = cfg.capacity || {};
  const excludeRow = p.editRow ? parseInt(p.editRow, 10) : 0;
  const meals = { breakfast: bq, lunch: lq, dinner: dq };
  for (const m in meals) {
    const want = meals[m];
    if (!want || !cap[m]) continue;
    const already = mealQtyForDate(dd, m, excludeRow);
    if (already + want > cap[m]) return 'The ' + m + ' slots for this date are full — only ' + Math.max(0, cap[m] - already) + ' left.';
  }
  return null;
}

// Sum of active (non-cancelled) Qty for a meal on a given delivery date.
function mealQtyForDate(deliveryDate, meal, excludeRow) {
  const qtyCol = meal === 'breakfast' ? 7 : (meal === 'lunch' ? 8 : 12);
  const data = ordersRawCached();
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const row = i + 2;
    if (excludeRow && row === excludeRow) continue;
    const r = data[i];
    if (r[18] === 'Cancelled') continue;
    if (ddStr(r[19]) !== deliveryDate) continue;
    sum += Number(r[qtyCol - 1]) || 0;
  }
  return sum;
}

// Public, unauthenticated live counter — no PII, just aggregate numbers.
// Powers the "N tiffins ordered today · N being prepared" banner.
function publicStats(dateStr) {
  const dd = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr)) ? dateStr : todayIST();
  const sh = ordersSheet();
  const last = sh.getLastRow();
  const stats = {
    date: dd,
    totalCustomers: 0,
    breakfast: { ordered: 0, preparing: 0, delivered: 0 },
    lunch:     { ordered: 0, preparing: 0, delivered: 0 },
    dinner:    { ordered: 0, preparing: 0, delivered: 0 }
  };
  try { const uLast = usersSheet().getLastRow(); stats.totalCustomers = Math.max(0, uLast - 1); } catch (e) {}
  if (last < 2) return stats;
  const data = sh.getRange(2, 1, last - 1, 23).getValues();
  data.forEach(r => {
    if (ddStr(r[19]) !== dd) return;
    const status = r[18] || 'Pending';
    if (status === 'Cancelled') return;
    [['breakfast',7],['lunch',8],['dinner',12]].forEach(([m,col]) => {
      const q = Number(r[col-1]) || 0; if (!q) return;
      stats[m].ordered += q;
      if (status === 'Preparing') stats[m].preparing += q;
      if (status === 'Delivered') stats[m].delivered += q;
    });
  });
  return stats;
}

// ═══════════ CANCEL (token-secured) ═══════════
function cancelOrderAuthed(p) {
  const sess = getSession(p.token);
  if (!sess) return { status:'invalid_session' };
  const sh = ordersSheet();
  const row = parseInt(p.row, 10);
  if (!row || row < 2 || row > sh.getLastRow()) return { status:'error', message:'Invalid order' };
  if (cleanPhone(sh.getRange(row, 6).getValue()) !== sess.phone) return { status:'error', code:'not_yours', message:'This order does not belong to your account.' };
  const curStatus = sh.getRange(row, STATUS_COL).getValue() || 'Pending';
  if (curStatus === 'Cancelled') return { status:'error', code:'already_cancelled', message:'This order is already cancelled.' };
  if (curStatus === 'Delivered') return { status:'error', code:'cancel_delivered', message:'A delivered order cannot be cancelled.' };
  const delDate = ddStr(sh.getRange(row, DELDATE_COL).getValue());
  if (cancelDeadlinePassed(delDate, sh.getRange(row, 1).getValue())) return { status:'error', code:'cancel_window', message:'The cancellation window for this order has closed.' };
  sh.getRange(row, STATUS_COL).setValue('Cancelled');
  audit('ORDER_CANCELLED', sess.phone, delDate);
  return { status:'success' };
}

function cancelDeadlinePassed(deliveryDate, createdVal) {
  const parts = String(deliveryDate).split('-').map(Number);
  if (parts.length !== 3 || !parts[0]) return true;
  const prevUTC = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]) - 86400000);
  const deadlineStr = Utilities.formatDate(prevUTC, 'UTC', 'yyyy-MM-dd') + ' 22:00';
  const nowStr = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  let passed = nowStr > deadlineStr;
  // 30-min grace: raat 10PM ke BAAD place hue orders (same-day/late-evening)
  // ko bhi place hone ke 30 min tak cancel/edit karne do.
  if (passed && createdVal) {
    const created = (createdVal instanceof Date) ? createdVal : new Date(createdVal);
    if (!isNaN(created.getTime()) && (Date.now() - created.getTime()) <= 30 * 60000) passed = false;
  }
  return passed;
}

// ═══════════ USERS (admin) ═══════════
function listUsers() {
  const uSh = usersSheet();
  const last = uSh.getLastRow();
  if (last < 2) return [];
  const vals = uSh.getRange(2, 1, last - 1, 6).getValues();

  // order counts per phone
  const counts = {};
  allOrders().forEach(o => { counts[o.phone] = (counts[o.phone] || 0) + 1; });

  return vals.map(r => ({
    phone: cleanPhone(r[0]),
    name: String(r[1] || ''),
    email: String(r[2] || ''),
    created: fmtDT(r[3]),
    lastLogin: fmtDT(r[4]),
    status: String(r[5] || 'Active'),
    orders: counts[cleanPhone(r[0])] || 0
  })).reverse();
}

function setUserStatus(p) {
  const status = String(p.status || '');
  if (['Active','Blocked'].indexOf(status) === -1) return { status:'error', message:'Invalid status' };
  const uSh = usersSheet();
  const row = findRowByPhone(uSh, cleanPhone(p.phone));
  if (row === -1) return { status:'error', message:'User not found.' };
  uSh.getRange(row, 6).setValue(status);
  bumpUsersVer();   // block/unblock turant asar kare, 60 sec cache ka wait nahi
  audit(status === 'Blocked' ? 'USER_BLOCKED' : 'USER_UNBLOCKED', cleanPhone(p.phone), 'by admin');
  return { status:'success' };
}

// Admin: ek user ka SAARA data mita do — wo bilkul naye user jaisa ho jaye.
// ⚠️ Irreversible. Orders bhi jaate hain, matlab unka revenue stats/digest se
// nikal jayega. Isliye confirm frontend par do baar hota hai.
function resetUser(p) {
  const phone = cleanPhone(p.phone);
  if (!phone) return { status:'error', message:'Phone required.' };

  const lock = LockService.getScriptLock();
  let gotLock = false;
  try { gotLock = lock.tryLock(20000); } catch (e) {}
  if (!gotLock) return { status:'error', code:'busy', message:'Server is busy — try again.' };

  const counts = { orders:0, sessions:0, subs:0, promoUses:0, user:0 };
  try {
    // Har sheet me NEECHE se UPAR delete karo — warna row numbers khisak jaate hain
    const del = (sh, phoneCol, width) => {
      const last = sh.getLastRow();
      if (last < 2) return 0;
      const vals = sh.getRange(2, 1, last - 1, width).getValues();
      let n = 0;
      for (let i = vals.length - 1; i >= 0; i--) {
        if (cleanPhone(vals[i][phoneCol]) === phone) { sh.deleteRow(i + 2); n++; }
      }
      return n;
    };

    counts.orders    = del(ordersSheet(),    5, 6);   // col6 = Phone
    // Sessions delete karne se pehle unke tokens purge karo CacheService se —
    // warna deleteRow() se row-numbers khisak jaate hain, aur ek stale cached
    // session (uRow purana) galti se KISI AUR user ke row pe operate kar sakta hai.
    try {
      const ssh = sessionsSheet(); const slast = ssh.getLastRow();
      if (slast >= 2) {
        const svals = ssh.getRange(2, 1, slast - 1, 3).getValues();
        svals.forEach(r => { if (cleanPhone(r[1]) === phone) { try { CacheService.getScriptCache().remove('sess_' + CURRENT_VENDOR_ID + '_' + r[0]); } catch (e) {} } });
      }
    } catch (e) {}
    counts.sessions  = del(sessionsSheet(),  1, 3);   // col2 = Phone
    counts.promoUses = del(promoUsesSheet(), 1, 5);   // col2 = Phone
    try { counts.subs = del(subsSheet(), 0, 3); } catch (e) {}   // col1 = Phone

    // User row aakhir me — taaki wo bilkul naya sign-up kare
    const uSh = usersSheet();
    const uRow = findRowByPhone(uSh, phone);
    if (uRow !== -1) { uSh.deleteRow(uRow); counts.user = 1; }
    bumpUsersVer();   // rows khisak gayi — saari cached sessions turant invalid

    resetOrdersCache();   // in-memory cache stale ho gaya
    audit('USER_RESET', phone, JSON.stringify(counts));
    return { status:'success', counts: counts };
  } catch (e) {
    return { status:'error', message: 'Reset failed: ' + e };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ═══════════ ORDERS SHEET (v4 se same) ═══════════
function ordersSheet() {
  const sh = sheetWithHeaders(ORDERS_SHEET, [
    'Timestamp','Day','Society','Flat','Name','Phone',
    'Breakfast Qty','Lunch Qty','Lunch Sabzi','Lunch Roti','Lunch Addons',
    'Dinner Qty','Dinner Sabzi','Dinner Roti','Dinner Addons',
    'Note','Payment','Total','Status','Delivery Date'
  ]);
  // ⚠️ PERF: ye header-ensure block pehle HAR call pe chalta tha (~20 Sheets round-trips).
  // Order place karne me ordersSheet() 2-3 baar call hota hai → 40-60 bekaar calls per order.
  // Ab din me ek baar chalta hai (CacheService flag), baaki calls seedha sheet return karti hain.
  const _hdrKey = 'ordhdr_' + CURRENT_VENDOR_ID;
  try { if (CacheService.getScriptCache().get(_hdrKey)) return sh; } catch (e) {}
  if (!sh.getRange(1, STATUS_COL).getValue()) sh.getRange(1, STATUS_COL).setValue('Status');
  if (!sh.getRange(1, DELDATE_COL).getValue()) sh.getRange(1, DELDATE_COL).setValue('Delivery Date');
  // Delivery time-slot columns (added after original 20 so existing indices stay valid)
  if (!sh.getRange(1, 21).getValue()) sh.getRange(1, 21).setValue('Breakfast Time');
  if (!sh.getRange(1, 22).getValue()) sh.getRange(1, 22).setValue('Lunch Time');
  if (!sh.getRange(1, 23).getValue()) sh.getRange(1, 23).setValue('Dinner Time');
  if (!sh.getRange(1, 24).getValue()) sh.getRange(1, 24).setValue('Lunch Tiffin');
  if (!sh.getRange(1, 26).getValue()) sh.getRange(1, 26).setValue('PaymentStatus');
  if (!sh.getRange(1, 27).getValue()) sh.getRange(1, 27).setValue('Promo');
  if (!sh.getRange(1, 25).getValue()) sh.getRange(1, 25).setValue('Dinner Tiffin');
  if (!sh.getRange(1, 29).getValue()) sh.getRange(1, 29).setValue('Meal Status');
  try { CacheService.getScriptCache().put(_hdrKey, '1', 21600); } catch (e) {}
  return sh;
}

function isDuplicate(phone, deliveryDate) {
  if (!phone || !deliveryDate) return false;
  const sh = ordersSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return false;
  // ⚠️ PERF: pehle poori sheet scan hoti thi (10k rows = har order pe 10k rows padho).
  // Duplicate hamesha HAAL ka hota hai (same delivery date), isliye sirf aakhri
  // DUP_SCAN rows dekhna kaafi hai — 3 mahine ka data bhi isme aa jaata hai.
  const DUP_SCAN = 600;
  const startRow = Math.max(2, lastRow - DUP_SCAN + 1);
  const data = sh.getRange(startRow, 1, lastRow - startRow + 1, 20).getValues();
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (cleanPhone(r[5]) === phone && ddStr(r[19]) === deliveryDate && r[18] !== 'Cancelled') return true;
  }
  return false;
}

// ═══════ PROMO / COUPON MODULE ═══════
const PROMOS_SHEET = 'Promos';
const PROMO_USES_SHEET = 'PromoUses';
function promosSheet(){
  const sh = sheetWithHeaders(PROMOS_SHEET, ['Code','Type','Value','MaxDiscount','MinOrder','FirstOrderOnly','PerUserLimit','TotalLimit','Expiry','Active','Created','Visible']);
  if (!sh.getRange(1, 12).getValue()) sh.getRange(1, 12).setValue('Visible');
  return sh;
}
// App me customers ko dikhne wale promos (sirf active + visible + not expired) — koi internal data nahi.
function publicPromos(){
  try {
    const cached = CacheService.getScriptCache().get('promos_' + CURRENT_VENDOR_ID);
    if (cached) return JSON.parse(cached);
  } catch (e) {}
  const out = publicPromosUncached();
  try { CacheService.getScriptCache().put('promos_' + CURRENT_VENDOR_ID, JSON.stringify(out), 60); } catch (e) {}
  return out;
}
function resetPromosCache() { try{ CacheService.getScriptCache().remove('promos_' + CURRENT_VENDOR_ID); }catch(e){} }
function publicPromosUncached(){
  const sh=promosSheet(); const lr=sh.getLastRow(); if(lr<2) return [];
  const t=todayIST(); const out=[];
  sh.getRange(2,1,lr-1,12).getValues().forEach(r=>{
    const code=String(r[0]).trim().toUpperCase(); if(!code) return;
    if(String(r[9])!=='1') return;                 // active
    if(String(r[11])!=='1') return;                // visible
    if(r[8]){ const es=ddStr(r[8])||String(r[8]).slice(0,10); if(es && t>es) return; }
    const type=String(r[1]).toUpperCase(), val=parseInt(r[2],10)||0, maxD=parseInt(r[3],10)||0;
    out.push({ code:code, label:(type==='PERCENT'?(val+'% off'+(maxD?(' (max ₹'+maxD+')'):'')):('₹'+val+' off')), minOrder:parseInt(r[4],10)||0, firstOnly:String(r[5])==='1' });
  });
  return out.slice(0,5);
}
function promoUsesSheet(){ return sheetWithHeaders(PROMO_USES_SHEET, ['Code','Phone','Date','OrderRow','Discount']); }
function promoUsesRows(){ const sh=promoUsesSheet(); const lr=sh.getLastRow(); return lr<2?[]:sh.getRange(2,1,lr-1,5).getValues(); }
function recordPromoUse(code, phone, row, discount){
  promoUsesSheet().appendRow([code, "'" + phone, todayIST(), row, discount]);
}
// Core validator — SERVER-SIDE hi discount decide hota hai (client sirf preview).
function evalPromo(codeRaw, phone, amount){
  const code = String(codeRaw||'').trim().toUpperCase();
  if(!code) return { ok:false, message:'Please enter a coupon code' };
  const sh = promosSheet(); const lr = sh.getLastRow();
  if(lr<2) return { ok:false, message:'Invalid coupon code' };
  const data = sh.getRange(2,1,lr-1,10).getValues();
  const r = data.find(x=>String(x[0]).trim().toUpperCase()===code);
  if(!r) return { ok:false, message:'Invalid coupon code' };
  const type=String(r[1]).toUpperCase(), val=parseInt(r[2],10)||0, maxD=parseInt(r[3],10)||0,
        minO=parseInt(r[4],10)||0, firstOnly=String(r[5])==='1', perU=parseInt(r[6],10)||1,
        totL=parseInt(r[7],10)||0, exp=r[8], active=String(r[9])==='1';
  if(!active) return { ok:false, message:'This coupon is not active' };
  const t=todayIST();
  if(exp){ const es=ddStr(exp)||String(exp).slice(0,10); if(es && t>es) return { ok:false, message:'This coupon has expired' }; }
  if(amount < minO) return { ok:false, message:'Minimum order of ₹'+minO+' required for this coupon' };
  if(firstOnly){
    const prior = allOrders().some(o=>o.phone===phone && o.status!=='Cancelled');
    if(prior) return { ok:false, message:'This coupon is valid only on your first order' };
  }
  const uses = promoUsesRows();
  const mine = uses.filter(u=>String(u[0]).toUpperCase()===code && cleanPhone(u[1])===phone).length;
  if(mine >= perU) return { ok:false, message:'You have already used this coupon' };
  if(totL>0){ const all=uses.filter(u=>String(u[0]).toUpperCase()===code).length; if(all>=totL) return { ok:false, message:'This coupon has reached its usage limit' }; }
  let d = (type==='PERCENT') ? Math.floor(amount*val/100) : val;
  if(type==='PERCENT' && maxD>0) d=Math.min(d,maxD);
  d=Math.max(0,Math.min(d,amount));
  if(d<=0) return { ok:false, message:'Invalid coupon value' };
  return { ok:true, discount:d, code:code, label:(type==='PERCENT'?(val+'% off'+(maxD?(' (max ₹'+maxD+')'):'')):('₹'+val+' off')) };
}
function listPromos(){
  const sh=promosSheet(); const lr=sh.getLastRow();
  const uses=promoUsesRows();
  const out=[];
  if(lr>=2){ sh.getRange(2,1,lr-1,12).getValues().forEach((r,i)=>{
    const code=String(r[0]).trim().toUpperCase(); if(!code)return;
    out.push({ row:i+2, code:code, type:String(r[1]).toUpperCase(), value:parseInt(r[2],10)||0, maxDiscount:parseInt(r[3],10)||0, minOrder:parseInt(r[4],10)||0, firstOnly:String(r[5])==='1', perUser:parseInt(r[6],10)||1, totalLimit:parseInt(r[7],10)||0, expiry:r[8]?(ddStr(r[8])||String(r[8]).slice(0,10)):'', active:String(r[9])==='1', visible:String(r[11])==='1', used:uses.filter(u=>String(u[0]).toUpperCase()===code).length });
  }); }
  return out;
}
function savePromo(p){
  const code=String(p.code||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,20);
  if(!code) return { status:'error', message:'Code required' };
  const type=(String(p.type).toUpperCase()==='PERCENT')?'PERCENT':'FLAT';
  const val=Math.max(1,parseInt(p.value,10)||0);
  const row=[code,type,val,parseInt(p.maxDiscount,10)||0,parseInt(p.minOrder,10)||0,String(p.firstOnly)==='1'?'1':'0',Math.max(1,parseInt(p.perUser,10)||1),parseInt(p.totalLimit,10)||0,String(p.expiry||'').slice(0,10),String(p.active)==='1'?'1':'0',new Date(),String(p.visible)==='1'?'1':'0'];
  const sh=promosSheet(); const lr=sh.getLastRow();
  let found=-1;
  if(lr>=2){ const codes=sh.getRange(2,1,lr-1,1).getValues(); codes.forEach((c,i)=>{ if(String(c[0]).trim().toUpperCase()===code) found=i+2; }); }
  if(found>0) sh.getRange(found,1,1,12).setValues([row]); else sh.appendRow(row);
  audit('PROMO_SAVED','',code);
  resetPromosCache();
  return { status:'success', promos:listPromos() };
}
function deletePromo(p){
  const code=String(p.code||'').trim().toUpperCase();
  const sh=promosSheet(); const lr=sh.getLastRow();
  if(lr>=2){ const codes=sh.getRange(2,1,lr-1,1).getValues(); for(let i=codes.length-1;i>=0;i--){ if(String(codes[i][0]).trim().toUpperCase()===code){ sh.deleteRow(i+2); break; } } }
  audit('PROMO_DELETED','',code);
  resetPromosCache();
  return { status:'success', promos:listPromos() };
}

// Telegram push — silently skips if not configured; never blocks order flow.
function notifyTelegram(text) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN + '/sendMessage', {
      method: 'post',
      payload: { chat_id: TG_CHAT_ID, text: text },
      muteHttpExceptions: true
    });
  } catch (e) {}
}
function tgOrderMsg(p, name, total, tag) {
  const meals = [];
  if (parseInt(p.breakfastQty,10)) meals.push('🌅 Breakfast ×' + p.breakfastQty);
  if (parseInt(p.lunchQty,10))     meals.push('☀️ Lunch ×' + p.lunchQty + (p.lunchTiffin ? ' (' + p.lunchTiffin + ')' : ''));
  if (parseInt(p.dinnerQty,10))    meals.push('🌙 Dinner ×' + p.dinnerQty + (p.dinnerTiffin ? ' (' + p.dinnerTiffin + ')' : ''));
  return (tag || '🆕 NEW ORDER') + '\n' +
    '👤 ' + name + '\n' +
    ((String(p.deliveryType||'home')==='office') ? ('🏢 ' + (p.society || '') + ' · Emp ID ' + (p.flatNo || '')) : ('🏠 ' + (p.society || '') + ' ' + (p.flatNo || ''))) + '\n' +
    '📅 ' + (p.deliveryDate || '') + '\n' +
    meals.join('\n') + '\n' +
    '💰 ₹' + total + ' · ' + (p.payment || 'COD') + (p.promoApplied ? ('\n🎟️ ' + p.promoApplied) : '') + '\n' +
    '📞 ' + (p.phone || '');
}

function saveOrder(p, phone, name, total, promoStr) {
  // ⚠️ Qty wahi source se lo jisse paisa banta hai. Pehle sirf flat fields padhte the —
  // agar client sirf items[] bheje to sheet me qty 0 likhi jaati thi: total sahi,
  // par Kitchen Summary ko pata hi nahi chalta ki kya banana hai, aur per-meal
  // status bhi kaam nahi karta.
  const wq = mealQtys(p);
  const it1 = m => (Array.isArray(p.items) ? p.items.filter(x => x.meal === m) : []);
  const pick = (m, key, flat) => {
    const l = it1(m); if (l.length && l[0][key] != null && l[0][key] !== '') return String(l[0][key]);
    return String(p[flat] || '');
  };
  ordersSheet().appendRow([
    new Date(),
    safeCell(p.day || ''), safeCell(p.society || ''), safeCell(p.flatNo || ''), safeCell(name), "'" + phone,
    wq.breakfast,
    wq.lunch, safeCell(pick('lunch','sabzi','lunchSabzi')), safeCell(pick('lunch','roti','lunchRoti')), safeCell(p.lunchAddons || ''),
    wq.dinner, safeCell(pick('dinner','sabzi','dinnerSabzi')), safeCell(pick('dinner','roti','dinnerRoti')), safeCell(p.dinnerAddons || ''),
    safeCell(p.note || ''), safeCell(p.payment || ''), '₹' + total,
    'Pending',
    "'" + p.deliveryDate,
    safeCell(p.breakfastTimeSlot || ''), safeCell(p.lunchTimeSlot || ''), safeCell(p.dinnerTimeSlot || ''),
    safeCell(p.lunchTiffin || ''), safeCell(p.dinnerTiffin || ''),
    '', (promoStr || ''), (p.deliveryType || 'home')
  ]);
}

// Har meal ka apna status. Purane orders me ye column khaali hoga —
// tab poore order ka status hi teeno meals pe laga dete hain (backward compatible).
const MEAL_KEYS = ['breakfast','lunch','dinner'];
function parseMealStatus(raw, orderStatus) {
  let o = {};
  try { if (raw) o = JSON.parse(raw); } catch (e) { o = {}; }
  const out = {};
  MEAL_KEYS.forEach(function(m){
    out[m] = (o && ADMIN_STATUS.indexOf(o[m]) >= 0) ? o[m] : orderStatus;
  });
  return out;
}
// Order ka overall status meals se banta hai: sab Delivered → Delivered,
// koi Preparing → Preparing, sab Cancelled → Cancelled, warna Pending.
function deriveOrderStatus(ms, activeMeals) {
  const live = activeMeals.map(function(m){ return ms[m]; });
  if (!live.length) return 'Pending';
  if (live.every(function(x){ return x === 'Cancelled'; })) return 'Cancelled';
  const notCancelled = live.filter(function(x){ return x !== 'Cancelled'; });
  if (notCancelled.every(function(x){ return x === 'Delivered'; })) return 'Delivered';
  if (notCancelled.some(function(x){ return x === 'Preparing'; })) return 'Preparing';
  return 'Pending';
}
function setMealStatus(p) {
  const sh = ordersSheet();
  const row = parseInt(p.row, 10);
  const meal = String(p.meal || '');
  if (!row || row < 2 || row > sh.getLastRow()) return { status:'error', message:'Invalid row' };
  if (MEAL_KEYS.indexOf(meal) === -1) return { status:'error', message:'Invalid meal' };
  if (ADMIN_STATUS.indexOf(p.status) === -1) return { status:'error', message:'Invalid status' };
  const sheetPhone = cleanPhone(sh.getRange(row, 6).getValue());
  if (sheetPhone !== String(p.phone || '')) return { status:'error', message:'Order mismatch — please refresh.' };

  const cur = parseMealStatus(sh.getRange(row, 29).getValue(), sh.getRange(row, STATUS_COL).getValue() || 'Pending');
  cur[meal] = p.status;
  sh.getRange(row, 29).setValue(JSON.stringify(cur));

  // Sirf un meals ko gino jinki qty > 0
  const qtyCol = { breakfast:7, lunch:8, dinner:12 };
  const active = MEAL_KEYS.filter(function(m){ return Number(sh.getRange(row, qtyCol[m]).getValue()) > 0; });
  const overall = deriveOrderStatus(cur, active);
  sh.getRange(row, STATUS_COL).setValue(overall);
  return { status:'success', mealStatus: cur, orderStatus: overall };
}

function rowToOrder(r, rowNum) {
  const created = (r[0] instanceof Date) ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : '';
  return {
    row: rowNum,
    time: (r[0] instanceof Date) ? Utilities.formatDate(r[0], TZ, 'dd/MM hh:mm a') : '',
    day: r[1], society: r[2], flat: r[3], name: r[4], phone: cleanPhone(r[5]),
    breakfastQty: r[6] || 0,
    lunchQty: r[7] || 0, lunchSabzi: r[8] || '', lunchRoti: r[9] || '', lunchAddons: r[10] || '',
    dinnerQty: r[11] || 0, dinnerSabzi: r[12] || '', dinnerRoti: r[13] || '', dinnerAddons: r[14] || '',
    note: r[15] || '', payment: r[16] || '', total: r[17] || '',
    status: r[18] || 'Pending',
    deliveryDate: ddStr(r[19]) || created,
    breakfastTimeSlot: r[20] || '', lunchTimeSlot: r[21] || '', dinnerTimeSlot: r[22] || '',
    lunchTiffin: r[23] || '', dinnerTiffin: r[24] || '',
    paymentStatus: r[25] || 'Unpaid',
    deliveryType: r[27] || 'home',
    promo: r[26] || '',
    mealStatus: parseMealStatus(r[28], r[18] || 'Pending'),
    createdIso: (r[0] instanceof Date) ? Utilities.formatDate(r[0], TZ, "yyyy-MM-dd'T'HH:mm") : ''
  };
}

function allOrders() {
  const sh = ordersSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const data = sh.getRange(2, 1, lastRow - 1, 29).getValues();
  return data.map((r, i) => rowToOrder(r, i + 2));
}

function readOrders(range, date) {
  const orders = allOrders();
  const t = todayIST();
  let out;
  if (date) out = orders.filter(o => o.deliveryDate === String(date));
  else if (range === 'today') out = orders.filter(o => o.deliveryDate === t);
  else out = orders;
  if (out.length > 100) out = out.slice(-100);
  return out.reverse();
}

function readMyOrders(phone, date) {
  if (!phone) return [];
  const t = todayIST();
  let out = allOrders().filter(o => o.phone === phone);
  if (date) out = out.filter(o => o.deliveryDate === String(date));
  else out = out.filter(o => o.deliveryDate >= t);
  out.sort((a, b) => a.deliveryDate < b.deliveryDate ? -1 : 1);
  return out.slice(0, 20);
}

function setOrderStatus(p) {
  const sh = ordersSheet();
  const row = parseInt(p.row, 10);
  if (!row || row < 2 || row > sh.getLastRow()) return { status:'error', message:'Invalid row' };
  if (ADMIN_STATUS.indexOf(p.status) === -1) return { status:'error', message:'Invalid status' };
  const sheetPhone = cleanPhone(sh.getRange(row, 6).getValue());
  if (sheetPhone !== String(p.phone || '')) return { status:'error', message:'Order mismatch — please refresh.' };
  sh.getRange(row, STATUS_COL).setValue(p.status);
  return { status:'success' };
}

// ═══════════ TELEGRAM ═══════════
// Order aate hi phone pe instant alert. Email se tez, app khula rakhne ki zaroorat nahi.
function sendTelegram(text) {
  const v = currentVendor();
  if (!v.tgBotToken || !v.tgChatId) return;   // configure nahi kiya → chup-chaap skip
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + v.tgBotToken + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: v.tgChatId, text: text, parse_mode: 'HTML' }),
      muteHttpExceptions: true
    });
  } catch (e) { /* Telegram fail ho to order kabhi fail nahi hona chahiye */ }
}

// EK BAAR chalao (vendorId optional — default vendor ke liye chalega): bot ko koi
// message bhejo, phir ye function Run karo. Execution log me chat ID dikhega —
// usse VENDORS registry mein us vendor ke tgChatId mein paste kar do.
function getTelegramChatId(vendorId) {
  CURRENT_VENDOR_ID = resolveVendor(vendorId);
  const token = currentVendor().tgBotToken;
  if (!token) { Logger.log('Pehle is vendor ka tgBotToken VENDORS registry mein daalo.'); return; }
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true });
  const j = JSON.parse(r.getContentText());
  if (!j.ok || !j.result || !j.result.length) { Logger.log('Koi message nahi mila. Pehle apne bot ko Telegram pe "hi" bhejo, phir dobara Run karo.'); return; }
  const last = j.result[j.result.length - 1];
  const chat = (last.message && last.message.chat) || (last.channel_post && last.channel_post.chat);
  Logger.log('✅ CHAT ID: ' + (chat && chat.id) + '   (ise TELEGRAM_CHAT_ID me paste karo)');
}

// Setup test — token+chatID daalne ke baad ye Run karke check karo
function sendTestTelegram() {
  sendTelegram('✅ <b>Nest & Nosh</b>\nTelegram alerts chalu ho gaye!');
  Logger.log('Bhej diya — Telegram check karo.');
}

function sendOrderTelegram(p, phone, name, total) {
  const isOff = String(p.deliveryType || 'home') === 'office';
  let tg = '🍱 <b>NEW ORDER</b>\n\n';
  tg += '👤 <b>' + name + '</b>\n📱 ' + phone + '\n';
  tg += '📅 ' + (p.deliveryDate || '') + ' (' + (p.day || '') + ')\n';
  tg += '📍 ' + (isOff ? ((p.society || '') + ' — Emp ID: ' + (p.flatNo || '')) : ((p.society || '') + ', Flat ' + (p.flatNo || ''))) + '\n\n';
  if (parseInt(p.breakfastQty, 10)) tg += '🌅 Breakfast × ' + p.breakfastQty + '\n';
  if (parseInt(p.lunchQty, 10))     tg += '☀️ Lunch × ' + p.lunchQty + ' — ' + (p.lunchSabzi || '') + '\n';
  if (parseInt(p.dinnerQty, 10))    tg += '🌙 Dinner × ' + p.dinnerQty + ' — ' + (p.dinnerSabzi || '') + '\n';
  if (p.note && p.note !== 'None')  tg += '📝 ' + p.note + '\n';
  tg += '\n💳 ' + (p.payment || '') + '\n💰 <b>₹' + total + '</b>';
  sendTelegram(tg);
}

// ═══════════ EMAIL / DIGEST ═══════════
function sendOrderEmail(p, phone, name, total) {
  const subject = '🍱 NEW ORDER — ' + name + ' | Delivery: ' + (p.deliveryDate || '') + ' | ₹' + total;
  const row = (k, v) => '<tr><td style="border:1px solid #ddd;padding:6px;font-weight:bold;background:#f6f6ff;">' + k + '</td><td style="border:1px solid #ddd;padding:6px;">' + (v || '-') + '</td></tr>';
  let body = '<h2 style="color:#667eea;">🍱 New Tiffin Order!</h2><table style="border-collapse:collapse;font-family:Arial;font-size:14px;">';
  body += row('📅 Delivery', (p.deliveryDate || '') + ' (' + (p.day || '') + ')') + row('👤 Name', name);
  body += row('📱 Phone', '<a href="tel:+91' + phone + '">' + phone + '</a> ✓verified');
  body += row('📍 Address', (String(p.deliveryType||'home')==='office') ? ((p.society||'') + ' — Employee ID: ' + (p.flatNo||'')) : ((p.society||'') + ', Flat ' + (p.flatNo||'') + ', Godrej Garden City'));
  if (parseInt(p.breakfastQty,10)) body += row('🌅 Breakfast', 'Qty: ' + p.breakfastQty);
  if (parseInt(p.lunchQty,10)) body += row('☀️ Lunch × ' + p.lunchQty, 'Sabzi: ' + p.lunchSabzi + '<br>Roti: ' + p.lunchRoti + '<br>Add-ons: ' + p.lunchAddons);
  if (parseInt(p.dinnerQty,10)) body += row('🌙 Dinner × ' + p.dinnerQty, 'Sabzi: ' + p.dinnerSabzi + '<br>Roti: ' + p.dinnerRoti + '<br>Add-ons: ' + p.dinnerAddons);
  body += row('📝 Note', p.note) + row('💳 Payment', p.payment);
  body += row('💰 TOTAL', '<b style="font-size:16px;color:#00b894;">₹' + total + '</b>') + '</table>';
  MailApp.sendEmail({ to: currentVendor().notifyEmail, subject: subject, htmlBody: body });
}

// Triggers: ⏰ Triggers → + Add → sendDailyDigest → Time-driven → Day timer
//   Trigger 1: 5am-6am | Trigger 2: 2pm-3pm
// Ek hi trigger sab vendors ke liye chalta hai — har vendor ka apna digest, apne email pe.
function sendDailyDigest() {
  Object.keys(VENDORS).forEach(function(vid){
    CURRENT_VENDOR_ID = vid;
    try { sendDailyDigestForVendor(); } catch (e) { /* ek vendor fail ho to baaki na ruken */ }
  });
}
function sendDailyDigestForVendor() {
  const orders = readOrders('today');
  const dateLabel = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy');

  if (!orders.length) {
    MailApp.sendEmail({ to: currentVendor().notifyEmail, subject: '🍱 Digest — ' + dateLabel + ' — 0 orders', htmlBody: '<p>Aaj delivery ka koi order nahi.</p>' });
    return;
  }

  let revenue = 0, pending = 0;
  const active = [];
  orders.forEach(o => {
    if (o.status !== 'Cancelled') revenue += Number(String(o.total).replace(/[^\d]/g, '')) || 0;
    if (o.status === 'Pending' || o.status === 'Preparing') { pending++; active.push(o); }
  });

  const sum = { bQty: 0 };
  ['lunch','dinner'].forEach(m => sum[m] = { qty:0, sabzi:{}, butter:0, extraRoti:0, dahi:0, extraSabzi:0 });
  active.forEach(o => {
    sum.bQty += Number(o.breakfastQty) || 0;
    ['lunch','dinner'].forEach(m => {
      const q = Number(o[m + 'Qty']) || 0; if (!q) return;
      const s = sum[m]; s.qty += q;
      const sb = o[m + 'Sabzi'] || '?'; s.sabzi[sb] = (s.sabzi[sb] || 0) + q;
      if (o[m + 'Roti'] === 'Butter') s.butter += q;
      const ad = String(o[m + 'Addons'] || '');
      const ex = ad.match(/(\d+)\s*Extra Roti/); if (ex) s.extraRoti += Number(ex[1]) * q;
      if (/Dahi/.test(ad)) s.dahi += q;
      if (/Extra Sabzi/.test(ad)) s.extraSabzi += q;
    });
  });

  const sabziList = obj => Object.keys(obj).map(k => k + ' × ' + obj[k]).join(', ') || '—';
  let kitchen = '<h3 style="color:#7a5b00;">🍳 Kitchen Summary (jo banana hai)</h3><ul style="font-size:14px;line-height:1.7;">';
  kitchen += '<li>🌅 <b>Breakfast:</b> ' + sum.bQty + ' tiffin</li>';
  ['lunch','dinner'].forEach(m => {
    const s = sum[m];
    kitchen += '<li>' + (m === 'lunch' ? '☀️ <b>Lunch:</b> ' : '🌙 <b>Dinner:</b> ') + s.qty + ' tiffin — ' + sabziList(s.sabzi);
    kitchen += '<br><span style="color:#666;">Butter roti tiffin: ' + s.butter + ' · Extra roti (pcs): ' + s.extraRoti + ' · Dahi: ' + s.dahi + ' · Extra sabzi: ' + s.extraSabzi + '</span></li>';
  });
  kitchen += '</ul>';

  let table = '<table style="border-collapse:collapse;font-family:Arial;font-size:12px;width:100%;">';
  table += '<tr style="background:#667eea;color:#fff;"><th style="padding:6px;">Order Time</th><th>Name</th><th>Address</th><th>Phone</th><th>Meals</th><th>Pay</th><th>Total</th><th>Status</th></tr>';
  orders.forEach(o => {
    const meals = [];
    if (Number(o.breakfastQty)) meals.push('🌅×' + o.breakfastQty);
    if (Number(o.lunchQty)) meals.push('☀️ ' + o.lunchSabzi + ' ×' + o.lunchQty + ' (' + o.lunchRoti + ')' + (o.lunchAddons && o.lunchAddons !== 'None' ? ' +' + o.lunchAddons : ''));
    if (Number(o.dinnerQty)) meals.push('🌙 ' + o.dinnerSabzi + ' ×' + o.dinnerQty + ' (' + o.dinnerRoti + ')' + (o.dinnerAddons && o.dinnerAddons !== 'None' ? ' +' + o.dinnerAddons : ''));
    const bg = o.status === 'Cancelled' ? '#fdecea' : o.status === 'Delivered' ? '#f2fff7' : (o.status === 'Preparing' ? '#eef6ff' : '#fffbe8');
    table += '<tr style="background:' + bg + ';">'
      + '<td style="padding:5px;border-bottom:1px solid #eee;">' + o.time + '</td>'
      + '<td style="border-bottom:1px solid #eee;">' + o.name + '</td>'
      + '<td style="border-bottom:1px solid #eee;">' + o.society + ' ' + o.flat + '</td>'
      + '<td style="border-bottom:1px solid #eee;">' + o.phone + '</td>'
      + '<td style="border-bottom:1px solid #eee;">' + meals.join('<br>') + (o.note && o.note !== 'None' ? '<br>📝 ' + o.note : '') + '</td>'
      + '<td style="border-bottom:1px solid #eee;">' + o.payment + '</td>'
      + '<td style="border-bottom:1px solid #eee;"><b>' + o.total + '</b></td>'
      + '<td style="border-bottom:1px solid #eee;">' + o.status + '</td></tr>';
  });
  table += '</table>';

  const subject = '🍱 Digest — ' + dateLabel + ' — ' + orders.length + ' orders · ₹' + revenue + ' (Pending: ' + pending + ')';
  const body = '<h2 style="color:#667eea;">🍱 Nest & Nosh — Daily Digest</h2>'
    + '<p style="font-size:14px;"><b>' + orders.length + ' orders</b> (aaj delivery) · Revenue: <b>₹' + revenue + '</b> · Banana baaki: <b>' + pending + '</b></p>'
    + kitchen + '<h3>🧾 Sab Orders</h3>' + table
    + '<p style="color:#888;font-size:12px;">Live status update ke liye app ke Admin panel mein jao.</p>';

  MailApp.sendEmail({ to: currentVendor().notifyEmail, subject: subject, htmlBody: body });
}

// ═══════════ MENU / STATS ═══════════
function readMenu() {
  if (_menuCache) return _menuCache;
  try {
    const cached = CacheService.getScriptCache().get('menu_' + CURRENT_VENDOR_ID);
    if (cached) { _menuCache = JSON.parse(cached); return _menuCache; }
  } catch (e) {}
  const result = readMenuUncached();
  if (result) {
    _menuCache = result;
    try { CacheService.getScriptCache().put('menu_' + CURRENT_VENDOR_ID, JSON.stringify(result), 60); } catch (e) {}
  }
  return result;
}
function resetMenuCache() { _menuCache = null; try{ CacheService.getScriptCache().remove('menu_' + CURRENT_VENDOR_ID); }catch(e){} }
function readMenuUncached() {
  const sh = getSS().getSheetByName(MENU_SHEET);
  if (!sh) return null;
  const raw = sh.getRange(1, 1).getValue();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function saveMenu(menu) {
  const ss = getSS();
  let sh = ss.getSheetByName(MENU_SHEET);
  if (!sh) sh = ss.insertSheet(MENU_SHEET);
  sh.getRange(1, 1).setValue(JSON.stringify(menu));
  sh.getRange(2, 1).setValue('⚠️ Cell A1 manually edit mat karo — app ke Admin panel se update karo. Last: ' + Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, hh:mm a'));
  resetMenuCache();
}

// ═══════════ CONFIG (prices, township, societies) ═══════════
function defaultVariants() {
  const mk = (id,name,price,items) => ({ id:id, name:name, price:price, items:items, img:'' });
  const ld = [
    mk('mini','Mini Tiffin',60,['🫓 Roti (4)','🍛 1 Sabzi','🥗 Salad']),
    mk('full','Full Tiffin',80,['🫓 Roti (5)','🍛 1 Sabzi','🍲 Daal','🍚 Chawal','🥛 Chaas','🥒 Achar','🥗 Salad','🍬 Sweet'])
  ];
  return {
    breakfast: [ mk('std','Breakfast',80,['🍚 Poha / Paratha (daily varies)','🍵 Chai']) ],
    lunch: JSON.parse(JSON.stringify(ld)),
    dinner: JSON.parse(JSON.stringify(ld))
  };
}
// Clean/validate an incoming variants object; ensures ids unique per meal.
function sanitizeVariants(v) {
  const out = {};
  ['breakfast','lunch','dinner'].forEach(m => {
    const list = Array.isArray(v[m]) ? v[m] : [];
    const seen = {};
    out[m] = list.map((x,i) => {
      let id = String(x.id || '').trim().toLowerCase().replace(/[^a-z0-9]/g,'') || ('v'+i);
      while (seen[id]) id = id + i;   // guarantee uniqueness
      seen[id] = 1;
      let price = parseInt(x.price,10); if (isNaN(price)||price<0) price = 0; price = Math.min(5000,price);
      const name = String(x.name||'').slice(0,40) || id;
      const items = Array.isArray(x.items) ? x.items.map(s=>String(s).slice(0,60)).filter(Boolean).slice(0,20) : [];
      const img = String(x.img||'').slice(0,300);
      return { id:id, name:name, price:price, items:items, img:img };
    }).filter(x=>x.name).slice(0,10);   // max 10 variants per meal
    if (!out[m].length) out[m] = defaultVariants()[m];
  });
  return out;
}

function defaultConfig() {
  return {
    prices: { breakfast:30, lunch:80, dinner:80, tiffinMini:60, extraRotiPlain:12, extraRotiButter:16, dahi:20, extraSabzi:30 },
    township: 'Godrej Garden City',
    societies: ['Vrindavan','Eden'],
    // Delivery: <=3km ₹10, beyond ₹20. farSocieties me jo naam honge unpe ₹20, baaki sab ₹10.
    deliveryNear: 10, deliveryFar: 20, farSocieties: [],
    closedDates: [], capacity: { breakfast:0, lunch:0, dinner:0 },
    variants: defaultVariants(),
    banners: { breakfast:'', lunch:'', dinner:'' },   // optional meal banner images
    upiId: '', upiName: 'Nest & Nosh',        // online UPI payment (Option A)
    fssai: '',                                         // FSSAI reg no. shown in footer
    whatsappAuto: true,     // order place hote hi WhatsApp auto-open ho ya nahi
    mealsEnabled: { breakfast:true, lunch:true, dinner:true },   // kaunsa meal customer ko dikhe
    // ── B2B corporate mode ──
    homeEnabled: true,      // society/flat delivery on/off
    officeEnabled: false,   // company/office delivery on/off
    companies: []           // [{ name, building, fee }] — Employee ID optional hai
  };
}
function sanitizeCompanies(list) {
  if (!Array.isArray(list)) return [];
  const d = { deliveryNear: 10 };
  return list.map(x => {
    if (!x) return null;
    const name = String(x.name || '').slice(0, 60).trim();
    if (!name) return null;
    let fee = parseInt(x.fee, 10);
    if (isNaN(fee) || fee < 0) fee = d.deliveryNear;
    return { name: name, building: String(x.building || '').slice(0, 40).trim(), fee: Math.min(500, fee) };
  }).filter(Boolean).slice(0, 50);
}
function findCompany(name) {
  const c = readConfig();
  const n = String(name || '').toLowerCase().trim();
  return (c.companies || []).find(x => String(x.name).toLowerCase().trim() === n) || null;
}
// Order ka delivery fee: office => company fee, home => society (near/far)
function deliveryFeeForOrder(p) {
  // Us date ka pehle se koi active order hai? To ye same-trip hai — fee dobara mat lo.
  try {
    if (p.deliveryDate && p._phoneForFee) {
      const sh = ordersSheet(); const last = sh.getLastRow();
      if (last >= 2) {
        const data = sh.getRange(2, 1, last - 1, DELDATE_COL).getValues();
        for (let i = 0; i < data.length; i++) {
          const r = data[i];
          if (cleanPhone(r[5]) === p._phoneForFee && ddStr(r[19]) === p.deliveryDate && r[18] !== 'Cancelled') {
            return 0;   // is date par delivery fee already ek order me lag chuki hai
          }
        }
      }
    }
  } catch (e) {}
  if (String(p.deliveryType || 'home') === 'office') {
    const co = findCompany(p.society);
    return co ? co.fee : readConfig().deliveryNear;
  }
  return deliveryFeeFor(p.society);
}
function deliveryFeeFor(society) {
  const c = readConfig();
  const far = (c.farSocieties || []).map(s => String(s).toLowerCase().trim());
  return far.indexOf(String(society || '').toLowerCase().trim()) >= 0 ? c.deliveryFar : c.deliveryNear;
}
function readConfig() {
  if (_configCache) return _configCache;
  try {
    const cached = CacheService.getScriptCache().get('cfg_' + CURRENT_VENDOR_ID);
    if (cached) { _configCache = JSON.parse(cached); return _configCache; }
  } catch (e) {}
  const result = readConfigUncached();
  _configCache = result;
  try { CacheService.getScriptCache().put('cfg_' + CURRENT_VENDOR_ID, JSON.stringify(result), 60); } catch (e) {}
  return result;
}
function resetConfigCache() { _configCache = null; try{ CacheService.getScriptCache().remove('cfg_' + CURRENT_VENDOR_ID); }catch(e){} }
function readConfigUncached() {
  const sh = getSS().getSheetByName(CONFIG_SHEET);
  if (!sh) return defaultConfig();
  const raw = sh.getRange(1, 1).getValue();
  if (!raw) return defaultConfig();
  try {
    const c = JSON.parse(raw);
    const d = defaultConfig();
    const prices = Object.assign(d.prices, c.prices || {});
    // Variants: use saved if present, else migrate from legacy mini/full prices
    let variants;
    if (c.variants && c.variants.lunch) {
      variants = sanitizeVariants(c.variants);
    } else {
      variants = defaultVariants();
      variants.breakfast[0].price = prices.breakfast;
      variants.lunch[0].price = prices.tiffinMini; variants.lunch[1].price = prices.lunch;
      variants.dinner[0].price = prices.tiffinMini; variants.dinner[1].price = prices.dinner;
    }
    return {
      prices: prices,
      township: c.township || d.township,
      societies: (c.societies && c.societies.length) ? c.societies : d.societies,
      deliveryNear: (typeof c.deliveryNear === 'number') ? c.deliveryNear : d.deliveryNear,
      deliveryFar: (typeof c.deliveryFar === 'number') ? c.deliveryFar : d.deliveryFar,
      farSocieties: Array.isArray(c.farSocieties) ? c.farSocieties : d.farSocieties,
      closedDates: Array.isArray(c.closedDates) ? c.closedDates : d.closedDates,
      capacity: Object.assign({}, d.capacity, c.capacity || {}),
      variants: variants,
      banners: Object.assign({ breakfast:'', lunch:'', dinner:'' }, c.banners || {}),
      upiId: String(c.upiId || '').trim(),
      upiName: String(c.upiName || d.upiName).trim(),
      fssai: String(c.fssai || '').trim(),
      whatsappAuto: (c.whatsappAuto !== false),
      mealsEnabled: {
        breakfast: !(c.mealsEnabled && c.mealsEnabled.breakfast === false),
        lunch:     !(c.mealsEnabled && c.mealsEnabled.lunch === false),
        dinner:    !(c.mealsEnabled && c.mealsEnabled.dinner === false)
      },
      homeEnabled: (c.homeEnabled !== false),
      officeEnabled: (c.officeEnabled === true),
      companies: sanitizeCompanies(c.companies)
    };
  } catch (e) { return defaultConfig(); }
}
function saveConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return { status:'error', message:'Invalid config' };
  const d = defaultConfig();
  // sanitize prices — numbers only, clamp 0..5000
  const prices = {};
  Object.keys(d.prices).forEach(k => {
    let v = parseInt((cfg.prices || {})[k], 10);
    if (isNaN(v) || v < 0) v = d.prices[k];
    prices[k] = Math.min(5000, v);
  });
  const township = String(cfg.township || d.township).slice(0, 60);
  let societies = Array.isArray(cfg.societies) ? cfg.societies.map(s => String(s).slice(0, 40).trim()).filter(Boolean) : [];
  if (!societies.length) societies = d.societies;
  let dNear = parseInt(cfg.deliveryNear, 10); if (isNaN(dNear) || dNear < 0) dNear = d.deliveryNear; dNear = Math.min(500, dNear);
  let dFar = parseInt(cfg.deliveryFar, 10); if (isNaN(dFar) || dFar < 0) dFar = d.deliveryFar; dFar = Math.min(500, dFar);
  let farSoc = Array.isArray(cfg.farSocieties) ? cfg.farSocieties.map(s => String(s).slice(0, 40).trim()).filter(Boolean) : [];
  let closedDates = Array.isArray(cfg.closedDates) ? cfg.closedDates.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(String(s))).slice(0, 100) : [];
  const capacity = {};
  Object.keys(d.capacity).forEach(k => {
    let v = parseInt((cfg.capacity || {})[k], 10);
    capacity[k] = (isNaN(v) || v < 0) ? 0 : Math.min(500, v);
  });
  const upiId = String(cfg.upiId || '').slice(0, 80).trim();
  const upiName = String(cfg.upiName || d.upiName || '').slice(0, 40).trim();
  const fssai = String(cfg.fssai || '').slice(0, 40).trim();
  const companies = sanitizeCompanies(cfg.companies);
  const homeEnabled = (cfg.homeEnabled !== false);
  const officeEnabled = (cfg.officeEnabled === true);
  const clean = { prices: prices, township: township, societies: societies, deliveryNear: dNear, deliveryFar: dFar, farSocieties: farSoc, closedDates: closedDates, capacity: capacity, upiId: upiId, upiName: upiName, fssai: fssai, whatsappAuto: (cfg.whatsappAuto !== false), mealsEnabled: { breakfast: !(cfg.mealsEnabled && cfg.mealsEnabled.breakfast === false), lunch: !(cfg.mealsEnabled && cfg.mealsEnabled.lunch === false), dinner: !(cfg.mealsEnabled && cfg.mealsEnabled.dinner === false) }, companies: companies, homeEnabled: homeEnabled, officeEnabled: officeEnabled };
  // Preserve variants + banners that were set via the Variants tab (Setup save
  // must not wipe them). Read whatever is currently saved and carry it over.
  const cur = readConfig();
  clean.variants = cur.variants;
  clean.banners = cur.banners;
  const ss = getSS();
  let sh = ss.getSheetByName(CONFIG_SHEET);
  if (!sh) sh = ss.insertSheet(CONFIG_SHEET);
  sh.getRange(1, 1).setValue(JSON.stringify(clean));
  sh.getRange(2, 1).setValue('⚠️ Cell A1 manually edit mat karo — app ke Admin → Setup se update karo. Last: ' + Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, hh:mm a'));
  audit('CONFIG_SAVED', '', 'prices/township/societies updated');
  resetConfigCache();
  return { status:'success' };
}

// Admin: save meal-wise variants. { variants:{breakfast:[],lunch:[],dinner:[]}, banners:{...} }
function saveVariants(p) {
  const cur = readConfig();
  const clean = {
    prices: cur.prices, township: cur.township, societies: cur.societies,
    deliveryNear: cur.deliveryNear, deliveryFar: cur.deliveryFar, farSocieties: cur.farSocieties,
    closedDates: cur.closedDates, capacity: cur.capacity,
    variants: sanitizeVariants(p.variants || cur.variants),
    banners: Object.assign({ breakfast:'', lunch:'', dinner:'' }, p.banners || cur.banners),
    upiId: cur.upiId, upiName: cur.upiName, fssai: cur.fssai,
    companies: cur.companies, homeEnabled: cur.homeEnabled, officeEnabled: cur.officeEnabled
  };
  const ss = getSS();
  let sh = ss.getSheetByName(CONFIG_SHEET);
  if (!sh) sh = ss.insertSheet(CONFIG_SHEET);
  sh.getRange(1, 1).setValue(JSON.stringify(clean));
  audit('VARIANTS_SAVED', '', 'variants/banners updated');
  resetConfigCache();
  return { status:'success', variants: clean.variants, banners: clean.banners };
}

// Admin: ek saath kai orders ka status badlo (kitchen bulk action).
function setOrderStatusBulk(p) {
  const st = String(p.status || '');
  if (['Pending','Preparing','Delivered'].indexOf(st) < 0) return { status:'error', message:'Invalid status' };
  const rows = (Array.isArray(p.rows) ? p.rows : []).map(n => parseInt(n, 10)).filter(n => n >= 2);
  if (!rows.length) return { status:'error', message:'No orders selected' };
  const sh = ordersSheet();
  const last = sh.getLastRow();
  let done = 0;
  rows.forEach(r => { if (r <= last) { sh.getRange(r, STATUS_COL).setValue(st); done++; } });
  audit('STATUS_BULK', '', st + ' × ' + done);
  return { status:'success', updated: done, statusVal: st };
}

// Admin: mark an order's online payment as received (col 26).
function setPaid(p) {
  const row = parseInt(p.row, 10);
  if (!row || row < 2) return { status:'error', message:'Invalid row' };
  const sh = ordersSheet();
  if (row > sh.getLastRow()) return { status:'error', message:'Order not found' };
  const val = String(p.paid) === '1' ? 'Paid' : 'Unpaid';
  sh.getRange(row, 26).setValue(val);
  audit('PAYMENT_' + val.toUpperCase(), '', 'row ' + row);
  return { status:'success', paymentStatus: val };
}

// Admin: upload one image to a Drive folder, make it public, return a usable URL.
// { dataUrl:'data:image/jpeg;base64,...', name:'lunch-full' }
// Frontend compresses the photo first, so payloads stay small.
function uploadImage(p) {
  try {
    const dataUrl = String(p.dataUrl || '');
    const m = dataUrl.match(/^data:(image\/(png|jpe?g|webp));base64,(.+)$/i);
    if (!m) return { status:'error', message:'Invalid image (JPG/PNG/WebP only)' };
    const mime = m[1];
    const bytes = Utilities.base64Decode(m[3]);
    if (bytes.length > 1024 * 1024) return { status:'error', message:'Image too large — please use a smaller image (under 1MB after compression).' };

    // Find/create a dedicated folder
    const FOLDER = 'FlyingBirdsTiffin_Images';
    let folder;
    const it = DriveApp.getFoldersByName(FOLDER);
    folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);

    const ext = mime.indexOf('png') >= 0 ? 'png' : (mime.indexOf('webp') >= 0 ? 'webp' : 'jpg');
    const fname = (String(p.name||'img').replace(/[^a-z0-9\-]/gi,'') || 'img') + '_' + Date.now() + '.' + ext;
    const blob = Utilities.newBlob(bytes, mime, fname);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const id = file.getId();
    // This URL form renders reliably inside <img> tags
    const url = 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1000';
    audit('IMAGE_UPLOADED', '', fname);
    return { status:'success', url: url, id: id };
  } catch (e) {
    return { status:'error', message:'Upload failed: ' + e.message };
  }
}

function buildStats() {
  const orders = allOrders();
  const res = { status:'success', today:{count:0,revenue:0}, week:{count:0,revenue:0}, total:{count:0,revenue:0}, recent:[] };
  const t = todayIST();
  // "Last 7 Days" = aaj samet pichhle 7 din (t-6 .. t) — delivery date basis
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
  const weekAgoStr = Utilities.formatDate(weekAgo, TZ, 'yyyy-MM-dd');

  orders.forEach(o => {
    if (o.status === 'Cancelled') return;   // Cancelled kahin count nahi hote
    const amt = Number(String(o.total).replace(/[^\d]/g, '')) || 0;
    res.total.count++; res.total.revenue += amt;
    if (o.deliveryDate === t) { res.today.count++; res.today.revenue += amt; }
    if (o.deliveryDate >= weekAgoStr && o.deliveryDate <= t) { res.week.count++; res.week.revenue += amt; }
  });

  // Recent = last 10 NON-cancelled, status ke saath (taaki numbers table se match karein)
  res.recent = orders.filter(o => o.status !== 'Cancelled').slice(-10).reverse().map(o => ({
    time: o.time, name: o.name, society: o.society, flat: o.flat, total: o.total, payment: o.payment, status: o.status, deliveryDate: o.deliveryDate
  }));

  return res;
}

// ═══════════════════════════════════════════════════════
// SUBSCRIPTION MODULE — weekly/monthly auto-orders + skip/pause
// ═══════════════════════════════════════════════════════
const SUBS_SHEET = 'Subscriptions';
function subsSheet() {
  return sheetWithHeaders(SUBS_SHEET, [
    'Phone','Name','Society','Flat','Meals JSON','Days JSON','Time JSON',
    'Start Date','End Date','Status','Skip Dates JSON','Note','Payment','Created'
  ]);
}
function findSubRow(phone) {
  const sh = subsSheet(); const last = sh.getLastRow();
  if (last < 2) return -1;
  const v = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < v.length; i++) if (cleanPhone(v[i][0]) === phone) return i + 2;
  return -1;
}
function readSub(phone) {
  const sh = subsSheet(); const row = findSubRow(phone);
  if (row === -1) return null;
  const r = sh.getRange(row, 1, 1, 14).getValues()[0];
  const J = (x, d) => { try { return JSON.parse(x); } catch (e) { return d; } };
  return {
    phone: cleanPhone(r[0]), name: r[1], society: r[2], flat: r[3],
    meals: J(r[4], {}), days: J(r[5], []), time: J(r[6], {}),
    startDate: ddStr(r[7]), endDate: ddStr(r[8]), status: r[9] || 'Active',
    skipDates: J(r[10], []), note: r[11] || '', payment: r[12] || 'COD'
  };
}
// Save/replace subscription. p.meals = {lunch:{tiffinType,sabzi,...}, dinner:{...}}
// p.days = ['monday',...] , p.time={lunch:'12–1 PM',...}, p.startDate, p.endDate
function saveSubAuthed(p) {
  const sess = getSession(p.token); if (!sess) return { status:'invalid_session' };
  const phone = sess.phone;
  const meals = (p.meals && typeof p.meals === 'object') ? p.meals : {};
  if (!Object.keys(meals).length) return { status:'error', code:'sub_no_meal', message:'Please select at least one meal.' };
  const days = Array.isArray(p.days) && p.days.length ? p.days : [];
  if (!days.length) return { status:'error', code:'sub_no_day', message:'Please select at least one day.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.startDate||''))) return { status:'error', message:'Start date galat' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.endDate||''))) return { status:'error', message:'End date galat' };
  if (!p.society || !p.flat) return { status:'error', message:'Society aur flat zaroori' };

  const sh = subsSheet(); const row = findSubRow(phone);
  const vals = [ "'" + phone, safeCell(String(p.name||sess.name||'').slice(0,40)), safeCell(p.society), safeCell(String(p.flat).slice(0,10)),
    JSON.stringify(meals), JSON.stringify(days), JSON.stringify(p.time||{}),
    "'" + p.startDate, "'" + p.endDate, 'Active', JSON.stringify([]), safeCell(String(p.note||'').slice(0,120)), safeCell(p.payment||'COD'), new Date() ];
  if (row === -1) sh.appendRow(vals); else sh.getRange(row, 1, 1, 14).setValues([vals]);
  audit('SUB_SAVED', phone, days.join(',') + ' ' + p.startDate + '→' + p.endDate);
  return { status:'success' };
}
function cancelSubAuthed(p) {
  const sess = getSession(p.token); if (!sess) return { status:'invalid_session' };
  const sh = subsSheet(); const row = findSubRow(sess.phone);
  if (row === -1) return { status:'error', message:'Koi subscription nahi' };
  sh.getRange(row, 10).setValue('Cancelled');
  audit('SUB_CANCELLED', sess.phone, '');
  return { status:'success' };
}
// Skip a single date (customer bahar ja raha ho)
function skipSubAuthed(p) {
  const sess = getSession(p.token); if (!sess) return { status:'invalid_session' };
  const d = String(p.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { status:'error', message:'Date galat' };
  const sh = subsSheet(); const row = findSubRow(sess.phone);
  if (row === -1) return { status:'error', message:'Koi subscription nahi' };
  let skips = []; try { skips = JSON.parse(sh.getRange(row, 11).getValue()) || []; } catch (e) {}
  const already = skips.indexOf(d) >= 0;
  if (already) skips = skips.filter(x => x !== d); else skips.push(d);
  sh.getRange(row, 11).setValue(JSON.stringify(skips));
  audit(already ? 'SUB_UNSKIP' : 'SUB_SKIP', sess.phone, d);
  return { status:'success', skipped: !already };
}

// ═══════════ DAILY AUTO-ORDER GENERATOR ═══════════
// Set a time-driven trigger (Apps Script → Triggers → runDailySubscriptions,
// Day timer, e.g. 11 PM) — har raat kal ke subscription orders bana deta hai.
function runDailySubscriptions() {
  const sh = subsSheet(); const last = sh.getLastRow();
  if (last < 2) return;
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), TZ, 'yyyy-MM-dd');
  const dowNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const tParts = tomorrow.split('-').map(Number);
  const dow = dowNames[new Date(Date.UTC(tParts[0], tParts[1]-1, tParts[2])).getUTCDay()];

  const data = sh.getRange(2, 1, last - 1, 14).getValues();
  const J = (x, d) => { try { return JSON.parse(x); } catch (e) { return d; } };
  data.forEach(r => {
    const phone = cleanPhone(r[0]);
    if ((r[9] || 'Active') !== 'Active') return;
    const start = ddStr(r[7]), end = ddStr(r[8]);
    if (tomorrow < start || tomorrow > end) return;
    const days = J(r[5], []); if (days.indexOf(dow) < 0) return;
    const skips = J(r[10], []); if (skips.indexOf(tomorrow) >= 0) return;
    if (findActiveOrderRow(phone, tomorrow) !== -1) return; // manual order pehle se hai

    const meals = J(r[4], {}), time = J(r[6], {});
    const items = [];
    ['breakfast','lunch','dinner'].forEach(m => {
      if (!meals[m]) return;
      const mm = meals[m];
      items.push({ meal:m, tiffinType:mm.tiffinType||'full', qty:mm.qty||1, sabzi:mm.sabzi||'',
        butterRoti:!!mm.butterRoti, extraRoti:mm.extraRoti||0, dahi:!!mm.dahi, extraSabzi:!!mm.extraSabzi, timeSlot:time[m]||'' });
    });
    if (!items.length) return;

    const p = { deliveryDate: tomorrow, deliveryLabel: tomorrow, day: dow,
      society: r[2], flatNo: r[3], name: r[1], note: (r[11]||'') + ' [Auto-Subscription]',
      payment: r[12] || 'COD', items: items };
    ['breakfast','lunch','dinner'].forEach(m => {
      const it = items.find(x => x.meal === m);
      p[m+'Qty'] = it ? it.qty : 0;
      p[m+'TimeSlot'] = it ? it.timeSlot : '';
      if (m !== 'breakfast') {
        if (it) { p[m+'Tiffin'] = it.tiffinType==='mini'?'Mini':'Full'; p[m+'Sabzi']=it.sabzi; p[m+'Roti']=it.butterRoti?'Butter':'Plain';
          p[m+'Butter']=it.butterRoti?1:0; p[m+'ExtraRoti']=it.extraRoti; p[m+'Dahi']=it.dahi?1:0; p[m+'ExtraSabzi']=it.extraSabzi?1:0;
          const a=[]; if(it.extraRoti)a.push(it.extraRoti+' Extra Roti'); if(it.dahi)a.push('Dahi'); if(it.extraSabzi)a.push('Extra Sabzi'); p[m+'Addons']=a.join(', ')||'None'; }
        else { p[m+'Tiffin']=''; p[m+'Sabzi']='N/A'; p[m+'Roti']='N/A'; p[m+'Addons']='None'; p[m+'Butter']=0; p[m+'ExtraRoti']=0; p[m+'Dahi']=0; p[m+'ExtraSabzi']=0; }
      }
    });
    const total = computeTotal(p);
    saveOrder(p, phone, r[1], total);
    audit('SUB_AUTO_ORDER', phone, tomorrow + ' · ₹' + total);
    try { p.phone = phone; notifyTelegram(tgOrderMsg(p, r[1], total, '🔁 SUBSCRIPTION ORDER')); } catch (e) {}
  });
}
