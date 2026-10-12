/**
 * Workbook reading. Everything happens in the browser (or in Node during tests);
 * there is no upload server, no account and no database.
 */

import * as XLSX from 'xlsx';
import { columnLetter, normalizeHeader, isIdColumn, isAdminField } from './columns.js';

export const DEMO_FILENAME = 'AI_Sovereignty_35_Synthetic_Responses.xlsx';

function cellText(ws, r, c) {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell) return '';
  if (cell.t === 'e') return cell.w ? String(cell.w) : '';
  const raw = cell.w !== undefined && cell.w !== null ? cell.w : cell.v;
  if (raw === undefined || raw === null) return '';
  if (raw instanceof Date) {
    const iso = raw.toISOString();
    return iso;
  }
  return String(raw);
}

function isBlank(value) {
  return String(value ?? '').trim() === '';
}

/**
 * Find the header row: the first row that holds at least two non-empty text
 * cells. Survey exports often put a title or a blank spacer row above it.
 */
function findHeaderRow(ws, range) {
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 12); r += 1) {
    let filled = 0;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      if (!isBlank(cellText(ws, r, c))) filled += 1;
    }
    if (filled >= 2) return r;
  }
  return range.s.r;
}

/**
 * Turn one worksheet into a plain, framework-free structure.
 * Column letters are the real Excel letters, so the dashboard can tell students
 * exactly which cell an answer came from.
 */
export function readSheet(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws || !ws['!ref']) {
    return { name: sheetName, usable: false, reason: 'This worksheet is empty.', columns: [], rows: [] };
  }

  const range = XLSX.utils.decode_range(ws['!ref']);
  const headerRowIndex = findHeaderRow(ws, range);

  const columns = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const header = cellText(ws, headerRowIndex, c);
    columns.push({
      index: c,
      letter: columnLetter(c),
      header: String(header ?? ''),
      normalized: normalizeHeader(header),
    });
  }

  const rows = [];
  let skippedBlankRows = 0;
  for (let r = headerRowIndex + 1; r <= range.e.r; r += 1) {
    const cells = {};
    let anyFilled = false;
    for (const column of columns) {
      const text = cellText(ws, r, column.index);
      cells[column.letter] = text;
      if (!isBlank(text)) anyFilled = true;
    }
    if (!anyFilled) {
      skippedBlankRows += 1;
      continue;
    }
    rows.push({ excelRow: r + 1, cells });
  }

  return {
    name: sheetName,
    usable: columns.some((c) => c.normalized) && rows.length > 0,
    reason: '',
    headerRowIndex,
    headerExcelRow: headerRowIndex + 1,
    columns,
    rows,
    skippedBlankRows,
  };
}

/** Read an .xlsx / .xls / .csv ArrayBuffer. Throws a plain-language error on failure. */
export function readWorkbookFile(arrayBuffer) {
  let workbook;
  try {
    workbook = XLSX.read(new Uint8Array(arrayBuffer), {
      type: 'array',
      cellDates: false,
      cellText: false,
      // Keep everything as displayed text: this survey is read-only and we never
      // want a blank scoring cell to be coerced into a number.
      raw: false,
    });
  } catch (error) {
    const err = new Error(
      'That file could not be read as a workbook. Supported formats are .xlsx, .xls and .csv. If it is a different kind of file, export it to .xlsx first.',
    );
    err.cause = error;
    throw err;
  }
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('That workbook does not contain any worksheets.');
  }
  return { workbook, sheetNames };
}

/** Convenience for building the dataset structure from a raw sheet. */
export function sheetColumnsAndRows(sheet) {
  return { columns: sheet.columns || [], rows: sheet.rows || [] };
}

export { isIdColumn, isAdminField, isBlank };
