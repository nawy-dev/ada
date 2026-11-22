// Takes the Google Play phone screenshots from the real app inside the emulator.
//
// It fills the app the way a person would after a few weeks of use: it builds a backup file in
// the page and restores it through Settings (the "restore from file" button), the same path a
// person uses. That also proves restoring a file works inside the Android WebView. Then it walks
// the main screens in light and dark mode and saves one PNG per screen into the output folder.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const out = process.argv[2] ?? "emulator-out";
const log = (...a) => console.log("[shots]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const target = targets.find((t) => t.type === "page") ?? targets[0];
if (!target) throw new Error("no WebView page found");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error("websocket failed"));
});
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    id += 1;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send("Runtime.enable");
/** Runs `code` in the page and returns its value. */
async function ev(code) {
  const r = await send("Runtime.evaluate", {
    expression: `(async () => { ${code} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? "page error");
  }
  return r.result?.result?.value;
}

const HELPERS = `
  const q = (s, root = document) => root.querySelector(s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await wait(250); }
    return null;
  };
  const byText = (sel, text) =>
    [...document.querySelectorAll(sel)].find((el) => el.textContent.trim() === text);
  const go = (path) => {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
`;

const fail = (reason) => {
  log("FAILED:", reason);
  try {
    execSync(`adb exec-out screencap -p > ${out}/failed.png`);
  } catch {
    /* the screenshot is a bonus */
  }
  ws.close();
  process.exit(1);
};

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString();

/** Reads the pixel size from the PNG header. */
function pngSize(file) {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const shots = [];
async function shot(name) {
  await sleep(1200); // let animations and the drawer settle
  const file = `${out}/${name}.png`;
  execSync(`adb exec-out screencap -p > ${file}`);
  const { width, height } = pngSize(file);
  log(`saved ${name}.png ${width}x${height}`);
  // Play: each side 320–3840 px, and the long side at most twice the short one.
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (short < 320 || long > 3840 || long > short * 2) {
    fail(`${name}.png is ${width}x${height}, which Google Play rejects`);
  }
  shots.push(name);
}

const night = async (on) => {
  sh(`adb shell cmd uimode night ${on ? "yes" : "no"}`);
  await sleep(2500);
  const dark = await ev(`return document.documentElement.classList.contains('dark');`);
  log(`night mode ${on ? "on" : "off"}; page is dark: ${dark}`);
  if (Boolean(dark) !== on) fail(`the app did not follow the system theme (wanted dark=${on})`);
};

await sleep(3000);
const env = await ev(`return { cap: window.Capacitor?.isNativePlatform?.() };`);
if (!env?.cap) fail("the app is not running inside Capacitor");
sh("adb shell cmd uimode night no");

// 1) Restore a believable few weeks of data through the real Settings flow.
const restored = await ev(`${HELPERS}
  const SUGGESTIONS = [
    ['قراءة 10 صفحات', 'menu_book', 'blue'],
    ['ورد القرآن', 'menu_book', 'green'],
    ['أذكار الصباح', 'wb_twilight', 'amber'],
    ['شرب الماء', 'water_drop', 'teal'],
    ['رياضة', 'fitness_center', 'orange'],
    ['صدقة', 'volunteer_activism', 'rose'],
  ];
  const key = (d) =>
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const now = new Date();
  const ago = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
  const habits = SUGGESTIONS.map(([name, icon, color], i) => ({
    id: 'shot-' + (i + 1), name, emoji: '✨', icon, color, order: i,
    createdAt: ago(60).toISOString(), archivedAt: null, deletedAt: null,
  }));
  // Each habit has its own rhythm: a long streak up to today for some, gaps for others.
  const misses = [9, 6, 4, 5, 3, 7];
  const doneToday = [true, true, false, true, false, true];
  const logs = [];
  habits.forEach((h, i) => {
    for (let n = 0; n < 56; n++) {
      if (n === 0 ? !doneToday[i] : (n + i * 2) % misses[i] === 0) continue;
      const day = key(ago(n));
      logs.push({ id: h.id + ':' + day, habitId: h.id, day, createdAt: ago(n).toISOString() });
    }
  });
  const backup = { app: 'nawy-habit', version: 5, exportedAt: now.toISOString(), habits, logs };

  go('/settings');
  const input = await waitFor(() => q('input[type=file]'));
  if (!input) return 'no file input';
  const dt = new DataTransfer();
  dt.items.add(new File([JSON.stringify(backup)], 'nawy.json', { type: 'application/json' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const dialog = await waitFor(() => q('[role=alertdialog]'));
  if (!dialog) return 'the restore dialog never opened (file not read?)';
  const box = q('input[type=checkbox]', dialog);
  if (box && box.checked) box.click(); // no safety copy: it would open the share sheet
  await wait(300);
  const confirm = byText('[role=alertdialog] button', 'استرجاع');
  if (!confirm) return 'no confirm button';
  confirm.click();
  const closed = await waitFor(() => !q('[role=alertdialog]'));
  if (!closed) return 'the restore dialog stayed open';
  return 'ok ' + habits.length + ' habits, ' + logs.length + ' logs';`);
log("restore from file:", restored);
if (!String(restored).startsWith("ok")) fail(`restore failed: ${restored}`);

// 2) Today, in light mode.
const home = await ev(`${HELPERS}
  go('/');
  const first = await waitFor(() => q('a[href^="/habit/"]'));
  await wait(1500);
  return { habits: document.querySelectorAll('a[href^="/habit/"]').length, ok: !!first };`);
log("today screen:", JSON.stringify(home));
if (!home?.ok || home.habits !== 6) fail(`expected 6 habits on Today, saw ${home?.habits}`);
await sleep(5000); // let the restore toast leave
await shot("01-today-light");

// 3) The new-habit sheet with a suggestion chosen.
const sheet = await ev(`${HELPERS}
  const fab = q('button[aria-label="إضافة عادة"]');
  if (!fab) return 'no add button';
  fab.click();
  if (!(await waitFor(() => q('#habit-name')))) return 'no name field';
  const chip = byText('button', 'نوم مبكر');
  if (!chip) return 'no suggestion chip';
  chip.click();
  await wait(400);
  return 'ok';`);
log("new habit sheet:", sheet);
if (sheet !== "ok") fail(sheet);
await shot("02-new-habit-light");
await ev(`${HELPERS} q('button[aria-label="إغلاق"]')?.click(); await wait(800); return 1;`);

// 4) One habit's page: stats, history grid and monthly calendar.
const detail = await ev(`${HELPERS}
  q('a[href^="/habit/"]').click();
  const ok = await waitFor(() => q('[aria-label="سجل العادة بالكامل"]'));
  await wait(800);
  return ok ? 'ok' : 'habit page did not open on ' + location.pathname;`);
log("habit page:", detail);
if (detail !== "ok") fail(detail);
await shot("03-habit-light");

// 5) The same two screens in dark mode.
await night(true);
await shot("04-habit-dark");
await ev(`${HELPERS} history.back(); await waitFor(() => q('a[href^="/habit/"]')); await wait(800); return 1;`);
await shot("05-today-dark");

// 6) Settings (backup and restore), light.
await night(false);
await ev(`${HELPERS} go('/settings'); await waitFor(() => byText('button', 'حفظ نسخة')); return 1;`);
await shot("06-settings-light");

ws.close();
log(`OK: ${shots.length} screenshots: ${shots.join(", ")}`);
