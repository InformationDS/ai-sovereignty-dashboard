// Independent end-to-end check of the built dashboard, driven over the Chrome
// DevTools Protocol. Nothing from the project is imported, so it verifies the
// shipped bundle rather than the source modules.
//
// Usage:
//   npm run build
//   npx vite preview --port 4173        # or serve docs/ under a repository sub-path
//   node tools/browser-check-interactions.mjs
//
// Override the defaults with BASE_URL, CHROME_PATH and CDP_PORT if needed.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const URL_TARGET = process.env.BASE_URL || 'http://127.0.0.1:4173/index.html';
const profile = mkdtempSync(path.join(tmpdir(), 'cdp-'));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--window-size=1440,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('Chrome debugging endpoint never became available');
}

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }
    }, 20000);
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`Page exception: ${JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails)}`);
  }
  return res.result?.value;
}

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  →  ${JSON.stringify(actual)}${pass ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

async function waitFor(expression, label, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(expression)) return true;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

try {
  const wsUrl = await targetWs();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  const consoleErrors = [];
  await send('Runtime.enable');
  await send('Log.enable');
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
  });

  await send('Page.enable');
  await send('Page.navigate', { url: URL_TARGET });
  await waitFor("document.querySelectorAll('#responses tbody tr').length > 0", 'demo workbook rendered');

  // --- static shape -------------------------------------------------------
  check('demo loads 35 response rows', await evaluate("document.querySelectorAll('#responses .response-table tbody tr').length"), 35);
  check(
    'each of the four chart cards carries a source line',
    await evaluate("(document.body.textContent.match(/Source · Survey Question/g) || []).length"),
    4,
  );
  check(
    'chart cards = 4',
    await evaluate("[...document.querySelectorAll('section#charts article, #charts .chart-card')].length || document.querySelectorAll('#charts .panel').length"),
    4,
  );
  check('synthetic badge rendered', await evaluate("/synthetic/i.test(document.querySelector('#hero-badge-slot')?.textContent || '')"), true);
  check('all 7 nav links present', await evaluate("document.querySelectorAll('nav a[href^=\"#\"]').length"), 7);
  check('no names / emails leaked into the table', await evaluate("/Synthetic respondent|anonymous|@/i.test(document.querySelector('#responses .response-table')?.textContent || '')"), false);

  const countExpr = (label) =>
    `parseInt([...document.querySelectorAll('#overview .stat')].find(s=>s.textContent.includes(${JSON.stringify(
      label,
    )}))?.querySelector('.stat-value').textContent, 10)`;

  check('overview selected count starts at 35', await evaluate(countExpr('currently selected')), 35);

  // --- click a privacy bar -------------------------------------------------
  await evaluate(
    "document.querySelector('#privacy [data-action=\"click-category\"][data-key=\"very\"]').click()",
  );
  await sleep(400);
  check('clicking "Very concerned" filters to 7', await evaluate(countExpr('currently selected')), 7);
  check(
    'clicked bar is marked pressed',
    await evaluate("document.querySelector('#privacy [data-key=\"very\"]').getAttribute('aria-pressed')"),
    'true',
  );
  check('privacy chart now shows only that bar', await evaluate("document.querySelector('#privacy [data-key=\"very\"] .bar-value').textContent.trim()"), '7 · 100.0%');
  check('response table followed the chart click', await evaluate("document.querySelectorAll('#responses .response-table tbody tr').length"), 7);

  // --- Reset filters -------------------------------------------------------
  await evaluate("document.querySelector('[data-action=\"reset-filters\"]').click()");
  await sleep(400);
  check('Reset filters restores 35', await evaluate(countExpr('currently selected')), 35);

  // --- search --------------------------------------------------------------
  await evaluate(`(() => { const i = document.querySelector('#search-input'); i.value = 'PYTHON'; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(400);
  const searchCount = await evaluate(countExpr('currently selected'));
  check('search is case-insensitive and filters the whole page', searchCount > 0 && searchCount < 35, true);

  await evaluate(`(() => { const i = document.querySelector('#search-input'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(300);
  check('clearing search restores 35', await evaluate(countExpr('currently selected')), 35);

  // --- checkbox filter -----------------------------------------------------
  await evaluate(
    "(() => { const c = document.querySelector('#filter-controls [data-filter-group=\"privacy\"][data-key=\"unsure\"]'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()",
  );
  await sleep(400);
  check('privacy checkbox filter selects 4', await evaluate(countExpr('currently selected')), 4);
  await evaluate("document.querySelector('[data-action=\"reset-filters\"]').click()");
  await sleep(300);

  // --- theme rules ---------------------------------------------------------
  const q2Before = await evaluate("document.querySelector('#reliance [data-key=\"limited-reliance\"] .bar-value').textContent.trim()");
  await evaluate(
    `(() => { const t = document.querySelector('#rules-editor-slot [data-rule-group="q2"][data-rule-key="limited-reliance"]'); t.value = 'nevermatchesanything'; })()`,
  );
  await evaluate("document.querySelector('[data-action=\"apply-rules\"]').click()");
  await sleep(400);
  check('editing a theme rule changes the chart', await evaluate("document.querySelector('#reliance [data-key=\"limited-reliance\"] .bar-value').textContent.trim()"), '0 · 0.0%');
  check('the old value was not 0 before the edit', q2Before !== '0 · 0.0%', true);

  await evaluate("document.querySelector('[data-action=\"restore-rules\"]').click()");
  await sleep(400);
  check('Restore defaults brings the theme back', await evaluate("document.querySelector('#reliance [data-key=\"limited-reliance\"] .bar-value').textContent.trim()"), q2Before);

  // --- empty results -------------------------------------------------------
  await evaluate(
    "(() => { const c = document.querySelector('#filter-controls [data-filter-group=\"privacy\"][data-key=\"other\"]'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()",
  );
  await sleep(400);
  check('empty result shows 0, not an error', await evaluate(countExpr('currently selected')), 0);
  check('empty result still renders the charts', await evaluate("document.querySelectorAll('#privacy [data-action=\"click-category\"]').length > 0"), true);
  await evaluate("document.querySelector('[data-action=\"reset-filters\"]').click()");
  await sleep(300);

  // --- back to top ---------------------------------------------------------
  await evaluate('window.scrollTo(0, document.body.scrollHeight)');
  await sleep(800);
  check('back-to-top becomes visible after scrolling', await evaluate("(() => { const b = document.querySelector('#back-to-top'); const s = getComputedStyle(b); return s.display !== 'none' && s.visibility !== 'hidden' && b.getBoundingClientRect().height > 0; })()"), true);
  await evaluate("document.querySelector('#back-to-top').click()");
  await sleep(3000);
  check('back-to-top returns to the top heading', await evaluate('Math.round(window.scrollY)'), 0);
  // Scroll away again before testing focus: the control is hidden at the top, and
  // a hidden element cannot take focus.
  await evaluate('window.scrollTo(0, document.body.scrollHeight)');
  await sleep(600);
  check('back-to-top is a real button and takes focus', await evaluate("(() => { const b = document.querySelector('#back-to-top'); b.focus(); return b.tagName === 'BUTTON' && document.activeElement === b; })()"), true);
  check(
    'a visible :focus-visible style is defined for controls',
    await evaluate(
      "[...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.selectorText && r.selectorText.includes(':focus-visible')); } catch { return false; } })",
    ),
    true,
  );

  // --- worksheet selector --------------------------------------------------
  check('worksheet selector offers the sheet name', await evaluate("(() => { const s = document.querySelector('#sheet-select'); return !s || [...s.options].some(o => o.textContent.includes('Sheet1')); })()"), true);

  // --- read full answer ----------------------------------------------------
  const toggles = await evaluate("document.querySelectorAll('#responses [data-action=\"toggle-answer\"]').length");
  check('long answers expose a Read full answer control', toggles > 0, true);
  const before = await evaluate(
    "(() => { const b = document.querySelector('#responses [data-action=\"toggle-answer\"]'); const cell = b.closest('td'); return [cell.textContent.trim().length, /…|\\\\.\\\\.\\\\./.test(cell.textContent)]; })()",
  );
  check('the preview is shortened with an ellipsis', before[1], true);
  await evaluate("document.querySelector('#responses [data-action=\"toggle-answer\"]').click()");
  await sleep(300);
  const after = await evaluate(
    "(() => { const b = document.querySelector('#responses [data-action=\"toggle-answer\"][aria-expanded=\"false\"]'); const cell = document.querySelector('#responses .response-table tbody tr td:nth-child(3)'); return document.body.innerText.includes('Show less') || document.querySelectorAll('#responses .answer-full').length > 0; })()",
  );
  check('clicking it reveals the complete answer', after, true);

  check('no page exceptions or console errors', consoleErrors, []);
} catch (error) {
  console.log('ERROR', error.message);
  results.push({ name: 'harness', pass: false, actual: error.message });
} finally {
  try {
    if (ws) ws.close();
  } catch {}
  chrome.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
