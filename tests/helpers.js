import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { readWorkbookFile, readSheet, DEMO_FILENAME } from '../app/lib/workbook.js';
import { buildDataset } from '../app/lib/analysis.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DEMO_PATH = path.join(ROOT, 'public', DEMO_FILENAME);

/** The exact header wording found in the demonstration workbook, A to W. */
export const DEMO_HEADERS = [
  'ID',
  'Start time',
  'Completion time',
  'Email',
  'Name',
  'Total points',
  'Quiz feedback',
  'Last modified time',
  'How would you define "AI Sovereignty"?',
  'Points - How would you define "AI Sovereignty"?',
  'Feedback - How would you define "AI Sovereignty"?',
  'If Australia banned all foreign AI apps starting tomorrow, what specific task in your daily student life would become the most difficult?',
  'Points - If Australia banned all foreign AI apps starting tomorrow, what specific task in your daily student life would become the most difficult?',
  'Feedback - If Australia banned all foreign AI apps starting tomorrow, what specific task in your daily student life would become the most difficult?',
  'When you use an AI tool (like ChatGPT or a translation app), how much do you worry about which country or company owns your personal data?',
  'Points - When you use an AI tool (like ChatGPT or a translation app), how much do you worry about which country or company owns your personal data?',
  'Feedback - When you use an AI tool (like ChatGPT or a translation app), how much do you worry about which country or company owns your personal data?',
  'Should a country like Australia rely on foreign tech giants (like US or Chinese companies) for its AI, or should it spend billions of dollars to build its own local AI technology?',
  'Points - Should a country like Australia rely on foreign tech giants (like US or Chinese companies) for its AI, or should it spend billions of dollars to build its own local AI technology?',
  'Feedback - Should a country like Australia rely on foreign tech giants (like US or Chinese companies) for its AI, or should it spend billions of dollars to build its own local AI technology?',
  'Imagine you graduate and start working in an Australian business. Why might your future boss care whether your company uses local AI or foreign AI? (Think about rules, security, or secrets).',
  'Points - Imagine you graduate and start working in an Australian business. Why might your future boss care whether your company uses local AI or foreign AI? (Think about rules, security, or secrets).',
  'Feedback - Imagine you graduate and start working in an Australian business. Why might your future boss care whether your company uses local AI or foreign AI? (Think about rules, security, or secrets).',
];

export function demoArrayBuffer() {
  const buffer = readFileSync(DEMO_PATH);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export function loadDemoSheet(sheetName) {
  const { workbook, sheetNames } = readWorkbookFile(demoArrayBuffer());
  const name = sheetName || sheetNames[0];
  return { sheet: readSheet(workbook, name), sheetNames, workbook };
}

export function loadDemoDataset(sheetName) {
  const { sheet, sheetNames } = loadDemoSheet(sheetName);
  return buildDataset(sheet, { filename: DEMO_FILENAME, sheetNames });
}

/** Build a workbook in memory, used to prove reordered columns / extra sheets work. */
export function workbookFromRows(sheetName, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}
