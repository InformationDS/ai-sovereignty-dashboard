import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  columnLetter,
  detectQuestionColumns,
  isAdminField,
  isScoringDuplicate,
  normalizeHeader,
} from '../app/lib/columns.js';
import { readSheet } from '../app/lib/workbook.js';
import { buildDataset } from '../app/lib/analysis.js';
import { DEMO_HEADERS, workbookFromRows } from './helpers.js';

function columnsFromHeaders(headers) {
  return headers.map((header, index) => ({
    index,
    letter: columnLetter(index),
    header,
    normalized: normalizeHeader(header),
  }));
}

describe('columnLetter', () => {
  it('maps indices to real Excel letters', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(8)).toBe('I');
    expect(columnLetter(11)).toBe('L');
    expect(columnLetter(14)).toBe('O');
    expect(columnLetter(17)).toBe('R');
    expect(columnLetter(20)).toBe('U');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
  });
});

describe('administrative and scoring fields', () => {
  it('flags scoring duplicates', () => {
    expect(isScoringDuplicate('Points - How would you define "AI Sovereignty"?')).toBe(true);
    expect(isScoringDuplicate('Feedback - When you use an AI tool')).toBe(true);
    expect(isScoringDuplicate('Total points')).toBe(false);
  });

  it('excludes administrative headers but keeps the survey questions', () => {
    const admin = ['ID', 'Start time', 'Completion time', 'Email', 'Name', 'Total points', 'Quiz feedback', 'Last modified time'];
    for (const header of admin) expect(isAdminField(header), header).toBe(true);
    for (const header of DEMO_HEADERS.slice(8)) {
      if (/^(Points|Feedback) -/.test(header)) continue;
      expect(isAdminField(header), header).toBe(false);
    }
  });
});

describe('question column detection', () => {
  it('resolves the five questions and their letters from the real header wording', () => {
    const { mapping, missing } = detectQuestionColumns(columnsFromHeaders(DEMO_HEADERS));
    expect(missing).toEqual([]);
    expect(mapping.q1.letter).toBe('I');
    expect(mapping.q2.letter).toBe('L');
    expect(mapping.q3.letter).toBe('O');
    expect(mapping.q4.letter).toBe('R');
    expect(mapping.q5.letter).toBe('U');
  });

  it('still works when the question columns are reordered', () => {
    const shuffled = [DEMO_HEADERS[0], DEMO_HEADERS[20], DEMO_HEADERS[11], DEMO_HEADERS[8], DEMO_HEADERS[17], DEMO_HEADERS[14], DEMO_HEADERS[2]];
    const { mapping, missing } = detectQuestionColumns(columnsFromHeaders(shuffled));
    expect(missing).toEqual([]);
    // A: ID, B: Q5 header, C: Q2 header, D: Q1 header, E: Q4 header, F: Q3 header, G: Completion time
    expect(mapping.q5.letter).toBe('B');
    expect(mapping.q2.letter).toBe('C');
    expect(mapping.q1.letter).toBe('D');
    expect(mapping.q4.letter).toBe('E');
    expect(mapping.q3.letter).toBe('F');
  });

  it('reports missing questions instead of guessing when a header is absent', () => {
    const { mapping, missing } = detectQuestionColumns(
      columnsFromHeaders(['ID', 'Email', DEMO_HEADERS[8], DEMO_HEADERS[11], DEMO_HEADERS[17]]),
    );
    expect(missing.sort()).toEqual(['q3', 'q5']);
    expect(mapping.q1.letter).toBe('C');
    expect(mapping.q2.letter).toBe('D');
    expect(mapping.q4.letter).toBe('E');
  });

  it('never assigns one column to two questions', () => {
    const { mapping } = detectQuestionColumns(columnsFromHeaders(DEMO_HEADERS));
    const letters = Object.values(mapping).map((c) => c.letter);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it('handles the generic subject-style headers too', () => {
    const { mapping, missing } = detectQuestionColumns(
      columnsFromHeaders([
        'ID',
        'Email',
        'The question asking respondents to define AI sovereignty',
        'The question about difficult tasks if foreign AI apps were banned',
        'The question about ownership of personal data',
        'The question about foreign providers versus local investment',
        'The question about local or foreign AI in an Australian business',
      ]),
    );
    expect(missing).toEqual([]);
    expect(mapping.q1.letter).toBe('C');
    expect(mapping.q2.letter).toBe('D');
    expect(mapping.q3.letter).toBe('E');
    expect(mapping.q4.letter).toBe('F');
    expect(mapping.q5.letter).toBe('G');
  });
});

describe('multiple worksheets', () => {
  it('reads the requested sheet and keeps the sheet list available for the selector', () => {
    const wb = workbookFromRows('Sheet One', [['A', 'B'], [1, 2]]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['ID', DEMO_HEADERS[8], DEMO_HEADERS[20]],
      [1, 'Control of AI systems', 'Legal and security'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Sheet Two');

    expect(wb.SheetNames).toEqual(['Sheet One', 'Sheet Two']);

    const sheetTwo = readSheet(wb, 'Sheet Two');
    const dataset = buildDataset(sheetTwo, { filename: 'multi.xlsx', sheetNames: wb.SheetNames });
    expect(dataset.sheetName).toBe('Sheet Two');
    expect(dataset.sheetNames).toEqual(['Sheet One', 'Sheet Two']);
    expect(dataset.totalResponses).toBe(1);
    expect(dataset.questions.q1.letter).toBe('B');
    expect(dataset.questions.q5.letter).toBe('C');
    expect(dataset.missingQuestions).toEqual(['q2', 'q3', 'q4']);
    expect(dataset.complete).toBe(false);
  });
});
