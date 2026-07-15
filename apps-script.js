// ═══════════════════════════════════════════════════════
// FLYING BIRDS TIFFIN — Backend v7 (Google Sign-In + i18n + Dynamic Config + Cart)
// Naya: Google Sign-In login (no OTP/SMS) | Users/Sessions/Audit sheets
//       Token-secured APIs | Server-side validation
// ═══════════════════════════════════════════════════════

const NOTIFY_EMAIL = 'himani12690@gmail.com';

// Standalone script (not created via Sheet's Extensions menu) has no "active"
// spreadsheet, so getActiveSpreadsheet() returns null. We open it explicitly
// by ID instead — works regardless of how/where the script runs.
const SHEET_ID = '1T6tTy_I-C8VH8JKOsB8wyUW7h1NgbPmy0eFjCrmMGPo';
function getSS() { return SpreadsheetApp.openById(SHEET_ID); }

// ⚠️ 1) Admin username/password:
const ADMIN_USER = 'himani12690';
const ADMIN_PASS = 'himani12690';

// ⚠️ 2) Google Sign-In Client ID — Google Cloud Console → APIs & Services →
//    Credentials → Create OAuth client ID → "Web application" → add your
//    Netlify site under "Authorized JavaScript origins" → paste Client ID here.
//    MUST match the client_id used in the frontend's google.accounts.id.initialize().
const GOOGLE_CLIENT_ID = '326762302482-d6c9l5k804u0oavcrrrqik7cadsvdneq.apps.googleusercontent.com';

// ⚠️ 3) Email/Password login — change this random string once (used to salt
//    password hashes; changing it later would invalidate existing passwords):
const PASSWORD_PEPPER = 'CHANGE-THIS-RANDOM-STRING-fbt2026xyz';

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

// ─────────────────────────────────────────────
function doGet(e) {
  const q = e.parameter;
  const action = (q.action || '').toLowerCase();

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

  if (action === 'stats') {
    if (!checkAuth(q.user, q.pass)) return json({ status:'error', message:'Invalid credentials' });
    return json(buildStats());
  }
  if (action === 'lastorder') {
    if (!checkAuth(q.user, q.pass)) return json({ status:'error', message:'Invalid credentials' });
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
    if (!checkAuth(q.user, q.pass)) return json({ status:'error', message:'Invalid credentials' });
    return json({ status:'success', orders: readOrders(q.range || 'today', q.date || '') });
  }
  if (action === 'getpromos') {
    if (!checkAuth(q.user, q.pass)) return json({ status:'error', message:'Invalid credentials' });
    return json({ status:'success', promos: listPromos() });
  }
  if (action === 'users') {
    if (!checkAuth(q.user, q.pass)) return json({ status:'error', message:'Invalid credentials' });
    return json({ status:'success', users: listUsers() });
  }

  return ContentService.createTextOutput('✅ Flying Birds Tiffin backend v6 is running!');
}

// ─────────────────────────────────────────────
function doPost(e) {
  try {
    let p = {};
    if (e.postData && e.postData.contents) {
      try { p = JSON.parse(e.postData.contents); } catch (err) { p = e.parameter; }
    } else p = e.parameter;

    const action = (p.action || '').toLowerCase();

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
    if (action === 'setuserstatus') {
      if (!checkAuth(p.user, p.pass)) return json({ status:'error', message:'Invalid credentials' });
      return json(setUserStatus(p));
    }

    // Default: naya order — LOGIN ZAROORI
    return json(placeOrderAuthed(p));

  } catch (err) {
    return json({ status:'error', message: err.message });
  }
}

// ═══════════ HELPERS ═══════════
function checkAuth(u, p) { return u === ADMIN_USER && p === ADMIN_PASS; }
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

function sheetWithHeaders(name, headers) {
  const ss = getSS();
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
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const vals = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (cleanPhone(vals[i][0]) === phone) return i + 2;
  return -1;
}
function findRowByEmail(sh, email) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const vals = sh.getRange(2, 3, last - 1, 1).getValues(); // Email = column 3
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0] || '').toLowerCase() === email) return i + 2;
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
  if (!g || !g.email) return { status:'error', message:'Google sign-in verify nahi hua: ' + (g && g.error ? g.error : 'UNKNOWN') };
  const email = g.email;
  const lock = LockService.getScriptLock();
  try { lock.tryLock(5000); } catch (e) {}
  try {
    const uSh = usersSheet();
    let uRow = findRowByEmail(uSh, email);
    let phone, name;
    if (uRow === -1) {
      phone = cleanPhone(p.phone);
      if (!validPhone(phone)) return { status:'need_phone', message:'Pehli baar login ke liye mobile number chahiye' };
      // same phone shouldn't already belong to a different Google account
      if (findRowByPhone(uSh, phone) !== -1) return { status:'error', message:'Ye mobile number kisi doosre Google account se already jud chuka hai' };
      name = String(g.name || p.name || '').trim() || 'Guest';
      uSh.appendRow([phone, name, email, new Date(), new Date(), 'Active']);
      audit('GOOGLE_LOGIN_NEW_USER', phone, email);
    } else {
      if (uSh.getRange(uRow, 6).getValue() === 'Blocked') return { status:'error', message:'Aapka account block hai — support: 99249 37939' };
      phone = cleanPhone(uSh.getRange(uRow, 1).getValue());
      name = String(uSh.getRange(uRow, 2).getValue() || g.name || 'Guest');
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
  if (!validEmail(email)) return { status:'error', message:'Valid email daalein' };
  if (password.length < 6) return { status:'error', message:'Password kam se kam 6 characters ka hona chahiye' };
  if (!validPhone(phone)) return { status:'error', message:'Valid 10-digit mobile number daalein' };

  const lock = LockService.getScriptLock();
  try { lock.tryLock(5000); } catch (e) {}
  try {
    const uSh = usersSheet();
    if (findRowByEmail(uSh, email) !== -1) return { status:'error', message:'Is email se account pehle se hai — Sign In karein' };
    if (findRowByPhone(uSh, phone) !== -1) return { status:'error', message:'Ye mobile number kisi doosre account se already jud chuka hai' };

    const name = String(p.name || '').trim() || email.split('@')[0];
    const salt = Utilities.getUuid();
    const hash = hashPassword(password, salt);
    uSh.appendRow([phone, name, email, new Date(), new Date(), 'Active', hash, salt, '', '']);
    audit('EMAIL_SIGNUP', phone, email);

    const token = Utilities.getUuid();
    sessionsSheet().appendRow([token, "'" + phone, email, new Date(), new Date(Date.now() + SESSION_DAYS * 86400000)]);
    return { status:'success', token: token, name: name, phone: phone };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// { email, password } — existing account
function emailLogin(p) {
  const email = String(p.email || '').trim().toLowerCase();
  const password = String(p.password || '');
  if (!validEmail(email) || !password) return { status:'error', message:'Email aur password daalein' };

  const lock = LockService.getScriptLock();
  try { lock.tryLock(5000); } catch (e) {}
  try {
    const uSh = usersSheet();
    const row = findRowByEmail(uSh, email);
    if (row === -1) return { status:'error', message:'Is email se koi account nahi mila' };
    if (uSh.getRange(row, 6).getValue() === 'Blocked') return { status:'error', message:'Aapka account block hai — support: 99249 37939' };

    const storedHash = uSh.getRange(row, 7).getValue();
    const salt = uSh.getRange(row, 8).getValue();
    if (!storedHash || !salt) return { status:'error', message:'Ye account Google Sign-In se bana hai — "Sign in with Google" use karein' };
    if (hashPassword(password, salt) !== storedHash) return { status:'error', message:'Galat password' };

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
  if (!validEmail(email)) return { status:'error', message:'Valid email daalein' };
  try {
    const uSh = usersSheet();
    const row = findRowByEmail(uSh, email);
    if (row !== -1 && uSh.getRange(row, 7).getValue()) { // only if it's a password account
      const token = Utilities.getUuid();
      uSh.getRange(row, 9).setValue(token);
      uSh.getRange(row, 10).setValue(new Date(Date.now() + 30 * 60000)); // 30 min
      const link = (origin || 'https://your-site.netlify.app') + '/?reset=' + token;
      MailApp.sendEmail({
        to: email,
        subject: 'Flying Birds Tiffin — Reset your password',
        htmlBody: 'Password reset request mila.<br><br>' +
          '<a href="' + link + '" style="background:#6366f1;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Reset Password</a><br><br>' +
          'Ye link 30 minute tak valid hai. Agar aapne ye request nahi ki, ignore kar dein.'
      });
      audit('PASSWORD_RESET_REQUESTED', cleanPhone(uSh.getRange(row, 1).getValue()), email);
    }
  } catch (e) {}
  return { status:'success', message:'Agar ye email registered hai, reset link bhej diya gaya hai.' };
}

// { token, password }
function resetPassword(p) {
  const token = String(p.token || '').trim();
  const password = String(p.password || '');
  if (!token) return { status:'error', message:'Reset link invalid hai' };
  if (password.length < 6) return { status:'error', message:'Password kam se kam 6 characters ka hona chahiye' };
  const uSh = usersSheet();
  const last = uSh.getLastRow();
  if (last < 2) return { status:'error', message:'Reset link invalid hai' };
  const vals = uSh.getRange(2, 9, last - 1, 2).getValues(); // ResetToken, ResetExpires
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === token) {
      const row = i + 2;
      const expires = vals[i][1];
      if (!(expires instanceof Date) || new Date() > expires) return { status:'error', message:'Reset link expire ho gaya — dobara try karein' };
      const salt = Utilities.getUuid();
      uSh.getRange(row, 7).setValue(hashPassword(password, salt));
      uSh.getRange(row, 8).setValue(salt);
      uSh.getRange(row, 9).setValue('');
      uSh.getRange(row, 10).setValue('');
      audit('PASSWORD_RESET_DONE', cleanPhone(uSh.getRange(row, 1).getValue()), '');
      return { status:'success' };
    }
  }
  return { status:'error', message:'Reset link invalid ya expire ho gaya hai' };
}

// ═══════════ SESSION ═══════════
function getSession(token) {
  if (!token) return null;
  const sh = sessionsSheet();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const vals = sh.getRange(2, 1, last - 1, 5).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(token)) {
      const exp = vals[i][4];
      if (!(exp instanceof Date) || new Date() > exp) return null;
      const phone = cleanPhone(vals[i][1]);
      const email = String(vals[i][2] || '');
      const uSh = usersSheet();
      const uRow = findRowByPhone(uSh, phone);
      if (uRow === -1 || uSh.getRange(uRow, 6).getValue() === 'Blocked') return null;
      return { phone: phone, email: email, name: String(uSh.getRange(uRow, 2).getValue() || '') };
    }
  }
  return null;
}

function logoutUser(p) {
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
  const phone = sess.phone; // ⚠️ frontend ka phone IGNORE — session se aata hai

  const winErr = orderWindowError(p);
  if (winErr) { audit('ORDER_WINDOW_BLOCKED', phone, winErr); return { status:'error', message: winErr }; }

  const lock = LockService.getScriptLock();
  try { lock.tryLock(5000); } catch (e) {}
  try {
    const isEdit = !!p.editRow;
    let oldPaidVal = '';
    // 1:1:1 rule — ek din me har meal ka max 1 tiffin
    const qB = parseInt(p.breakfastQty, 10) || 0;
    const qL = parseInt(p.lunchQty, 10) || 0;
    const qD = parseInt(p.dinnerQty, 10) || 0;
    if (qB > 1 || qL > 1 || qD > 1) {
      return { status:'error', message:'Ek din me har meal ka sirf 1 tiffin order ho sakta hai. Zyada quantity ke liye kitchen se sampark karein.' };
    }
    // ── Delivery type: home (society+flat) ya office (company + employee id) ──
    const cfgD = readConfig();
    const dType = (String(p.deliveryType || 'home') === 'office') ? 'office' : 'home';
    if (dType === 'office') {
      if (!cfgD.officeEnabled) return { status:'error', message:'Office delivery abhi available nahi hai.' };
      const co = findCompany(p.society);
      if (!co) return { status:'error', message:'Kripya list me se apni company select karein.' };
      if (!String(p.flatNo || '').trim()) return { status:'error', message:'Employee ID zaroori hai.' };
    } else {
      if (!cfgD.homeEnabled) return { status:'error', message:'Home delivery abhi available nahi hai.' };
    }
    p.deliveryType = dType;
    const existingRow = findActiveOrderRow(phone, p.deliveryDate);

    if (isEdit) {
      // Editing: the row being edited must exist, be theirs, and still be in cancel window
      const row = parseInt(p.editRow, 10);
      const sh = ordersSheet();
      if (!row || row < 2 || row > sh.getLastRow()) return { status:'error', message:'Order nahi mila' };
      if (cleanPhone(sh.getRange(row, 6).getValue()) !== phone) return { status:'error', message:'Ye order aapka nahi hai' };
      const st = sh.getRange(row, STATUS_COL).getValue() || 'Pending';
      if (st === 'Cancelled') return { status:'error', message:'Cancelled order edit nahi ho sakta' };
      if (st === 'Delivered') return { status:'error', message:'Delivered order edit nahi ho sakta' };
      if (cancelDeadlinePassed(ddStr(sh.getRange(row, DELDATE_COL).getValue()), sh.getRange(row, 1).getValue())) return { status:'error', message:'Edit window band ho gaya' };
      // If they somehow point at a different active row for same date, block
      if (existingRow !== -1 && existingRow !== row) return { status:'error', message:'Is date ka doosra order pehle se hai' };
      oldPaidVal = String(sh.getRange(row, 26).getValue() || '');   // V2-4: paid flag naye row pe carry hoga
      sh.getRange(row, STATUS_COL).setValue('Cancelled'); // old ko cancel, naya niche add
      audit('ORDER_EDIT_OLD_CANCELLED', phone, p.deliveryDate + ' row' + row);
    } else {
      if (existingRow !== -1) {
        audit('ORDER_DUPLICATE_BLOCKED', phone, p.deliveryDate);
        return { status:'duplicate', message:'Order already placed for this date' };
      }
    }

    let total = computeTotal(p);
    if (total <= 0) return { status:'error', message:'Order khali hai — koi meal select karein' };

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
    return { status:'success', total: total, promo: promoStr, couponRejected: couponRejected };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Active (non-cancelled) order row for a phone+date, else -1
function findActiveOrderRow(phone, deliveryDate) {
  const sh = ordersSheet();
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const data = sh.getRange(2, 1, last - 1, DELDATE_COL).getValues();
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (cleanPhone(r[5]) === phone && ddStr(r[19]) === deliveryDate && r[18] !== 'Cancelled') return i + 2;
  }
  return -1;
}

// Server-side price recompute — frontend ke total pe trust nahi (dynamic config prices)
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
  let t = clampQ(p.breakfastQty) * PRICE.breakfast;
  ['lunch','dinner'].forEach(m => {
    const q = clampQ(p[m + 'Qty']); if (!q) return;
    let unit = (String(p[m + 'Tiffin']) === 'Mini') ? PRICE.tiffinMini : PRICE[m];
    const butter = String(p[m + 'Butter']) === '1' || p[m + 'Roti'] === 'Butter';
    unit += clampR(p[m + 'ExtraRoti']) * (butter ? PRICE.extraRotiButter : PRICE.extraRotiPlain);
    if (String(p[m + 'Dahi']) === '1') unit += PRICE.dahi;
    if (String(p[m + 'ExtraSabzi']) === '1') unit += PRICE.extraSabzi;
    t += unit * q;
  });
  return t + (t > 0 ? deliveryFeeForOrder(p) : 0);
}

// Server-side IST cutoff rules — frontend bypass nahi kar sakta
function orderWindowError(p) {
  const dd = String(p.deliveryDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dd)) return 'Invalid delivery date';
  const toEpoch = s => { const a = s.split('-').map(Number); return Date.UTC(a[0], a[1]-1, a[2]); };
  const off = Math.round((toEpoch(dd) - toEpoch(todayIST())) / 86400000);
  if (off < 0 || off > 2) return 'Delivery date sirf Today / Tomorrow / Day After ho sakti hai';

  const cfg = readConfig();
  if ((cfg.closedDates || []).indexOf(dd) >= 0) return 'Is date par kitchen band hai';

  const hm = Utilities.formatDate(new Date(), TZ, 'HH:mm').split(':');
  const mins = Number(hm[0]) * 60 + Number(hm[1]);
  const bq = parseInt(p.breakfastQty, 10) || 0;
  const lq = parseInt(p.lunchQty, 10) || 0;
  const dq = parseInt(p.dinnerQty, 10) || 0;
  if (bq + lq + dq <= 0) return 'Kam se kam ek meal select karein';

  if (off === 0) {
    if (bq > 0) return 'Same-day breakfast available nahi';
    if (lq > 0 && mins >= 540) return 'Aaj ke lunch ki booking band (9:00 AM tak)';
    if (dq > 0 && mins >= 900) return 'Aaj ke dinner ki booking band (3:00 PM tak)';
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
    if (already + want > cap[m]) return 'Aaj ke ' + m + ' ke slots full ho gaye — sirf ' + Math.max(0, cap[m] - already) + ' bache hain';
  }
  return null;
}

// Sum of active (non-cancelled) Qty for a meal on a given delivery date.
function mealQtyForDate(deliveryDate, meal, excludeRow) {
  const sh = ordersSheet();
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const qtyCol = meal === 'breakfast' ? 7 : (meal === 'lunch' ? 8 : 12);
  const data = sh.getRange(2, 1, last - 1, 23).getValues();
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
  if (cleanPhone(sh.getRange(row, 6).getValue()) !== sess.phone) return { status:'error', message:'Ye order aapka nahi hai' };
  const curStatus = sh.getRange(row, STATUS_COL).getValue() || 'Pending';
  if (curStatus === 'Cancelled') return { status:'error', message:'Order pehle se cancelled hai' };
  if (curStatus === 'Delivered') return { status:'error', message:'Delivered order cancel nahi ho sakta' };
  const delDate = ddStr(sh.getRange(row, DELDATE_COL).getValue());
  if (cancelDeadlinePassed(delDate, sh.getRange(row, 1).getValue())) return { status:'error', message:'Cancellation window has been closed.' };
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
  if (row === -1) return { status:'error', message:'User nahi mila' };
  uSh.getRange(row, 6).setValue(status);
  audit(status === 'Blocked' ? 'USER_BLOCKED' : 'USER_UNBLOCKED', cleanPhone(p.phone), 'by admin');
  return { status:'success' };
}

// ═══════════ ORDERS SHEET (v4 se same) ═══════════
function ordersSheet() {
  const sh = sheetWithHeaders(ORDERS_SHEET, [
    'Timestamp','Day','Society','Flat','Name','Phone',
    'Breakfast Qty','Lunch Qty','Lunch Sabzi','Lunch Roti','Lunch Addons',
    'Dinner Qty','Dinner Sabzi','Dinner Roti','Dinner Addons',
    'Note','Payment','Total','Status','Delivery Date'
  ]);
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
  return sh;
}

function isDuplicate(phone, deliveryDate) {
  if (!phone || !deliveryDate) return false;
  const sh = ordersSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return false;
  const data = sh.getRange(2, 1, lastRow - 1, 20).getValues();
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
  return { status:'success', promos:listPromos() };
}
function deletePromo(p){
  const code=String(p.code||'').trim().toUpperCase();
  const sh=promosSheet(); const lr=sh.getLastRow();
  if(lr>=2){ const codes=sh.getRange(2,1,lr-1,1).getValues(); for(let i=codes.length-1;i>=0;i--){ if(String(codes[i][0]).trim().toUpperCase()===code){ sh.deleteRow(i+2); break; } } }
  audit('PROMO_DELETED','',code);
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
  ordersSheet().appendRow([
    new Date(),
    p.day || '', p.society || '', p.flatNo || '', name, "'" + phone,
    parseInt(p.breakfastQty, 10) || 0,
    parseInt(p.lunchQty, 10) || 0, p.lunchSabzi || '', p.lunchRoti || '', p.lunchAddons || '',
    parseInt(p.dinnerQty, 10) || 0, p.dinnerSabzi || '', p.dinnerRoti || '', p.dinnerAddons || '',
    p.note || '', p.payment || '', '₹' + total,
    'Pending',
    "'" + p.deliveryDate,
    p.breakfastTimeSlot || '', p.lunchTimeSlot || '', p.dinnerTimeSlot || '',
    p.lunchTiffin || '', p.dinnerTiffin || '',
    '', (promoStr || ''), (p.deliveryType || 'home')
  ]);
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
    createdIso: (r[0] instanceof Date) ? Utilities.formatDate(r[0], TZ, "yyyy-MM-dd'T'HH:mm") : ''
  };
}

function allOrders() {
  const sh = ordersSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const data = sh.getRange(2, 1, lastRow - 1, 28).getValues();
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
  if (sheetPhone !== String(p.phone || '')) return { status:'error', message:'Order mismatch — refresh karo' };
  sh.getRange(row, STATUS_COL).setValue(p.status);
  return { status:'success' };
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
  MailApp.sendEmail({ to: NOTIFY_EMAIL, subject: subject, htmlBody: body });
}

// Triggers: ⏰ Triggers → + Add → sendDailyDigest → Time-driven → Day timer
//   Trigger 1: 5am-6am | Trigger 2: 2pm-3pm
function sendDailyDigest() {
  const orders = readOrders('today');
  const dateLabel = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy');

  if (!orders.length) {
    MailApp.sendEmail({ to: NOTIFY_EMAIL, subject: '🍱 Digest — ' + dateLabel + ' — 0 orders', htmlBody: '<p>Aaj delivery ka koi order nahi.</p>' });
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
  const body = '<h2 style="color:#667eea;">🍱 Flying Birds Tiffin — Daily Digest</h2>'
    + '<p style="font-size:14px;"><b>' + orders.length + ' orders</b> (aaj delivery) · Revenue: <b>₹' + revenue + '</b> · Banana baaki: <b>' + pending + '</b></p>'
    + kitchen + '<h3>🧾 Sab Orders</h3>' + table
    + '<p style="color:#888;font-size:12px;">Live status update ke liye app ke Admin panel mein jao.</p>';

  MailApp.sendEmail({ to: NOTIFY_EMAIL, subject: subject, htmlBody: body });
}

// ═══════════ MENU / STATS ═══════════
function readMenu() {
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
    upiId: '', upiName: 'Flying Birds Tiffin',        // online UPI payment (Option A)
    fssai: '',                                         // FSSAI reg no. shown in footer
    // ── B2B corporate mode ──
    homeEnabled: true,      // society/flat delivery on/off
    officeEnabled: false,   // company/office delivery on/off
    companies: []           // [{ name, building, fee }] — Employee ID hamesha required
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
  const clean = { prices: prices, township: township, societies: societies, deliveryNear: dNear, deliveryFar: dFar, farSocieties: farSoc, closedDates: closedDates, capacity: capacity, upiId: upiId, upiName: upiName, fssai: fssai, companies: companies, homeEnabled: homeEnabled, officeEnabled: officeEnabled };
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
    if (bytes.length > 3 * 1024 * 1024) return { status:'error', message:'Image too large (max 3MB after compression)' };

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
  if (!Object.keys(meals).length) return { status:'error', message:'Kam se kam ek meal chunein' };
  const days = Array.isArray(p.days) && p.days.length ? p.days : [];
  if (!days.length) return { status:'error', message:'Kam se kam ek din chunein' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.startDate||''))) return { status:'error', message:'Start date galat' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.endDate||''))) return { status:'error', message:'End date galat' };
  if (!p.society || !p.flat) return { status:'error', message:'Society aur flat zaroori' };

  const sh = subsSheet(); const row = findSubRow(phone);
  const vals = [ "'" + phone, String(p.name||sess.name||'').slice(0,40), p.society, String(p.flat).slice(0,10),
    JSON.stringify(meals), JSON.stringify(days), JSON.stringify(p.time||{}),
    "'" + p.startDate, "'" + p.endDate, 'Active', JSON.stringify([]), String(p.note||'').slice(0,120), p.payment||'COD', new Date() ];
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
