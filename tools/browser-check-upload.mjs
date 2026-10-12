// Verifies the upload path in a real browser: a replacement workbook whose
// question columns are reordered, that has two worksheets and blank answer
// cells. Driven over the Chrome DevTools Protocol against the built dashboard.
//
// Usage (after `npm run build` and with a server on BASE_URL):
//   node tools/browser-check-upload.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173/index.html';
const FIXTURE = path.join(tmpdir(), 'dashboard-reordered-multisheet.xlsx');

const Q1 = 'How would you define "AI Sovereignty"?';
const Q2 = 'If Australia banned all foreign AI apps starting tomorrow, what specific task in your daily student life would become the most difficult?';
const Q3 = 'When you use an AI tool (like ChatGPT or a translation app), how much do you worry about which country or company owns your personal data?';
const Q4 = 'Should a country like Australia rely on foreign tech giants (like US or Chinese companies) for its AI, or should it spend billions of dollars to build its own local AI technology?';
const Q5 = 'Imagine you graduate and start working in an Australian business. Why might your future boss care whether your company uses local AI or foreign AI? (Think about rules, security, or secrets).';

// Column order deliberately scrambled: Q5, Q2, Q1, Q4, Q3.
const headers = ['Email', Q5, Q2, Q1, Q4, Q3, 'Total points', 'Points - ' + Q2];
const rows = [
  headers,
  ['a@example.com', 'Legal obligations and privacy.', 'Debugging Python code.', 'Control of our own AI.', 'Build local AI.', 'I worry a lot.', '', ''],
  ['b@example.com', '', 'Translating readings.', 'Sovereignty means self-rule.', '', 'I do not worry about it much.', '', ''],
  ['c@example.com', 'Cost and supplier dependence.', '', '', 'Use both if possible.', 'I am unsure.', '', ''],
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'First sheet');
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([['ID', Q1], [1, 'Only one question here.']]),
  'Second sheet',
);
XLSX.writeFile(wb, FIXTURE);

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9334);
const TARGET = BASE_URL;
const profile = mkdtempSync(path.join(tmpdir(), 'cdp2-'));

const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--disable-gpu', '--no-sandbox', '--no-first-run', '--window-size=1440,1000', 'about:blank'],
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
    } catch {}
    await sleep(500);
  }
  throw new Error('Chrome debugging endpoint unavailable');
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
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (res.exceptionDetails) throw new Error(`Page exception: ${res.exceptionDetails.exception?.description}`);
  return res.result?.value;
}

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  →  ${JSON.stringify(actual)}${pass ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}
async function waitFor(expression, label, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(expression)) return true;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  ws = new WebSocket(await targetWs());
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
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

  await send('DOM.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: TARGET });
  await waitFor("document.querySelectorAll('#responses .response-table tbody tr').length === 35", 'demo rendered');

  const { root } = await send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
  if (!nodeId) throw new Error('#file-input not found');
  await send('DOM.setFileInputFiles', { nodeId, files: [FIXTURE] });
  await waitFor("document.querySelectorAll('#responses .response-table tbody tr').length === 3", 'uploaded workbook rendered');

  check('uploaded workbook shows 3 responses', await evaluate("document.querySelectorAll('#responses .response-table tbody tr').length"), 3);
  check('filename in the workbook panel updates', await evaluate("document.querySelector('#workbook').textContent.includes('reordered-multisheet.xlsx')"), true);
  check('both worksheets offered in the selector', await evaluate("(() => { const s = document.querySelector('#sheet-select'); return s ? [...s.options].map(o => o.textContent.trim()).filter(t => /sheet/i.test(t)).length : 0; })()"), 2);

  // Reordered columns: after reordering, Q5 sits in column B and Q2 in column C.
  const guide = await evaluate(
    "[...document.querySelectorAll('#responses .guide-table tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()))",
  );
  const letters = Object.fromEntries(guide.map((r) => [r[0].slice(0, 2), r[2]]));
  check('question letters follow the reordered columns', letters, { Q1: 'D', Q2: 'C', Q3: 'F', Q4: 'E', Q5: 'B' });

  check('blank cells are labelled Missing answer', await evaluate("document.querySelectorAll('#responses .response-table .missing-tag').length"), 4);
  check('missing answers are counted, not zeroed', await evaluate("parseInt([...document.querySelectorAll('#overview .stat')].find(s=>s.textContent.includes('missing answers'))?.querySelector('.stat-value').textContent,10)"), 4);

  check('privacy chart reconciles from the uploaded file', await evaluate("[...document.querySelectorAll('#privacy .bar')].filter(b=>b.dataset.key==='very').length"), 1);
  check('scoring columns stay excluded', await evaluate("!/Total points|Points - /i.test(document.querySelector('#responses').textContent)"), true);

  // Switch worksheets.
  await evaluate(`(() => { const s = document.querySelector('#sheet-select'); s.value = [...s.options].find(o => o.textContent.includes('Second sheet')).value; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await sleep(800);
  check('switching worksheet rebuilds the dataset', await evaluate("document.querySelectorAll('#responses .response-table tbody tr').length"), 1);
  check('missing questions are reported in plain language', await evaluate("/not found|could not|missing/i.test(document.querySelector('#workbook').textContent)"), true);

  check('no page exceptions', await evaluate('window.__e2eErrors || 0'), 0);
} catch (error) {
  console.log('ERROR', error.message);
  results.push(false);
} finally {
  try { if (ws) ws.close(); } catch {}
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
