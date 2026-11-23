// Takes the Google Play phone screenshots from the real app inside the emulator.
//
// It fills the app the way a person would after a few weeks of use: it builds a backup file in
// the page and restores it through Settings (the "restore from file" button), the same path a
// person uses. That also proves restoring a file works inside the Android WebView. Then it walks
// the main screens in light and dark mode and saves one PNG per screen into the output folder.
//
// It then runs checks that a person would notice at once but unit tests cannot see: the bars around
// the page have the page's colour in every light/dark combination, the web-only controls (install
// as an app, browser storage) are not shown inside the app, the Back button goes back, and the
// on-screen keyboard does not cover the add button. Each check is logged as `CHECK ok|FAIL`, and
// the run fails at the end if any failed, after saving every picture.
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
const consoleLines = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Runtime.consoleAPICalled" && ["warning", "error"].includes(msg.params.type)) {
    consoleLines.push(
      `${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`,
    );
  }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    id += 1;
    const mine = id;
    const timer = setTimeout(() => {
      pending.delete(mine);
      rej(new Error(`the page did not answer ${method} within 20 s`));
    }, 20_000);
    pending.set(mine, (msg) => {
      clearTimeout(timer);
      res(msg);
    });
    ws.send(JSON.stringify({ id: mine, method, params }));
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

const problems = [];
/** Records a check; the run keeps going so every picture is still saved, and fails at the end. */
function check(name, ok, detail = "") {
  log(`CHECK ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) problems.push(name);
}

/** The screen as raw pixels. The header before them is 12 or 16 bytes depending on the Android. */
function rawScreen() {
  const buf = execSync("adb exec-out screencap", { maxBuffer: 128 * 1024 * 1024 });
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  const header = buf.length - width * height * 4;
  const at = (x, y) => {
    const i = header + (y * width + x) * 4;
    return [buf[i], buf[i + 1], buf[i + 2]];
  };
  return { width, height, at };
}

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const near = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

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
const installButton = await ev(
  `return !!document.querySelector('button[aria-label="تثبيت ناوي كتطبيق"]');`,
);
check("no 'install as an app' button inside the app", installButton === false);
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
await ev(
  `${HELPERS} history.back(); await waitFor(() => q('a[href^="/habit/"]')); await wait(800); return 1;`,
);
await shot("05-today-dark");

// 6) Settings (backup and restore), light.
await night(false);
await ev(
  `${HELPERS} go('/settings'); await waitFor(() => byText('button', 'حفظ نسخة')); return 1;`,
);
await shot("06-settings-light");

// 7) Settings has no browser-only card inside the app.
const storageCard = await ev(`${HELPERS} return !!byText('h2', 'حماية التخزين');`);
check("no browser storage card inside the app", storageCard === false);

// 8) The bars around the page, in every light/dark combination.
log("user agent:", await ev(`return navigator.userAgent;`));
const probe = await ev(`try {
  await window.Capacitor.Plugins.AdaSystemBars.setColors({ color: '#FF0000' });
  return 'resolved';
} catch (e) { return 'rejected: ' + (e?.message ?? e); }`);
await sleep(1500);
const red = rawScreen();
log(
  "probe (plugin asked for red):",
  probe,
  "top",
  red.at(540, 6),
  "bottom",
  red.at(40, red.height - 6),
);
for (const line of consoleLines) log("page console:", line);
log(sh("adb logcat -d | grep -iE 'AdaSystemBars|Capacitor/|SystemBars' | tail -25"));
const BG = `const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = getComputedStyle(document.body).backgroundColor; c.fillRect(0, 0, 1, 1);
  return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);`;
const inAppChoices = { system: "حسب الجهاز", light: "نهاري", dark: "ليلي" };
for (const systemDark of [false, true]) {
  for (const [choice, label] of Object.entries(inAppChoices)) {
    sh(`adb shell cmd uimode night ${systemDark ? "yes" : "no"}`);
    await sleep(2000);
    await ev(
      `${HELPERS} byText('button', ${JSON.stringify(label)})?.click(); await wait(300); return 1;`,
    );
    await sleep(1800); // the colour is sent to the phone after the page repaints
    const wantDark = choice === "dark" || (choice === "system" && systemDark);
    const isDark = await ev(`return document.documentElement.classList.contains('dark');`);
    const page = await ev(BG);
    const screen = rawScreen();
    const top = screen.at(540, 6);
    const bottom = screen.at(40, screen.height - 6);
    const name = `bars: phone ${systemDark ? "dark" : "light"}, app ${choice}`;
    check(`${name} - page is ${wantDark ? "dark" : "light"}`, Boolean(isDark) === wantDark);
    check(`${name} - status bar has the page colour`, near(top, page), `bar ${top} page ${page}`);
    check(
      `${name} - navigation bar has the page colour`,
      near(bottom, page),
      `bar ${bottom} page ${page}`,
    );
    // The clock sits at the left of the status bar: it must stand out from the bar behind it.
    let strongest = 0;
    for (let y = 16; y < 48; y += 2) {
      for (let x = 30; x < 120; x += 2) {
        strongest = Math.max(strongest, Math.abs(luma(screen.at(x, y)) - luma(page)));
      }
    }
    check(
      `${name} - status bar icons are readable`,
      strongest > 100,
      `contrast ${strongest.toFixed(0)}`,
    );
    if (systemDark !== wantDark)
      await shot(`07-bars-phone-${systemDark ? "dark" : "light"}-app-${choice}`);
  }
}
await ev(`${HELPERS} byText('button', 'حسب الجهاز')?.click(); await wait(300); return 1;`);
sh("adb shell cmd uimode night no");
await sleep(2000);

// 9) The on-screen keyboard must not cover the add button.
sh("adb shell settings put secure show_ime_with_hard_keyboard 1");
await ev(
  `${HELPERS} go('/'); await waitFor(() => q('button[aria-label="إضافة عادة"]')); await wait(500); return 1;`,
);
await ev(
  `${HELPERS} q('button[aria-label="إضافة عادة"]').click(); await waitFor(() => q('#habit-name')); await wait(600); return 1;`,
);
// A real touch on the field, like a person's: focusing from script does not open the keyboard.
const field = await ev(`const r = document.querySelector('#habit-name').getBoundingClientRect();
  return { x: (r.left + r.width / 2) * devicePixelRatio, y: (r.top + r.height / 2) * devicePixelRatio };`);
sh(`adb shell input tap ${Math.round(field.x)} ${Math.round(field.y) + 63}`); // 63 px = status bar
await sleep(2500);
const imeDump = sh(
  "adb shell dumpsys input_method | grep -E 'mInputShown|isInputViewShown|mImeWindowVis' | head -5",
);
log("input method:", imeDump.trim().replace(/\s+/g, " "));
const ime = /mInputShown=true|isInputViewShown=true/.test(imeDump);
const keyboard = await ev(`${HELPERS}
  const add = byText('button', 'إضافة العادة');
  const r = add?.getBoundingClientRect();
  return { inner: innerHeight, visual: visualViewport?.height, bottom: r?.bottom, top: r?.top };`);
log("keyboard:", JSON.stringify({ ime, ...keyboard }));
check("the soft keyboard really opened (so this check means something)", ime);
check(
  "the add button stays above the keyboard",
  keyboard?.bottom !== undefined &&
    keyboard.bottom <= Math.min(keyboard.inner, keyboard.visual ?? 1e9) + 1,
  `button bottom ${keyboard?.bottom?.toFixed?.(0)} of visible ${keyboard?.visual?.toFixed?.(0)}`,
);
await shot("08-keyboard-open");
await ev(
  `${HELPERS} q('button[aria-label="إغلاق"]')?.click(); document.activeElement?.blur(); await wait(500); return 1;`,
);
sh("adb shell settings put secure show_ime_with_hard_keyboard 0");
await sleep(800);

// 10) Back goes back inside the app (and only leaves it from the first screen).
await ev(
  `${HELPERS} go('/'); await waitFor(() => q('a[href^="/habit/"]')); q('a[href^="/habit/"]').click(); await waitFor(() => location.pathname.startsWith('/habit/')); return 1;`,
);
sh("adb shell input keyevent KEYCODE_BACK");
await sleep(1500);
const afterBack = await ev(`return location.pathname;`);
check("Back from a habit page returns to Today", afterBack === "/", `now on ${afterBack}`);
const appIsUp = sh(`adb shell pidof ada.nawy.app`).trim() !== "";
check("the app is still running after Back", appIsUp);

ws.close();
if (problems.length) {
  log(`FAILED CHECKS (${problems.length}):`);
  for (const p of problems) log(` - ${p}`);
  process.exit(1);
}
log(`OK: ${shots.length} screenshots, all checks passed`);
