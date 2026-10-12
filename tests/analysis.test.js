import { describe, expect, it } from 'vitest';

import { readSheet } from '../app/lib/workbook.js';
import {
  buildDataset,
  buildObservations,
  countCategories,
  definitionCards,
  missingSummary,
  preferenceBreakdown,
  privacyBreakdown,
  selectRows,
  themeBreakdown,
  totalMissingAnswers,
  totalQuestionCells,
  workedExample,
  EMPTY_FILTERS,
} from '../app/lib/analysis.js';
import {
  AI_PREFERENCE_CATEGORIES,
  PRIVACY_CATEGORIES,
  classifyPreference,
  classifyPrivacy,
  cloneThemeRules,
  DEFAULT_THEME_RULES,
  matchThemes,
  parseKeywordList,
} from '../app/lib/rules.js';
import { DEMO_HEADERS, loadDemoDataset, workbookFromRows } from './helpers.js';

const [H_ID, , , , , H_TOTAL_POINTS, , , H_Q1, H_POINTS_Q1, , H_Q2, , , H_Q3, , , H_Q4, , , H_Q5] = DEMO_HEADERS;

describe('the demonstration workbook', () => {
  const dataset = loadDemoDataset();

  it('loads as one worksheet with 35 responses read from the file', () => {
    expect(dataset.sheetNames).toEqual(['Sheet1']);
    expect(dataset.sheetName).toBe('Sheet1');
    expect(dataset.headerExcelRow).toBe(1);
    expect(dataset.totalResponses).toBe(35);
    expect(dataset.complete).toBe(true);
    expect(dataset.questions.q1.letter).toBe('I');
    expect(dataset.questions.q2.letter).toBe('L');
    expect(dataset.questions.q3.letter).toBe('O');
    expect(dataset.questions.q4.letter).toBe('R');
    expect(dataset.questions.q5.letter).toBe('U');
  });

  it('keeps the exact question wording from the workbook', () => {
    expect(dataset.questions.q1.header).toBe('How would you define "AI Sovereignty"?');
    expect(dataset.questions.q3.header).toBe(H_Q3);
    expect(dataset.questions.q4.header).toBe(H_Q4);
    expect(dataset.questions.q5.header.endsWith('(Think about rules, security, or secrets).')).toBe(true);
  });

  it('excludes administrative and scoring columns but keeps the ID', () => {
    const letters = dataset.excludedColumns.map((c) => c.letter);
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) expect(letters).toContain(letter);
    for (const letter of ['J', 'K', 'M', 'N', 'P', 'Q', 'S', 'T', 'V', 'W']) expect(letters).toContain(letter);
    for (const letter of ['I', 'L', 'O', 'R', 'U']) expect(letters).not.toContain(letter);
    expect(dataset.idColumn).toEqual({ letter: 'A', header: 'ID' });
    expect(dataset.idSource).toBe('workbook');
    expect(dataset.excludedColumns).toHaveLength(18);
  });

  it('keeps each respondent together with their real Excel row', () => {
    expect(dataset.rows[0].displayId).toBe('1');
    expect(dataset.rows[0].excelRow).toBe(2);
    expect(dataset.rows[34].displayId).toBe('35');
    expect(dataset.rows[34].excelRow).toBe(36);
  });

  it('detects the synthetic-data disclaimer', () => {
    expect(dataset.synthetic).toBe(true);
  });

  it('counts no missing answers because every demo cell is answered', () => {
    expect(totalMissingAnswers(dataset)).toBe(0);
    expect(totalQuestionCells(dataset)).toBe(175);
    expect(dataset.missingByQuestion).toEqual({ q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 });
  });
});

describe('privacy classification (Question 3)', () => {
  const dataset = loadDemoDataset();
  const rows = selectRows(dataset, EMPTY_FILTERS, cloneThemeRules()).rows;

  it('orders concern from low to high with uncertainty separate', () => {
    expect(PRIVACY_CATEGORIES.map((c) => c.key)).toEqual([
      'not-concerned',
      'slightly',
      'moderately',
      'very',
      'unsure',
      'other',
      'missing',
    ]);
  });

  it('reconciles with the answers in the workbook', () => {
    const bars = Object.fromEntries(privacyBreakdown(rows).map((b) => [b.key, b.count]));
    expect(bars).toEqual({ 'not-concerned': 4, slightly: 10, moderately: 10, very: 7, unsure: 4, other: 0, missing: 0 });
    expect(Object.values(bars).reduce((a, b) => a + b, 0)).toBe(35);
  });

  it('tests "unsure" and "do not worry" before the plain worry wording', () => {
    expect(classifyPrivacy('I am unsure because I do not know where my data goes.').key).toBe('unsure');
    expect(classifyPrivacy('I do not worry about it much.').key).toBe('not-concerned');
    expect(classifyPrivacy('I worry a little bit, but convenience is more important.').key).toBe('slightly');
    expect(classifyPrivacy('I worry moderately and avoid sharing sensitive information.').key).toBe('moderately');
    expect(classifyPrivacy('I worry a lot and check privacy settings before using AI.').key).toBe('very');
    expect(classifyPrivacy('Extremely worried, all the time.').key).toBe('very');
    expect(classifyPrivacy('').key).toBe('missing');
    expect(classifyPrivacy('   ').key).toBe('missing');
    expect(classifyPrivacy('Nothing to say here.').key).toBe('other');
  });
});

describe('AI preference classification (Question 4)', () => {
  const dataset = loadDemoDataset();
  const rows = selectRows(dataset, EMPTY_FILTERS, cloneThemeRules()).rows;

  it('keeps the seven distinct positions', () => {
    expect(AI_PREFERENCE_CATEGORIES.map((c) => c.key)).toEqual([
      'rely-foreign',
      'some-local',
      'use-both',
      'build-local',
      'unsure',
      'other',
      'missing',
    ]);
  });

  it('reconciles with the answers in the workbook', () => {
    const bars = Object.fromEntries(preferenceBreakdown(rows).map((b) => [b.key, b.count]));
    expect(bars).toEqual({ 'rely-foreign': 5, 'some-local': 8, 'use-both': 11, 'build-local': 7, unsure: 4, other: 0, missing: 0 });
    expect(Object.values(bars).reduce((a, b) => a + b, 0)).toBe(35);
  });

  it('never forces a mixed or uncertain answer into a simple choice', () => {
    expect(classifyPreference('Use both: invest in local capability for sensitive uses and keep access to foreign tools.').key).toBe('use-both');
    expect(classifyPreference('Invest in local infrastructure and skills, but do not try to build everything ourselves.').key).toBe('some-local');
    expect(classifyPreference('Build our own local AI—it is safer and protects our national interests.').key).toBe('build-local');
    expect(classifyPreference('Rely on foreign AI providers because they offer better tools at lower cost.').key).toBe('rely-foreign');
    expect(classifyPreference('I am unsure whether the benefits of local AI would justify billions of dollars.').key).toBe('unsure');
    expect(classifyPreference('').key).toBe('missing');
  });
});

describe('theme grouping (Questions 2 and 5)', () => {
  const dataset = loadDemoDataset();
  const rules = cloneThemeRules();
  const rows = selectRows(dataset, EMPTY_FILTERS, rules).rows;

  it('gives every theme a count and a percentage of all selected responses', () => {
    const bars = themeBreakdown(rows, 'q2', rules.q2);
    expect(bars).toHaveLength(rules.q2.length + 2);
    for (const bar of bars) {
      expect(bar.denominator).toBe(35);
      expect(bar.percentage).toBeCloseTo((bar.count / 35) * 100, 6);
    }
  });

  it('lets one answer match several themes so percentages can exceed 100%', () => {
    const sum = themeBreakdown(rows, 'q2', rules.q2)
      .filter((b) => b.group === 'theme')
      .reduce((total, bar) => total + bar.percentage, 0);
    expect(sum).toBeGreaterThan(100);
  });

  it('counts an answer once per theme even when several keywords in that theme match', () => {
    const themes = [{ key: 't', label: 'T', keywords: ['essay', 'outline', 'writing'] }];
    const result = matchThemes('Planning a first outline for an essay.', themes);
    expect(result.matched).toEqual(['t']);
    expect(result.keywordsByTheme.t).toEqual(['essay', 'outline']);
  });

  it('separates unmatched answers from missing answers', () => {
    const bars = Object.fromEntries(themeBreakdown(rows, 'q5', rules.q5).map((b) => [b.key, b.count]));
    expect(bars.missing).toBe(0);
    expect(bars.unmatched).toBe(0);
  });

  it('ignores capital letters when matching', () => {
    expect(matchThemes('LEGAL obligations and PRIVACY', rules.q5).matched.sort()).toEqual(['legal', 'privacy']);
  });

  it('parses comma-separated keyword lists', () => {
    expect(parseKeywordList(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
  });

  it('recalculates when the rules are edited, and the defaults stay untouched', () => {
    const edited = cloneThemeRules();
    edited.q2 = edited.q2.filter((theme) => theme.key !== 'limited-reliance');
    const before = themeBreakdown(rows, 'q2', rules.q2).find((b) => b.key === 'limited-reliance').count;
    const after = themeBreakdown(rows, 'q2', edited.q2).find((b) => b.key === 'limited-reliance');
    expect(before).toBe(3);
    expect(after).toBeUndefined();
    expect(DEFAULT_THEME_RULES.q2.some((t) => t.key === 'limited-reliance')).toBe(true);

    const widened = cloneThemeRules();
    widened.q5 = widened.q5.map((theme) =>
      theme.key === 'legal' ? { ...theme, keywords: [...theme.keywords, 'outage'] } : theme,
    );
    const before2 = themeBreakdown(rows, 'q5', rules.q5);
    const after2 = themeBreakdown(rows, 'q5', widened.q5);
    expect(after2.every((bar) => bar.count >= (before2.find((b) => b.key === bar.key)?.count ?? 0))).toBe(true);
    expect(after2.find((b) => b.key === 'legal').count).toBeGreaterThan(before2.find((b) => b.key === 'legal').count);
  });
});

describe('filtering, search and chart clicks', () => {
  const dataset = loadDemoDataset();
  const rules = cloneThemeRules();

  it('selects respondents, not individual bars', () => {
    const { rows } = selectRows(dataset, { ...EMPTY_FILTERS, privacy: ['very'] }, rules);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.privacy.key === 'very')).toBe(true);
  });

  it('combines privacy, preference and search consistently', () => {
    const combined = selectRows(
      dataset,
      { privacy: ['very'], preference: ['build-local'], search: '', clicked: null },
      rules,
    );
    expect(combined.rows.every((r) => r.privacy.key === 'very' && r.preference.key === 'build-local')).toBe(true);
    expect(combined.rows.length).toBeLessThanOrEqual(7);

    const wider = selectRows(dataset, { privacy: ['very'], preference: [], search: '', clicked: null }, rules);
    expect(combined.rows.length).toBeLessThanOrEqual(wider.rows.length);
  });

  it('ignores capital letters in search and searches the response ID too', () => {
    const upper = selectRows(dataset, { ...EMPTY_FILTERS, search: 'PYTHON' }, rules);
    const lower = selectRows(dataset, { ...EMPTY_FILTERS, search: 'python' }, rules);
    expect(upper.rows.length).toBe(lower.rows.length);
    expect(lower.rows.length).toBeGreaterThan(0);

    const byId = selectRows(dataset, { ...EMPTY_FILTERS, search: '17' }, rules);
    expect(byId.rows.some((r) => r.displayId === '17')).toBe(true);
  });

  it('filters to a clicked theme bar', () => {
    const { rows } = selectRows(dataset, { ...EMPTY_FILTERS, clicked: { question: 'q2', key: 'coding' } }, rules);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.themes.q2.includes('coding'))).toBe(true);
  });

  it('filters to clicked unmatched and missing bars', () => {
    const unmatched = selectRows(dataset, { ...EMPTY_FILTERS, clicked: { question: 'q2', key: 'unmatched' } }, rules);
    expect(unmatched.rows.every((r) => !r.missingFlags.q2 && r.themes.q2.length === 0)).toBe(true);

    const missing = selectRows(dataset, { ...EMPTY_FILTERS, clicked: { question: 'q5', key: 'missing' } }, rules);
    expect(missing.rows).toHaveLength(0);
  });

  it('survives an empty result without throwing', () => {
    const state = { privacy: ['very'], preference: ['rely-foreign'], search: 'zzzzz-no-match', clicked: null };
    const { rows } = selectRows(dataset, state, rules);
    expect(rows).toHaveLength(0);
    expect(privacyBreakdown(rows).every((b) => b.count === 0)).toBe(true);
    expect(preferenceBreakdown(rows).every((b) => b.percentage === 0)).toBe(true);
    expect(themeBreakdown(rows, 'q2', rules.q2).every((b) => b.count === 0)).toBe(true);
    expect(workedExample(rows, rules)).toBeNull();
    expect(definitionCards(rows).cards).toHaveLength(0);
    const observations = buildObservations({ rows, themeRules: rules });
    expect(observations).toHaveLength(3);
    expect(observations.every((o) => typeof o.text === 'string' && o.text.length > 0)).toBe(true);
    expect(missingSummary(rows, dataset).total).toBe(0);
  });
});

describe('observations', () => {
  const dataset = loadDemoDataset();
  const rules = cloneThemeRules();
  const rows = selectRows(dataset, EMPTY_FILTERS, rules).rows;

  it('returns three observations, each linked to the chart that supports it', () => {
    const observations = buildObservations({ rows, themeRules: rules });
    expect(observations).toHaveLength(3);
    for (const observation of observations) {
      expect(observation.anchor.startsWith('#')).toBe(true);
      expect(observation.chartId).toBeTruthy();
      expect(observation.text).toMatch(/\d/);
    }
    expect(new Set(observations.map((o) => o.chartId)).size).toBe(3);
  });

  it('surfaces ties instead of inventing a winner', () => {
    const flat = countCategories(
      [{ key: 'a' }, { key: 'b' }],
      [
        { key: 'a', label: 'A', group: 'x', order: 1 },
        { key: 'b', label: 'B', group: 'x', order: 2 },
      ],
      (row) => row.key,
    );
    expect(flat.map((b) => b.count)).toEqual([1, 1]);
    expect(flat.map((b) => b.percentage)).toEqual([50, 50]);
  });
});

describe('Question 1 quotations', () => {
  const dataset = loadDemoDataset();
  const rules = cloneThemeRules();
  const rows = selectRows(dataset, EMPTY_FILTERS, rules).rows;

  it('shows one card per distinct answer in worksheet order, with the first matching row', () => {
    const { cards, distinct, answered } = definitionCards(rows);
    expect(answered).toBe(35);
    expect(distinct).toBe(cards.length);
    expect(cards[0].excelRow).toBe(2);
    const keys = cards.map((c) => c.text.trim().toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < cards.length; i += 1) {
      expect(cards[i].excelRow).toBeGreaterThanOrEqual(cards[i - 1].excelRow);
    }
  });

  it('shows no quotation for blank answers', () => {
    const blankRows = rows.filter((row) => row.missingFlags.q1);
    expect(definitionCards(blankRows).cards).toHaveLength(0);
  });

  it('changes when the filters change', () => {
    const filtered = selectRows(dataset, { ...EMPTY_FILTERS, privacy: ['very'] }, rules).rows;
    expect(definitionCards(filtered).cards.length).toBeLessThanOrEqual(definitionCards(rows).cards.length);
    expect(definitionCards(filtered).answered).toBe(7);
  });
});

describe('worked example', () => {
  it('is taken from the current data and names its matched keywords', () => {
    const dataset = loadDemoDataset();
    const rules = cloneThemeRules();
    const rows = selectRows(dataset, EMPTY_FILTERS, rules).rows;
    const example = workedExample(rows, rules);
    expect(example).not.toBeNull();
    expect([2, 5]).toContain(example.questionNumber);
    expect(example.allKeywords.length).toBeGreaterThan(0);
    expect(example.row.answers[example.question]).toBeTruthy();
    expect(example.themes.length).toBeGreaterThan(0);
    expect(example.contribution).toHaveLength(example.themes.length);
  });
});

describe('blank cells are never treated as zero', () => {
  const rows = [
    [H_ID, H_TOTAL_POINTS, H_POINTS_Q1, H_Q1, H_Q2, H_Q3, H_Q4, H_Q5],
    [1, '', '', 'Control of my own data.', 'Debugging Python code.', 'I worry a lot.', 'Build local AI.', 'Legal obligations matter.'],
    [2, '', '', 'Sovereignty means self-rule.', '', 'I do not worry about it much.', '', ''],
    [3, '', '', '', 'Translating readings.', 'I am unsure.', 'Use both if possible.', 'Privacy and cost.'],
  ];

  const sheet = readSheet(workbookFromRows('Responses', rows), 'Responses');
  const dataset = buildDataset(sheet, { filename: 'blank-test.xlsx', sheetNames: ['Responses'] });

  it('keeps identified respondents with missing answers', () => {
    expect(dataset.totalResponses).toBe(3);
    expect(dataset.missingByQuestion).toEqual({ q1: 1, q2: 1, q3: 0, q4: 1, q5: 1 });
    expect(totalMissingAnswers(dataset)).toBe(4);
    expect(totalQuestionCells(dataset)).toBe(15);
    expect(dataset.rows[1].displayId).toBe('2');
    expect(dataset.rows[1].missingCount).toBe(3);
    expect(dataset.rows[1].answeredCount).toBe(2);
  });

  it('marks blanks as Missing answer and keeps them in the denominator', () => {
    const rules = cloneThemeRules();
    const selected = selectRows(dataset, EMPTY_FILTERS, rules).rows;
    const q2 = Object.fromEntries(themeBreakdown(selected, 'q2', rules.q2).map((b) => [b.key, b.count]));
    expect(q2.missing).toBe(1);
    expect(themeBreakdown(selected, 'q2', rules.q2)[0].denominator).toBe(3);

    const privacy = Object.fromEntries(privacyBreakdown(selected).map((b) => [b.key, b.count]));
    expect(privacy).toMatchObject({ very: 1, 'not-concerned': 1, unsure: 1, missing: 0 });
    expect(privacyBreakdown(selected)[0].denominator).toBe(3);

    const q5 = Object.fromEntries(themeBreakdown(selected, 'q5', rules.q5).map((b) => [b.key, b.count]));
    expect(q5.missing).toBe(1);
  });

  it('does not turn blank scoring columns into scores', () => {
    const letters = dataset.excludedColumns.map((c) => c.letter);
    expect(letters).toContain('B');
    expect(letters).toContain('C');
    // The scoring columns are removed before any counting happens, so a blank
    // score can never be read as zero.
    expect(dataset.rows.every((row) => Object.keys(row.answers).sort().join(',') === 'q1,q2,q3,q4,q5')).toBe(true);
  });

  it('assigns dashboard IDs when there is no ID column', () => {
    const noIdHeaders = [H_TOTAL_POINTS, H_POINTS_Q1, H_Q1, H_Q2, H_Q3, H_Q4, H_Q5];
    const generated = buildDataset(
      readSheet(workbookFromRows('No id', [noIdHeaders, ['', 'x', 'Self-rule.', 'Coding.', 'Very worried.', 'Build local AI.', 'Privacy.']]), 'No id'),
      { filename: 'no-id.xlsx' },
    );
    expect(generated.idSource).toBe('generated');
    expect(generated.rows[0].displayId).toBe('#1');
    expect(generated.rows[0].workbookId).toBeNull();
  });
});
