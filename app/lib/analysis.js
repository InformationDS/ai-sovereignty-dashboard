/**
 * Analysis layer: turns a worksheet into a dataset, then turns a dataset plus
 * the current filter state into every number the dashboard shows.
 *
 * Rules for the numbers in this file:
 *  - Nothing is hardcoded. Totals, counts, percentages and denominators are all
 *    derived from the workbook that is currently loaded.
 *  - A blank cell is never treated as a zero, a "no" or a score. It is counted as
 *    a missing answer.
 *  - Filters select respondents (rows), not individual bars.
 */

import {
  QUESTION_DEFINITIONS,
  QUESTION_ORDER,
  adminReason,
  detectQuestionColumns,
  normalizeHeader,
  isIdColumn,
} from './columns.js';
import {
  AI_PREFERENCE_CATEGORIES,
  PRIVACY_CATEGORIES,
  POSITION_PREFERENCE_KEYS,
  GRADED_PRIVACY_KEYS,
  classifyPreference,
  classifyPrivacy,
  cloneThemeRules,
  matchThemes,
} from './rules.js';

const SYNTHETIC_PATTERN = /synthetic|fictional|made[- ]up|not collected from participants/i;

function blank(value) {
  return String(value ?? '').trim() === '';
}

/* ------------------------------------------------------------------ *
 * Dataset
 * ------------------------------------------------------------------ */

/**
 * @param {{columns:Array, rows:Array, name:string, headerExcelRow:number, skippedBlankRows:number}} sheet
 * @param {{filename:string}} meta
 */
export function buildDataset(sheet, meta = {}) {
  const { mapping, missing } = detectQuestionColumns(sheet.columns);

  const questions = {};
  for (const def of QUESTION_DEFINITIONS) {
    const column = mapping[def.id];
    questions[def.id] = {
      id: def.id,
      short: def.short,
      subject: def.subject,
      chartTitle: def.chartTitle,
      letter: column ? column.letter : null,
      header: column ? column.header : null,
      index: column ? column.index : null,
      detected: Boolean(column),
    };
  }

  const idColumn = sheet.columns.find((c) => isIdColumn(c.header)) || null;

  const excludedColumns = sheet.columns
    .filter((c) => !c.normalized)
    .map((c) => ({ letter: c.letter, header: c.header, reason: 'Empty header cell' }));

  for (const c of sheet.columns) {
    if (!c.normalized) continue;
    if (Object.values(questions).some((q) => q.letter === c.letter)) continue;
    excludedColumns.push({ letter: c.letter, header: c.header, reason: adminReason(c.header) });
  }
  excludedColumns.sort((a, b) => a.letter.localeCompare(b.letter, 'en', { numeric: true }));

  // Synthetic-data detection scans the whole used range, including the
  // administrative columns, because exports often park the disclaimer there.
  let synthetic = false;
  for (const row of sheet.rows) {
    for (const value of Object.values(row.cells)) {
      if (SYNTHETIC_PATTERN.test(String(value))) {
        synthetic = true;
        break;
      }
    }
    if (synthetic) break;
  }

  const rows = sheet.rows.map((raw, i) => {
    const answers = {};
    const missingFlags = {};
    for (const id of QUESTION_ORDER) {
      const letter = questions[id].letter;
      const value = letter ? String(raw.cells[letter] ?? '') : '';
      answers[id] = value;
      missingFlags[id] = blank(value);
    }
    const workbookId = idColumn ? String(raw.cells[idColumn.letter] ?? '').trim() : '';
    const missingCount = QUESTION_ORDER.filter((id) => missingFlags[id] && questions[id].detected).length;
    const detectedCount = QUESTION_ORDER.filter((id) => questions[id].detected).length;
    return {
      index: i,
      displayId: workbookId || `#${i + 1}`,
      workbookId: workbookId || null,
      excelRow: raw.excelRow,
      answers,
      missingFlags,
      missingCount,
      answeredCount: Math.max(detectedCount - missingCount, 0),
      privacy: classifyPrivacy(answers.q3),
      preference: classifyPreference(answers.q4),
    };
  });

  const missingByQuestion = {};
  for (const id of QUESTION_ORDER) {
    missingByQuestion[id] = questions[id].detected ? rows.filter((r) => r.missingFlags[id]).length : 0;
  }

  return {
    filename: meta.filename || 'Unknown workbook',
    sheetName: sheet.name,
    sheetNames: meta.sheetNames || [sheet.name],
    headerExcelRow: sheet.headerExcelRow,
    columns: sheet.columns,
    questions,
    questionOrder: QUESTION_ORDER,
    missingQuestions: missing,
    complete: missing.length === 0,
    excludedColumns,
    idColumn: idColumn ? { letter: idColumn.letter, header: idColumn.header } : null,
    idSource: idColumn ? 'workbook' : 'generated',
    rows,
    totalResponses: rows.length,
    skippedBlankRows: sheet.skippedBlankRows || 0,
    missingByQuestion,
    synthetic,
  };
}

export function totalMissingAnswers(dataset) {
  return QUESTION_ORDER.reduce((sum, id) => sum + (dataset.missingByQuestion[id] || 0), 0);
}

export function totalQuestionCells(dataset) {
  const detected = QUESTION_ORDER.filter((id) => dataset.questions[id].detected).length;
  return dataset.totalResponses * detected;
}

/* ------------------------------------------------------------------ *
 * Filtering
 * ------------------------------------------------------------------ */

export const EMPTY_FILTERS = {
  privacy: [],
  preference: [],
  clicked: null,
  search: '',
};

export function hasActiveFilters(state) {
  return Boolean(
    (state.privacy && state.privacy.length) ||
      (state.preference && state.preference.length) ||
      state.clicked ||
      String(state.search || '').trim(),
  );
}

export function describeFilters(state, themeRules) {
  const parts = [];
  if (state.privacy && state.privacy.length) {
    parts.push(
      `Privacy concern: ${state.privacy
        .map((key) => (PRIVACY_CATEGORIES.find((c) => c.key === key) || { label: key }).label)
        .join(', ')}`,
    );
  }
  if (state.preference && state.preference.length) {
    parts.push(
      `AI preference: ${state.preference
        .map((key) => (AI_PREFERENCE_CATEGORIES.find((c) => c.key === key) || { label: key }).label)
        .join(', ')}`,
    );
  }
  if (state.clicked) {
    parts.push(`Clicked chart category: ${labelForCategory(state.clicked, themeRules)}`);
  }
  const search = String(state.search || '').trim();
  if (search) parts.push(`Search: “${search}”`);
  return parts;
}

export function labelForCategory(clicked, themeRules) {
  const { question, key } = clicked;
  if (question === 'q3') return (PRIVACY_CATEGORIES.find((c) => c.key === key) || { label: key }).label;
  if (question === 'q4') return (AI_PREFERENCE_CATEGORIES.find((c) => c.key === key) || { label: key }).label;
  const themes = (themeRules || cloneThemeRules())[question] || [];
  if (key === 'unmatched') return 'Unmatched answer';
  if (key === 'missing') return 'Missing answer';
  return (themes.find((t) => t.key === key) || { label: key }).label;
}

function matchesSearch(row, needle) {
  if (!needle) return true;
  const haystack = [...QUESTION_ORDER.map((id) => row.answers[id] || ''), row.displayId, String(row.excelRow)]
    .join(' \u0000 ')
    .toLowerCase();
  return haystack.includes(needle);
}

/** Row-level theme assignments under the supplied rules. */
export function annotateRows(rows, themeRules) {
  return rows.map((row) => {
    const q2 = matchThemes(row.answers.q2, themeRules.q2);
    const q5 = matchThemes(row.answers.q5, themeRules.q5);
    return {
      ...row,
      themes: {
        q2: row.missingFlags.q2 ? [] : q2.matched,
        q5: row.missingFlags.q5 ? [] : q5.matched,
      },
      themeKeywords: {
        q2: q2.keywordsByTheme,
        q5: q5.keywordsByTheme,
      },
    };
  });
}

/**
 * Apply the current view state. Every chart, total, quotation, example and table
 * row must be built from this single return value.
 */
export function selectRows(dataset, state, themeRules) {
  const rules = themeRules || cloneThemeRules();
  const annotated = annotateRows(dataset.rows, rules);
  const needle = String(state.search || '').trim().toLowerCase();

  const selected = annotated.filter((row) => {
    if (!matchesSearch(row, needle)) return false;
    if (state.privacy && state.privacy.length && !state.privacy.includes(row.privacy.key)) return false;
    if (state.preference && state.preference.length && !state.preference.includes(row.preference.key)) return false;
    if (state.clicked) {
      const { question, key } = state.clicked;
      if (question === 'q3') {
        if (row.privacy.key !== key) return false;
      } else if (question === 'q4') {
        if (row.preference.key !== key) return false;
      } else {
        const answered = !row.missingFlags[question];
        if (key === 'missing') {
          if (answered) return false;
        } else if (key === 'unmatched') {
          if (!answered || row.themes[question].length > 0) return false;
        } else if (!row.themes[question].includes(key)) {
          return false;
        }
      }
    }
    return true;
  });

  return { rows: selected, rules };
}

/* ------------------------------------------------------------------ *
 * Counts
 * ------------------------------------------------------------------ */

/**
 * @returns {Array<{key,label,group,order,count,percentage,answered,missing}>}
 * percentage denominator is the number of selected responses, so it includes
 * responses whose answer to that question was missing.
 */
export function countCategories(rows, categories, keyOf) {
  const denominator = rows.length;
  const counts = new Map(categories.map((c) => [c.key, 0]));
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return categories.map((category) => {
    const count = counts.get(category.key) || 0;
    return {
      ...category,
      count,
      percentage: denominator === 0 ? 0 : (count / denominator) * 100,
      denominator,
    };
  });
}

export function privacyBreakdown(rows) {
  return countCategories(rows, PRIVACY_CATEGORIES, (row) => row.privacy.key);
}

export function preferenceBreakdown(rows) {
  return countCategories(rows, AI_PREFERENCE_CATEGORIES, (row) => row.preference.key);
}

/**
 * Theme breakdown for Q2 / Q5.
 *  - A theme percentage is matching answers / all selected responses.
 *  - "Unmatched" counts answered cells that matched no theme keyword.
 *  - "Missing answer" counts blank question cells.
 *  - Because one answer can match several themes the percentages can exceed 100%.
 *
 * Matches are recalculated here from the raw answer using the themes passed in,
 * so a rule edit is reflected immediately without re-running the filter step.
 */
export function themeBreakdown(rows, question, themes) {
  const denominator = rows.length;
  const counts = new Map(themes.map((theme) => [theme.key, 0]));
  let unmatched = 0;
  let missing = 0;

  for (const row of rows) {
    if (row.missingFlags[question]) {
      missing += 1;
      continue;
    }
    const matched = matchThemes(row.answers[question], themes).matched;
    if (matched.length === 0) {
      unmatched += 1;
      continue;
    }
    for (const key of matched) counts.set(key, (counts.get(key) || 0) + 1);
  }

  const bars = themes.map((theme) => {
    const count = counts.get(theme.key) || 0;
    return {
      key: theme.key,
      label: theme.label,
      group: 'theme',
      count,
      percentage: denominator === 0 ? 0 : (count / denominator) * 100,
      denominator,
      keywords: theme.keywords,
    };
  });

  bars.push({
    key: 'unmatched',
    label: 'Unmatched (answered, matched no keyword)',
    group: 'unrecognised',
    count: unmatched,
    percentage: denominator === 0 ? 0 : (unmatched / denominator) * 100,
    denominator,
  });
  bars.push({
    key: 'missing',
    label: 'Missing answer',
    group: 'missing',
    count: missing,
    percentage: denominator === 0 ? 0 : (missing / denominator) * 100,
    denominator,
  });

  return bars;
}

export function missingSummary(rows, dataset) {
  const byQuestion = {};
  for (const id of QUESTION_ORDER) {
    byQuestion[id] = dataset.questions[id].detected ? rows.filter((r) => r.missingFlags[id]).length : 0;
  }
  return {
    byQuestion,
    total: QUESTION_ORDER.reduce((sum, id) => sum + byQuestion[id], 0),
  };
}

/* ------------------------------------------------------------------ *
 * Observations
 * ------------------------------------------------------------------ */

function leadingObservation(bars, { chartId, chartLabel, anchor, countWord }) {
  const total = bars.reduce((sum, bar) => sum + bar.count, 0);
  if (total === 0) {
    return {
      chartId,
      chartLabel,
      anchor,
      tie: false,
      empty: true,
      text: `No responses are currently selected for ${chartLabel.toLowerCase()}, so there is nothing to observe yet.`,
    };
  }
  const max = Math.max(...bars.map((b) => b.count));
  const leaders = bars.filter((b) => b.count === max);
  const share = ((max / total) * 100).toFixed(1);
  const pctOfResponses = leaders[0].percentage.toFixed(1);

  if (leaders.length > 1) {
    const names = leaders.map((l) => l.label).join(' and ');
    return {
      chartId,
      chartLabel,
      anchor,
      tie: true,
      topCount: max,
      text: `Tied at the top of ${chartLabel.toLowerCase()}: ${names}, with ${max} response${
        max === 1 ? '' : 's'
      } each (${pctOfResponses}% of the ${total} selected response${total === 1 ? '' : 's'}). ${countWord}`,
    };
  }

  return {
    chartId,
    chartLabel,
    anchor,
    tie: false,
    topCount: max,
    text: `${leaders[0].label} is the most common answer for ${chartLabel.toLowerCase()}: ${max} of ${
      total
    } selected response${total === 1 ? '' : 's'} (${pctOfResponses}%). ${countWord}`,
  };
}

/**
 * Three observations, calculated from the current view only, each linked to the
 * chart that supports it. The strongest three of the four candidate charts are
 * reported, so ties and small selections are handled consistently.
 */
export function buildObservations({ rows, themeRules }) {
  const privacy = privacyBreakdown(rows);
  const preference = preferenceBreakdown(rows);
  const q2 = themeBreakdown(rows, 'q2', themeRules.q2).filter((b) => b.group === 'theme');
  const q5 = themeBreakdown(rows, 'q5', themeRules.q5).filter((b) => b.group === 'theme');

  const candidates = [
    {
      rank: privacy.reduce((sum, b) => sum + b.count, 0) === 0 ? 0 : Math.max(...privacy.map((b) => b.percentage)),
      observation: leadingObservation(privacy, {
        chartId: 'privacy',
        chartLabel: 'Privacy concerns (Question 3)',
        anchor: '#privacy',
        countWord: 'This chart counts how concerned students said they were about who owns their personal data.',
      }),
    },
    {
      rank: preference.reduce((sum, b) => sum + b.count, 0) === 0 ? 0 : Math.max(...preference.map((b) => b.percentage)),
      observation: leadingObservation(preference, {
        chartId: 'preference',
        chartLabel: 'Local versus foreign AI (Question 4)',
        anchor: '#preference',
        countWord: 'This chart counts expressed positions, not correct answers, and mixed positions are kept separate.',
      }),
    },
    {
      rank: q2.reduce((sum, b) => sum + b.count, 0) === 0 ? 0 : Math.max(...q2.map((b) => b.percentage)),
      observation: leadingObservation(q2, {
        chartId: 'reliance',
        chartLabel: 'Everyday reliance on AI (Question 2)',
        anchor: '#reliance',
        countWord: 'One answer can belong to more than one theme, so these percentages are not a share of a fixed whole.',
      }),
    },
    {
      rank: q5.reduce((sum, b) => sum + b.count, 0) === 0 ? 0 : Math.max(...q5.map((b) => b.percentage)),
      observation: leadingObservation(q5, {
        chartId: 'business',
        chartLabel: 'Business considerations (Question 5)',
        anchor: '#business',
        countWord: 'These are provisional keyword groupings, so a match is a possible signal rather than proof of a respondent’s view.',
      }),
    },
  ];

  return candidates
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .map((c) => c.observation);
}

/** Percentage of selected responses that sit in the two most concerned categories. */
export function highConcernSummary(rows) {
  const bars = privacyBreakdown(rows);
  const total = rows.length;
  const high = bars.filter((b) => b.key === 'very' || b.key === 'moderately').reduce((s, b) => s + b.count, 0);
  return { count: high, total, percentage: total === 0 ? 0 : (high / total) * 100 };
}

/* ------------------------------------------------------------------ *
 * Question 1 quotations
 * ------------------------------------------------------------------ */

/**
 * One card per distinct answer, in worksheet order, using the first matching
 * response ID and Excel row. Repeated answers stay available in the response
 * table. Blank answers produce no quotation card.
 */
export function definitionCards(rows) {
  const seen = new Map();
  for (const row of rows) {
    const text = String(row.answers.q1 || '').trim();
    if (!text) continue;
    const key = normalizeHeader(text);
    if (seen.has(key)) continue;
    seen.set(key, {
      text,
      displayId: row.displayId,
      excelRow: row.excelRow,
      repeated: 0,
    });
  }
  const cards = [...seen.values()];
  const totalAnswered = rows.filter((r) => !r.missingFlags.q1).length;
  return { cards, distinct: cards.length, answered: totalAnswered };
}

/* ------------------------------------------------------------------ *
 * Worked example
 * ------------------------------------------------------------------ */

/**
 * Pick a real answer from the current view that matched at least one theme.
 * Preference order: the answer with the most matched themes, then worksheet
 * order, alternating between Q2 and Q5 so both written questions are represented.
 */
export function workedExample(rows, themeRules) {
  const candidates = [];
  for (const row of rows) {
    for (const question of ['q2', 'q5']) {
      if (row.missingFlags[question]) continue;
      const result = matchThemes(row.answers[question], themeRules[question]);
      if (!result.matched.length) continue;
      const keywords = result.matched.flatMap((key) => result.keywordsByTheme[key]);
      candidates.push({
        question,
        questionNumber: question === 'q2' ? 2 : 5,
        row,
        themes: result.matched.map((key) => {
          const theme = themeRules[question].find((t) => t.key === key);
          return { key, label: theme ? theme.label : key, keywords: result.keywordsByTheme[key] };
        }),
        allKeywords: keywords,
      });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      b.themes.length - a.themes.length ||
      a.row.index - b.row.index ||
      a.questionNumber - b.questionNumber,
  );
  // Deterministic: the strongest match wins, ties resolved by worksheet order.
  // A stable choice means the panel does not flicker when filters change.
  const best = candidates[0];
  return {
    ...best,
    totalCandidates: candidates.length,
    contribution: best.themes.map((t) => ({
      theme: t.label,
      note: 'this answer adds 1 to the count for this theme',
    })),
  };
}

export { PRIVACY_CATEGORIES, AI_PREFERENCE_CATEGORIES, POSITION_PREFERENCE_KEYS, GRADED_PRIVACY_KEYS };
