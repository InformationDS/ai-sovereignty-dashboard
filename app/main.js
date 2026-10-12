/**
 * Classroom lens — dashboard UI.
 *
 * Everything the page shows is derived from ONE call to selectRows() per render:
 * `const { rows, rules } = selectRows(dataset, state.filters, state.themeRules)`.
 * Totals, charts, quotations, the worked example, denominators, observations and
 * the response table are all built from that single result, so the view can never
 * disagree with itself.
 *
 * Nothing here modifies app/lib/*. The library is the source of truth for data.
 */

import { readWorkbookFile, readSheet, DEMO_FILENAME } from './lib/workbook.js';
import {
  buildDataset,
  EMPTY_FILTERS,
  selectRows,
  privacyBreakdown,
  preferenceBreakdown,
  themeBreakdown,
  buildObservations,
  definitionCards,
  workedExample,
  missingSummary,
  hasActiveFilters,
  describeFilters,
  highConcernSummary,
} from './lib/analysis.js';
import {
  PRIVACY_CATEGORIES,
  AI_PREFERENCE_CATEGORIES,
  PRIVACY_RULES,
  PREFERENCE_RULES,
  cloneThemeRules,
  parseKeywordList,
  QUESTION_1_NOTE,
} from './lib/rules.js';

/* ------------------------------------------------------------------ *
 * Rendered section containers live in index.html; these are the bits
 * that change with the data. The filter controls and the rule editor are
 * built once so that typing never loses focus.
 * ------------------------------------------------------------------ */

const $ = (selector) => document.querySelector(selector);

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/** The single state object. render() reads only from here. */
const state = {
  // Raw workbook kept so a worksheet switch can re-read without re-uploading.
  workbook: null,
  sheetNames: [],
  filename: '',
  dataset: null,
  filters: emptyFilters(),
  themeRules: cloneThemeRules(),
  expanded: new Set(), // keys "rowIndex:questionId" that are expanded in the table
  status: { kind: 'idle', message: '' }, // 'idle' | 'loading' | 'ready' | 'error'
};

function emptyFilters() {
  return {
    privacy: [...EMPTY_FILTERS.privacy],
    preference: [...EMPTY_FILTERS.preference],
    clicked: EMPTY_FILTERS.clicked,
    search: EMPTY_FILTERS.search,
  };
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Escape every value that comes from a workbook, a filename or user input. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtInt(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-AU');
}

function fmtPct(n) {
  return `${(Number(n) || 0).toFixed(1)}%`;
}

function truncate(text, limit) {
  const str = String(text ?? '');
  if (str.length <= limit) return str;
  return `${str.slice(0, limit).trimEnd()}…`;
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/** Number of selected responses whose cell for a question is blank. */
function missingForQuestion(rows, questionId) {
  return rows.filter((row) => row.missingFlags[questionId]).length;
}

/** How many of the five survey-question columns this workbook actually contains. */
function detectedQuestions(dataset) {
  return dataset.questionOrder.filter((id) => dataset.questions[id].detected).length;
}

/* ------------------------------------------------------------------ *
 * Shell: build the once-only control panels
 * ------------------------------------------------------------------ */

function initShell() {
  // Filters panel: heading + persistent controls + a re-rendered status line.
  $('#filters').innerHTML = `
    <h2 id="filters-heading">Filter responses</h2>
    <p class="section-lede">
      Filters select <strong>respondents</strong>, not individual bars. Everything on the page —
      every chart, percentage, quotation and table row — is recalculated from the responses that
      remain. Privacy and AI-preference filters, a clicked chart category and the search box all
      combine.
    </p>
    <div id="filter-controls"></div>
    <div id="filter-status"></div>`;

  // Themes panel: a re-rendered body, followed by the once-built rule editor.
  $('#themes').innerHTML = `<div id="themes-body"></div><div id="rules-editor-slot"></div>`;

  buildFilterControls();
  buildRulesEditor();
}

function buildFilterControls() {
  const checkboxGroup = (group, legend, categories) => `
    <fieldset class="filter-group">
      <legend>${escapeHtml(legend)}</legend>
      <div class="checks">
        ${categories
          .map(
            (cat) => `
          <label class="check">
            <input type="checkbox" data-filter-group="${escapeHtml(group)}" data-key="${escapeHtml(
              cat.key,
            )}" />
            <span>${escapeHtml(cat.label)}</span>
          </label>`,
          )
          .join('')}
      </div>
    </fieldset>`;

  $('#filter-controls').innerHTML = `
    <div class="filter-grid">
      ${checkboxGroup('privacy', 'Privacy concern (Question 3)', PRIVACY_CATEGORIES)}
      ${checkboxGroup('preference', 'AI preference (Question 4)', AI_PREFERENCE_CATEGORIES)}
    </div>
    <div class="search-row">
      <label for="search-input">Search the five answers and the response ID</label>
      <input id="search-input" type="search" placeholder="e.g. translation, privacy, local" autocomplete="off" />
      <p class="small muted" style="margin:6px 0 0">
        Search ignores capital letters and updates the entire dashboard, not just the table.
      </p>
    </div>
    <div class="filter-actions controls-row">
      <button class="btn" type="button" data-action="reset-filters">Reset filters</button>
      <span class="small muted" id="filter-count-hint"></span>
    </div>`;
}

/** Keep the once-built controls mirroring state (called after every render). */
function syncFilterControls() {
  const enabled = Boolean(state.dataset);

  document.querySelectorAll('#filter-controls [data-filter-group]').forEach((input) => {
    const group = input.dataset.filterGroup;
    input.checked = Boolean(state.filters[group] && state.filters[group].includes(input.dataset.key));
    input.disabled = !enabled;
  });

  const search = $('#search-input');
  if (search) {
    // Only write when it actually differs: assigning the same string can move the caret.
    if (search.value !== state.filters.search) search.value = state.filters.search;
    search.disabled = !enabled;
  }

  const reset = document.querySelector('#filter-controls [data-action="reset-filters"]');
  if (reset) reset.disabled = !enabled;
}

/* ------------------------------------------------------------------ *
 * Rule editor (built once; rebuilt only on Restore defaults)
 * ------------------------------------------------------------------ */

function ruleFieldTextarea(theme, group) {
  const id = `rule-${group}-${theme.key}`;
  return `
    <div class="rule-field">
      <label for="${id}">${escapeHtml(theme.label)}</label>
      <textarea id="${id}" data-rule-group="${escapeHtml(group)}" data-rule-key="${escapeHtml(
        theme.key,
      )}" spellcheck="false">${escapeHtml(theme.keywords.join(', '))}</textarea>
      <span class="rule-help">Comma-separated words or phrases.</span>
    </div>`;
}

function fixedRulesBlock(title, rules, categories) {
  const labelFor = (key) => (categories.find((c) => c.key === key) || { label: key }).label;
  return `
    <h4>${escapeHtml(title)}</h4>
    <p class="small muted">
      These rules are <strong>fixed</strong> and cannot be edited here. They are checked in the
      order shown and stop at the <strong>first</strong> phrase that matches, so the order is part
      of the meaning.
    </p>
    ${rules
      .map(
        (rule, i) => `
      <div class="fixed-rule">
        <span class="idx">${i + 1}</span><strong>${escapeHtml(labelFor(rule.key))}</strong> — ${escapeHtml(
          rule.note,
        )}
        <span class="phrases">Phrases: ${escapeHtml(rule.phrases.join(', '))}</span>
      </div>`,
      )
      .join('')}`;
}

function buildRulesEditor() {
  const slot = $('#rules-editor-slot');
  const wasOpen = slot.querySelector('details.rules-editor')?.open ?? false;

  slot.innerHTML = `
    <details class="rules-editor" ${wasOpen ? 'open' : ''}>
      <summary>Inspect &amp; adjust classification rules</summary>

      <p class="section-lede small">
        Each box holds one theme's keyword list. Add a word or phrase by typing it and placing a
        comma before or after it; remove one by deleting it (and its comma). Entries are separated
        by commas and are matched as <strong>partial, case-insensitive</strong> strings.
        <strong>Apply theme rules</strong> re-reads every box and recalculates the charts, the
        worked example and any active theme filter — it never changes the original answers or the
        Excel workbook. <strong>Restore defaults</strong> puts every box back to the starting
        keyword lists. Edits are <strong>not saved</strong> if you reload the page.
      </p>

      <h4>Everyday reliance — Question 2 themes</h4>
      <div class="rules-grid">${state.themeRules.q2.map((t) => ruleFieldTextarea(t, 'q2')).join('')}</div>

      <h4>Business considerations — Question 5 themes</h4>
      <div class="rules-grid">${state.themeRules.q5.map((t) => ruleFieldTextarea(t, 'q5')).join('')}</div>

      <div class="controls-row" style="margin-top:16px">
        <button class="btn btn-primary" type="button" data-action="apply-rules">Apply theme rules</button>
        <button class="btn" type="button" data-action="restore-rules">Restore defaults</button>
      </div>

      <div class="fixed-rules">
        ${fixedRulesBlock('Fixed grouping rules — Privacy concern (Question 3)', PRIVACY_RULES, PRIVACY_CATEGORIES)}
        ${fixedRulesBlock('Fixed grouping rules — AI preference (Question 4)', PREFERENCE_RULES, AI_PREFERENCE_CATEGORIES)}
      </div>
    </details>`;
}

/* ------------------------------------------------------------------ *
 * render() — the single place that rebuilds the view
 * ------------------------------------------------------------------ */

function render() {
  renderBadge();
  renderWorkbookPanel();

  if (!state.dataset) {
    for (const id of ['#about-data', '#overview', '#charts', '#definitions', '#responses']) {
      $(id).innerHTML = '';
    }
    setThemesBody('');
    $('#filter-status').innerHTML = '';
    syncFilterControls();
    return;
  }

  const dataset = state.dataset;
  // THE single source of truth for this render.
  const { rows, rules } = selectRows(dataset, state.filters, state.themeRules);

  renderAbout(dataset);
  renderFilterStatus(rows);
  renderOverview(rows);
  renderCharts(rows, rules);
  setThemesBody(renderThemesBody(rows, rules));
  renderDefinitions(rows);
  renderResponses(rows);

  syncFilterControls();
}

function setThemesBody(html) {
  const body = $('#themes-body');
  if (body) body.innerHTML = html;
}

/* ------------------------------------------------------------------ *
 * Hero badge
 * ------------------------------------------------------------------ */

function renderBadge() {
  const slot = $('#hero-badge-slot');
  if (!slot) return;
  if (state.dataset && state.dataset.synthetic) {
    slot.innerHTML = `<span class="badge"><span class="badge-dot"></span>Synthetic or fictional demonstration data — not collected from real participants</span>`;
  } else {
    slot.innerHTML = '';
  }
}

/* ------------------------------------------------------------------ *
 * Workbook panel (upload, demo, worksheet switch, file facts)
 * ------------------------------------------------------------------ */

function renderWorkbookPanel() {
  const el = $('#workbook');
  const ds = state.dataset;
  const sheets = ds ? ds.sheetNames : [];

  let statusNotice = '';
  if (state.status.kind === 'loading') {
    statusNotice = `<div class="notice notice-ok">${escapeHtml(state.status.message)}</div>`;
  } else if (state.status.kind === 'error') {
    statusNotice = `<div class="notice notice-error"><strong>Could not load that workbook.</strong> ${escapeHtml(
      state.status.message,
    )}</div>`;
  }

  let missingNotice = '';
  if (ds && ds.missingQuestions.length) {
    const names = ds.missingQuestions
      .map((id) => (ds.questions[id] ? ds.questions[id].subject : id))
      .map((subject) => `<li>${escapeHtml(subject)}</li>`)
      .join('');
    missingNotice = `
      <div class="notice notice-warn">
        <strong>Some required question columns were not found in this workbook.</strong>
        The dashboard detected ${fmtInt(
          5 - ds.missingQuestions.length,
        )} of 5 survey questions. It could not find columns for:
        <ul class="tight">${names}</ul>
        Charts for those questions will be empty until a workbook with the expected answer
        columns is loaded.
      </div>`;
  }

  let sheetSelect = '';
  if (sheets.length > 1) {
    sheetSelect = `
      <div class="search-row" style="max-width:420px">
        <label for="sheet-select">Worksheet</label>
        <select id="sheet-select">
          ${sheets
            .map(
              (name) =>
                `<option value="${escapeHtml(name)}" ${
                  ds && ds.sheetName === name ? 'selected' : ''
                }>${escapeHtml(name)}</option>`,
            )
            .join('')}
        </select>
      </div>`;
  }

  const facts = ds
    ? `
      <p class="file-meta">
        Loaded <strong>${escapeHtml(ds.filename)}</strong> · worksheet
        <strong>${escapeHtml(ds.sheetName)}</strong> · header on Excel row
        <strong>${fmtInt(ds.headerExcelRow)}</strong>
      </p>
      <div class="stats" style="margin-top:14px">
        <div class="stat">
          <div class="stat-value">${fmtInt(ds.totalResponses)}</div>
          <div class="stat-label">responses (one spreadsheet row each)</div>
        </div>
        <div class="stat">
          <div class="stat-value">${fmtInt(ds.totalResponses * detectedQuestions(ds))}</div>
          <div class="stat-label">question cells (up to ${fmtInt(detectedQuestions(ds))} answers per response)</div>
        </div>
        <div class="stat">
          <div class="stat-value">${fmtInt(missingSummary(ds.rows, ds).total)}</div>
          <div class="stat-label">missing answers across the detected questions</div>
        </div>
        <div class="stat">
          <div class="stat-value">${fmtInt(ds.skippedBlankRows)}</div>
          <div class="stat-label">blank spreadsheet rows skipped</div>
        </div>
      </div>`
    : `<p class="file-meta">No workbook is loaded yet. Choose a file or load the demonstration workbook.</p>`;

  el.innerHTML = `
    <h2 id="workbook-heading">Workbook</h2>
    <p class="section-lede">
      The dashboard reads the file in your browser. Nothing is uploaded and no copy is kept.
    </p>
    ${statusNotice}
    ${missingNotice}
    <div class="dropzone" data-dropzone>
      <p style="margin:0 0 10px"><strong>Drag a workbook here</strong> or choose a file — .xlsx, .xls or .csv</p>
      <div class="controls-row" style="justify-content:center">
        <input id="file-input" class="file-input" type="file" accept=".xlsx,.xls,.csv"
          aria-label="Choose a workbook file" />
        <button class="btn btn-primary" type="button" data-action="load-demo">Load demo</button>
      </div>
    </div>
    ${sheetSelect}
    ${facts}`;
}

/* ------------------------------------------------------------------ *
 * "What data am I looking at?"
 * ------------------------------------------------------------------ */

function renderAbout(ds) {
  const excluded = ds.excludedColumns
    .map(
      (col) => `
      <li>
        Column <code>${escapeHtml(col.letter)}</code> —
        ${escapeHtml(truncate(col.header || '(empty header)', 70))}
        <span class="muted">(${escapeHtml(col.reason)})</span>
      </li>`,
    )
    .join('');

  const totalPoints = ds.excludedColumns.find(
    (col) => String(col.header).trim().toLowerCase() === 'total points',
  );

  $('#about-data').innerHTML = `
    <h2 id="about-heading">What data am I looking at?</h2>
    <p class="plain">
      You are looking at <strong>${escapeHtml(ds.filename)}</strong>, worksheet
      <strong>${escapeHtml(ds.sheetName)}</strong>.
    </p>
    <ul class="tight">
      <li>Each spreadsheet <strong>row</strong> is one <strong>respondent</strong>.</li>
      <li>Each survey-question <strong>column</strong> holds that respondent's answer to one question.</li>
      <li>
        The dashboard only <strong>adds</strong> things on top of the raw cells: counts, percentages,
        shorter column headings, category labels and themes. It does <strong>not</strong> invent,
        rewrite or correct any original answer.
      </li>
      <li>
        A <strong>response</strong> is one person's row. An <strong>answer</strong> is a single
        question cell. One response can therefore supply up to five answers — which is why the
        response count and the answer count are not the same number.
      </li>
      <li>
        Administrative and scoring fields are excluded from every chart and table. The
        ${fmtInt(ds.excludedColumns.length)} excluded columns in this workbook are:
        <ul class="tight">${excluded}</ul>
      </li>
      ${
        totalPoints
          ? `<li>
              The blank <strong>Total points</strong> column (column <code>${escapeHtml(
                totalPoints.letter,
              )}</code>) is <strong>excluded</strong> rather than counted as zero, so a blank score
              never drags an average down.
            </li>`
          : ''
      }
      <li>
        You can read a chart's question at the top of its card, click any bar to select the
        respondents behind it, and then inspect their matching original answers in the response
        table below.
      </li>
    </ul>`;
}

/* ------------------------------------------------------------------ *
 * Active-filter status line
 * ------------------------------------------------------------------ */

function renderFilterStatus(rows) {
  const el = $('#filter-status');
  const total = state.dataset.totalResponses;
  const active = hasActiveFilters(state.filters);

  let body;
  if (active) {
    const parts = describeFilters(state.filters, state.themeRules);
    body = `
      <p style="margin:0">
        <strong>${fmtInt(rows.length)}</strong> of ${fmtInt(total)}
        ${plural(total, 'response', 'responses')} remain after filtering.
      </p>
      <p class="small muted" style="margin:6px 0 0">Active filters: ${escapeHtml(parts.join(' · '))}</p>`;
    el.className = 'notice notice-ok';
  } else {
    body = `<p style="margin:0">No filters are active, so all ${fmtInt(total)}
      ${plural(total, 'response', 'responses')} are included.</p>`;
    el.className = 'notice';
  }

  if (rows.length === 0) {
    body += `<p class="small" style="margin:8px 0 0">
      No responses match the current filters. Clear a filter or reset to see the charts again.</p>`;
  }

  el.innerHTML = body;

  const hint = $('#filter-count-hint');
  if (hint) hint.textContent = `${fmtInt(rows.length)} of ${fmtInt(total)} responses selected`;
}

/* ------------------------------------------------------------------ *
 * Overview: totals + three evidence-linked observations
 * ------------------------------------------------------------------ */

function renderOverview(rows) {
  const ds = state.dataset;
  const missing = missingSummary(rows, ds);
  const high = highConcernSummary(rows);
  const observations = buildObservations({ rows, themeRules: state.themeRules });
  const detected = ds.questionOrder.filter((id) => ds.questions[id].detected).length;

  const obsHtml = observations
    .map(
      (obs) => `
      <li class="observation">
        ${escapeHtml(obs.text)}
        <a href="${escapeHtml(obs.anchor)}">View ${escapeHtml(obs.chartLabel)} →</a>
      </li>`,
    )
    .join('');

  $('#overview').innerHTML = `
    <h2 id="overview-heading">Overview</h2>
    <p class="section-lede">
      A snapshot of the current view. The three observations below each point to the chart that
      supports them; they describe what the selected responses show, not why.
    </p>
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${fmtInt(rows.length)}</div>
        <div class="stat-label">responses currently selected</div>
      </div>
      <div class="stat">
        <div class="stat-value">${fmtInt(ds.totalResponses)}</div>
        <div class="stat-label">responses in the workbook</div>
      </div>
      <div class="stat">
        <div class="stat-value">${fmtInt(detected)}<span class="muted" style="font-size:16px">/5</span></div>
        <div class="stat-label">survey questions detected</div>
      </div>
      <div class="stat">
        <div class="stat-value">${fmtInt(missing.total)}</div>
        <div class="stat-label">missing answers in the selection</div>
      </div>
      <div class="stat">
        <div class="stat-value">${fmtPct(high.percentage)}</div>
        <div class="stat-label">moderately or very concerned (${fmtInt(high.count)} of ${fmtInt(high.total)})</div>
      </div>
    </div>
    <h3 style="margin-top:24px">What stands out</h3>
    ${rows.length === 0 ? `<p class="plain muted">Nothing is selected, so there is nothing to observe yet.</p>` : `<ul class="observations">${obsHtml}</ul>`}
    <p class="small muted" style="margin-top:14px">
      These are descriptions of the displayed counts only. They are kept separate from any possible
      explanation, and no cause is claimed.
    </p>`;
}

/* ------------------------------------------------------------------ *
 * Charts
 * ------------------------------------------------------------------ */

function barWidth(count, maxCount) {
  if (!maxCount || count <= 0) return 0;
  return Math.max((count / maxCount) * 100, 1.5);
}

function barHtml(bar, questionId, maxCount) {
  const active =
    state.filters.clicked &&
    state.filters.clicked.question === questionId &&
    state.filters.clicked.key === bar.key;
  const zero = bar.count <= 0;
  const width = barWidth(bar.count, maxCount);
  return `
    <button class="bar grp-${escapeHtml(bar.group || 'theme')} ${active ? 'is-active' : ''}"
      type="button" data-action="click-category"
      data-question="${escapeHtml(questionId)}" data-key="${escapeHtml(bar.key)}"
      aria-pressed="${active ? 'true' : 'false'}"
      title="Click to show only the responses behind this bar">
      <span class="bar-head">
        <span class="bar-label">${escapeHtml(bar.label)}</span>
        <span class="bar-value">${fmtInt(bar.count)} · ${fmtPct(bar.percentage)}</span>
      </span>
      <span class="bar-track">
        <span class="bar-fill ${zero ? 'is-zero' : ''}" style="width:${width.toFixed(2)}%"></span>
      </span>
    </button>`;
}

/** Bars with a labelled separator whenever the category group changes. */
function barsHtml(bars, questionId, groupLabels) {
  const maxCount = bars.reduce((max, bar) => Math.max(max, bar.count), 0);
  let lastGroup = null;
  let out = '';
  for (const bar of bars) {
    const group = bar.group || 'theme';
    if (group !== lastGroup && groupLabels[group]) {
      out += `<div class="bar-group-sep">${escapeHtml(groupLabels[group])}</div>`;
      lastGroup = group;
    }
    out += barHtml(bar, questionId, maxCount);
  }
  return out;
}

function chartInterpretation(bars, denominator, note) {
  if (denominator === 0) {
    return 'No responses are currently selected, so there is nothing to read here.';
  }
  const max = bars.reduce((best, bar) => (bar.count > best.count ? bar : best), bars[0]);
  if (!max || max.count === 0) {
    return 'Every selected response falls into a separated group (unsure, unmatched or missing), so no category bar has a count yet.';
  }
  return `The largest bar is ${escapeHtml(max.label)} at ${fmtInt(max.count)} of ${fmtInt(
    denominator,
  )} selected ${plural(denominator, 'response', 'responses')} (${fmtPct(max.percentage)}). ${note}`;
}

/**
 * Build one chart card. Every value below is passed in from the current render,
 * so nothing is hardcoded to the demonstration workbook.
 */
function chartCard({ anchorId, questionId, bars, groupLabels, methodHtml, note, missing, extraHtml }) {
  const ds = state.dataset;
  const question = ds.questions[questionId];
  const number = ds.questionOrder.indexOf(questionId) + 1;
  const denominator = bars.length ? bars[0].denominator : 0;
  const answered = Math.max(denominator - missing, 0);
  const activeHere =
    state.filters.clicked && state.filters.clicked.question === questionId;

  return `
    <article class="chart-card" id="${escapeHtml(anchorId)}" aria-label="${escapeHtml(
      question.chartTitle,
    )}">
      <p class="eyebrow">Source · Survey Question ${number}</p>
      <h3>${escapeHtml(question.chartTitle)}</h3>
      ${
        question.header
          ? `<p class="chart-question">${escapeHtml(question.header)}</p>`
          : `<p class="chart-question muted">This question column was not detected in the current workbook.</p>`
      }
      <p class="chart-source">
        ${escapeHtml(ds.filename)} · worksheet ${escapeHtml(ds.sheetName)} · Excel column
        ${question.letter ? `<code>${escapeHtml(question.letter)}</code>` : '(not found)'}
      </p>
      <p class="chart-method">${methodHtml}</p>
      <div class="bars">
        ${barsHtml(bars, questionId, groupLabels)}
      </div>
      <p class="bar-note">
        Bars are scaled to the largest count so small differences stay visible; the number and the
        percentage beside each bar are exact. Percentages are of the
        <strong>${fmtInt(denominator)}</strong> selected
        ${plural(denominator, 'response', 'responses')} (the denominator).
      </p>
      <p class="bar-note">
        ${fmtInt(answered)} answered · ${fmtInt(missing)} missing for this question in the current
        selection.
      </p>
      <p class="chart-foot">
        <strong>Clicking a bar</strong> keeps only the respondents behind it and rebuilds the whole
        page, then jumps to the response table. Click the same bar again, or use
        <em>Reset filters</em>, to clear the selection.
        ${
          activeHere
            ? `<span class="interp">A category from this chart is active: the page is currently filtered to it.</span>`
            : ''
        }
        <span class="interp"><strong>Reading it:</strong> ${chartInterpretation(
          bars,
          denominator,
          note,
        )}</span>
      </p>
      ${extraHtml || ''}
    </article>`;
}

/** Build the four chart cards from the single selectRows() result. */
function renderCharts(rows, rules) {
  const ds = state.dataset;

  const privacyBars = privacyBreakdown(rows);
  const preferenceBars = preferenceBreakdown(rows);
  const relianceBars = themeBreakdown(rows, 'q2', rules.q2);
  const businessBars = themeBreakdown(rows, 'q5', rules.q5);

  const privacyMethod = `Each answer to Question 3 is grouped by the <strong>fixed</strong>, first-match privacy rules (documented in “How answers become themes”). The four scale categories run low → high; unsure, other/unrecognised wording and missing answers are kept as separate bars rather than folded into the scale.`;

  const preferenceMethod = `Each answer to Question 4 is grouped by the <strong>fixed</strong>, first-match preference rules. All seven positions are kept distinct — mixed answers (“use both”), partial positions and unsure answers are never collapsed into a simple local-versus-foreign choice.`;

  const relianceMethod = `Each written answer to Question 2 is matched against the <strong>editable</strong> everyday-reliance keyword themes (see “How answers become themes”). An answer counts once per theme and can match several themes, so these percentages can add up to more than 100%. The <em>unmatched</em> and <em>missing</em> bars are separated at the end.`;

  const businessMethod = `Each written answer to Question 5 is matched against the <strong>editable</strong> business-consideration keyword themes. As above, one answer can match several themes, and the <em>unmatched</em> and <em>missing</em> bars are kept separate at the end.`;

  const themeGroupLabels = {
    theme: 'Themes (an answer can count in several)',
    unrecognised: 'Separate · answered but matched no keyword',
    missing: 'Separate · missing answer',
  };

  $('#charts').innerHTML = [
    chartCard({
      anchorId: 'privacy',
      questionId: 'q3',
      bars: privacyBars,
      groupLabels: {
        scale: 'Ordered scale · not concerned → very concerned',
        uncertain: 'Separate · uncertain',
        unrecognised: 'Separate · other / unrecognised wording',
        missing: 'Separate · missing answer',
      },
      methodHtml: privacyMethod,
      note: 'The scale runs from “not concerned” up to “very concerned”, and the separated bars are not part of that scale.',
      missing: missingForQuestion(rows, 'q3'),
    }),
    chartCard({
      anchorId: 'preference',
      questionId: 'q4',
      bars: preferenceBars,
      groupLabels: {
        position: 'Positions · all seven kept separate',
        uncertain: 'Separate · unsure',
        unrecognised: 'Separate · other / review',
        missing: 'Separate · missing answer',
      },
      methodHtml: preferenceMethod,
      note: 'These are expressed positions rather than correct answers.',
      missing: missingForQuestion(rows, 'q4'),
    }),
    chartCard({
      anchorId: 'reliance',
      questionId: 'q2',
      bars: relianceBars,
      groupLabels: themeGroupLabels,
      methodHtml: relianceMethod,
      note: 'Because an answer can belong to more than one theme, the theme percentages are not shares of a fixed whole and may exceed 100%.',
      missing: missingForQuestion(rows, 'q2'),
      extraHtml: themeExamplesHtml('q2', relianceBars, rows),
    }),
    chartCard({
      anchorId: 'business',
      questionId: 'q5',
      bars: businessBars,
      groupLabels: themeGroupLabels,
      methodHtml: businessMethod,
      note: 'A theme match is a possible signal, not proof of a respondent’s view, because keyword matching cannot read meaning, context or negation.',
      missing: missingForQuestion(rows, 'q5'),
      extraHtml: themeExamplesHtml('q5', businessBars, rows),
    }),
  ].join('');
}

/** Original answer examples behind each theme, for the two theme charts. */
function themeExamplesHtml(questionId, bars, rows) {
  const themeBars = bars.filter((bar) => bar.group === 'theme');
  if (themeBars.length === 0) return '';
  const blocks = themeBars
    .map((bar) => {
      const examples = rows
        .filter((row) => row.themes[questionId].includes(bar.key))
        .slice(0, 3);
      const list = examples.length
        ? `<ul class="tight small">${examples
            .map(
              (row) =>
                `<li>“${escapeHtml(truncate(row.answers[questionId], 180))}”
                  <span class="muted">— response ${escapeHtml(row.displayId)}, Excel row ${fmtInt(
                    row.excelRow,
                  )}</span></li>`,
            )
            .join('')}</ul>`
        : `<p class="small muted" style="margin:6px 0 0">No selected answer matched this theme.</p>`;
      return `
        <div class="fixed-rule">
          <strong>${escapeHtml(bar.label)}</strong>
          <span class="muted small">— ${fmtInt(bar.count)} matching
          ${plural(bar.count, 'answer', 'answers')}</span>
          ${list}
        </div>`;
    })
    .join('');

  return `
    <details class="rules-editor" style="margin-top:16px">
      <summary>Original answer examples behind each theme</summary>
      <p class="small muted">Up to three selected answers per theme, exactly as they appear in the
      workbook. These are examples of the matches, not a summary of the theme.</p>
      ${blocks}
    </details>`;
}

/* ------------------------------------------------------------------ *
 * "How answers become themes" + worked example
 * ------------------------------------------------------------------ */

function renderThemesBody(rows, rules) {
  const method = `
    <h2 id="themes-heading">How answers become themes</h2>
    <p class="section-lede">
      The theme bars are built by a simple, checkable rule. You do not need to open the rule editor
      to follow it — here is exactly what happens.
    </p>
    <ol class="method-list">
      <li>A <strong>theme</strong> is a topic label the dashboard adds. It is not a survey question
        and not an original spreadsheet column.</li>
      <li>Theme grouping applies only to the <strong>written answers to Question 2 and
        Question 5</strong>. Question 1 is shown as quotations instead, and Questions 3 and 4 use
        fixed category rules.</li>
      <li>Each theme has a list of <strong>keywords or phrases</strong>.</li>
      <li>An answer matches a theme if it contains <strong>at least one</strong> listed phrase,
        <strong>ignoring capital letters</strong>. The match is a <strong>substring</strong> match,
        so it happens inside longer words: <code>translat</code> matches “translation” and
        “translating”.</li>
      <li>An answer counts <strong>once per matching theme</strong>, even when several of that
        theme’s keywords are found in it.</li>
      <li>One answer can match <strong>several themes</strong>, so theme percentages may add up to
        <strong>more than 100%</strong>.</li>
      <li>A theme percentage is <strong>matching answers ÷ all selected responses</strong>.
        Responses whose cell is blank <strong>stay in the denominator</strong>.</li>
      <li><strong>Unmatched</strong> means the cell was answered but matched no keyword.
        <strong>Missing answer</strong> means the cell was blank.</li>
      <li>Keyword matching does not understand meaning, context or negation — “not secure” still
        matches “secure” — and a match is <strong>not proof</strong> of a respondent’s position.</li>
      <li>These are <strong>provisional groupings for discussion</strong>, not a definitive
        qualitative analysis.</li>
    </ol>
    <p class="tiny muted">${escapeHtml(QUESTION_1_NOTE)}</p>`;

  const example = workedExample(rows, rules);
  let exampleHtml;
  if (!example) {
    exampleHtml = `
      <h3 style="margin-top:26px">Worked example</h3>
      <div class="worked">
        <p style="margin:0">
          The current view has <strong>no suitable example</strong>: no selected answer to
          Question 2 or Question 5 matched a theme under the current rules. Clear a filter, widen
          the selection, or lower a keyword list and press <em>Apply theme rules</em> to see one.
        </p>
      </div>`;
  } else {
    const keywords = example.allKeywords.length
      ? example.allKeywords.map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join('')
      : '<span class="muted small">none</span>';
    const themes = example.themes
      .map((t) => `<span class="chip">${escapeHtml(t.label)}</span>`)
      .join('');
    const contribution = example.themes
      .map(
        (t) =>
          `<li>This answer adds <strong>1</strong> to the count for <strong>${escapeHtml(
            t.label,
          )}</strong> (matched on ${t.keywords.map((k) => `<code>${escapeHtml(k)}</code>`).join(', ')}).</li>`,
      )
      .join('');
    exampleHtml = `
      <h3 style="margin-top:26px">Worked example from the current data</h3>
      <div class="worked">
        <p class="small muted" style="margin:0">
          Question ${example.questionNumber} · response ${escapeHtml(example.row.displayId)} ·
          original Excel row ${fmtInt(example.row.excelRow)} ·
          ${fmtInt(example.totalCandidates)} matched answer${example.totalCandidates === 1 ? '' : 's'} in the current view
        </p>
        <p class="worked-quote">“${escapeHtml(example.row.answers[example.question])}”</p>
        <p style="margin:8px 0 2px"><strong>Matched keyword(s):</strong> ${keywords}</p>
        <p style="margin:8px 0 2px"><strong>Assigned theme(s):</strong> ${themes}</p>
        <p style="margin:10px 0 2px"><strong>How it contributes to the chart counts:</strong></p>
        <ul class="tight small">${contribution}</ul>
      </div>`;
  }

  return `${method}${exampleHtml}`;
}

/* ------------------------------------------------------------------ *
 * Question 1 — original definitions (quotations)
 * ------------------------------------------------------------------ */

function renderDefinitions(rows) {
  const ds = state.dataset;
  const q1 = ds.questions.q1;
  const { cards, distinct, answered } = definitionCards(rows);

  const cardsHtml = cards.length
    ? `<div class="quote-grid">${cards
        .map(
          (card) => `
        <figure class="quote-card">
          <blockquote class="quote-text">“${escapeHtml(card.text)}”</blockquote>
          <figcaption class="quote-meta">
            Response ${escapeHtml(card.displayId)} · original Excel row ${fmtInt(card.excelRow)}
          </figcaption>
        </figure>`,
        )
        .join('')}</div>`
    : `<p class="plain muted">No Question 1 answers are in the current selection, so there are no
       quotation cards to show.</p>`;

  $('#definitions').innerHTML = `
    <h2 id="definitions-heading">Original definitions of AI sovereignty</h2>
    <p class="plain">
      These cards hold <strong>original answers</strong> to Question 1, quoted exactly as written in
      the workbook. They are <strong>not</strong> official definitions written or endorsed by this
      website, and in the demonstration workbook they are <strong>fictional examples</strong>.
      Different interpretations, disagreements and uncertainty are all preserved; no answer is
      scored for correctness and none is marked as better than another.
    </p>
    ${
      q1.header
        ? `<p class="chart-question">${escapeHtml(q1.header)}</p>
           <p class="chart-source">
             ${escapeHtml(ds.filename)} · worksheet ${escapeHtml(ds.sheetName)} · Excel column
             <code>${escapeHtml(q1.letter)}</code> · header on Excel row ${fmtInt(ds.headerExcelRow)}
           </p>`
        : `<p class="chart-question muted">Question 1's column was not detected in this workbook.</p>`
    }
    <div class="notice">
      <strong>How the cards are chosen.</strong> There is one card per <em>distinct</em> answer, in
      worksheet order, labelled with the <em>first</em> response ID and original Excel row that
      gave it. Because of this, the number of cards does <strong>not</strong> show how common an
      interpretation is. Answers that repeat still appear, one row each, in the response table
      below, and blank answers produce no card at all. The cards change when filters change.
      <p class="small muted" style="margin:8px 0 0">
        ${fmtInt(distinct)} distinct ${plural(distinct, 'answer', 'answers')} from
        ${fmtInt(answered)} answered Question 1 ${plural(answered, 'cell', 'cells')} in the current
        selection.
      </p>
    </div>
    ${cardsHtml}`;
}

/* ------------------------------------------------------------------ *
 * Response table
 * ------------------------------------------------------------------ */

function answerCell(row, questionId) {
  if (row.missingFlags[questionId]) {
    return `<span class="missing-tag">Missing answer</span>`;
  }
  const text = row.answers[questionId] || '';
  const key = `${row.index}:${questionId}`;
  const expanded = state.expanded.has(key);
  // The preview limit is deliberately below the length of most written answers in
  // the demonstration workbook, so the ellipsis and the "Read full answer"
  // control are actually visible during the classroom walkthrough.
  const LIMIT = 90;
  if (text.length <= LIMIT) {
    return `<span class="answer-full">${escapeHtml(text)}</span>`;
  }
  const toggle = `<button class="read-full" type="button" data-action="toggle-answer"
      data-row="${row.index}" data-question="${escapeHtml(questionId)}"
      aria-expanded="${expanded ? 'true' : 'false'}">${
        expanded ? 'Show less' : 'Read full answer'
      }</button>`;
  const body = expanded
    ? `<span class="answer-full">${escapeHtml(text)}</span>`
    : `${escapeHtml(truncate(text, LIMIT))}`;
  return `${body}<br />${toggle}`;
}

function renderResponses(rows) {
  const ds = state.dataset;

  const guideRows = ds.questionOrder
    .map((id) => {
      const q = ds.questions[id];
      return `
        <tr>
          <td>${escapeHtml(q.short)}</td>
          <td>${escapeHtml(q.header || '(not found in this workbook)')}</td>
          <td>${q.letter ? `<code>${escapeHtml(q.letter)}</code>` : '—'}</td>
        </tr>`;
    })
    .join('');

  const headerCells = ds.questionOrder
    .map((id) => `<th scope="col">${escapeHtml(ds.questions[id].short)}</th>`)
    .join('');

  const bodyRows = rows
    .map(
      (row) => `
      <tr>
        <td class="col-id">${escapeHtml(row.displayId)}</td>
        <td class="col-row">${fmtInt(row.excelRow)}</td>
        ${ds.questionOrder
          .map((id) => `<td class="answer-cell">${answerCell(row, id)}</td>`)
          .join('')}
      </tr>`,
    )
    .join('');

  const tableHtml = rows.length
    ? `<div class="table-scroll">
        <table class="response-table">
          <caption class="small muted" style="text-align:left;padding:8px 0">
            One row per selected response. All five original answers stay together.
          </caption>
          <thead>
            <tr>
              <th scope="col">Response ID</th>
              <th scope="col">Excel row</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`
    : `<p class="plain muted">No responses match the current filters, so the table is empty.
       Clear a filter or reset to see the responses again.</p>`;

  $('#responses').innerHTML = `
    <h2 id="responses-heading">Responses</h2>
    <p class="plain">
      Each row is one selected response, with its five original answers kept together. Search covers
      the five answers and the response ID, ignores capital letters, and updates the whole dashboard
      — not just this table. Names, email addresses, timestamps, points and feedback are never shown
      because they are excluded before the dashboard is built.
      ${
        ds.idSource === 'generated'
          ? `This workbook has no ID column, so the dashboard assigned IDs (<code>#1</code>,
             <code>#2</code>, …) in worksheet order to keep each response traceable.`
          : `The response ID comes from the workbook's <code>${escapeHtml(
              ds.idColumn.letter,
            )}</code> column (“${escapeHtml(ds.idColumn.header)}”).`
      }
    </p>
    <p class="small muted">
      A trailing “…” means the preview was shortened. <em>Read full answer</em> reveals the complete
      answer. <span class="missing-tag">Missing answer</span> means that cell was blank. Horizontal
      scrolling stays inside the table.
    </p>

    <h4>Question to column guide</h4>
    <table class="guide-table">
      <thead>
        <tr><th scope="col">Short heading used here</th><th scope="col">Full question (from the
          workbook)</th><th scope="col">Column</th></tr>
      </thead>
      <tbody>${guideRows}</tbody>
    </table>

    ${tableHtml}`;
}

/* ------------------------------------------------------------------ *
 * Data loading
 * ------------------------------------------------------------------ */

function showError(message) {
  state.status = { kind: 'error', message };
  render();
}

function applyWorkbook({ workbook, sheetNames, filename, sheetName }) {
  const sheet = readSheet(workbook, sheetName);
  if (!sheet.usable) {
    throw new Error(
      `The worksheet “${sheetName}” does not contain a readable table with a header row.`,
    );
  }
  state.workbook = workbook;
  state.sheetNames = sheetNames;
  state.filename = filename;
  state.dataset = buildDataset(sheet, { filename, sheetNames });
  state.filters = emptyFilters();
  state.expanded.clear();
  state.status = { kind: 'ready', message: '' };
  render();
}

function loadFromArrayBuffer(arrayBuffer, filename) {
  try {
    const { workbook, sheetNames } = readWorkbookFile(arrayBuffer);
    applyWorkbook({ workbook, sheetNames, filename, sheetName: sheetNames[0] });
  } catch (error) {
    showError(error.message || 'That workbook could not be read.');
  }
}

async function onFileChosen(file) {
  if (!file) return;
  const name = file.name || 'selected file';
  if (!/\.(xlsx|xls|csv)$/i.test(name)) {
    showError(
      `“${name}” is not a supported file type. Please choose an .xlsx, .xls or .csv workbook.`,
    );
    return;
  }
  try {
    const arrayBuffer = await file.arrayBuffer();
    loadFromArrayBuffer(arrayBuffer, name);
  } catch (error) {
    showError(error.message || 'That file could not be read.');
  }
}

async function loadDemo() {
  state.status = {
    kind: 'loading',
    message: `Loading the bundled demonstration workbook (${DEMO_FILENAME})…`,
  };
  render();
  try {
    const response = await fetch(`./${DEMO_FILENAME}`);
    if (!response.ok) {
      throw new Error(`the file was not found (HTTP ${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    loadFromArrayBuffer(arrayBuffer, DEMO_FILENAME);
  } catch (error) {
    showError(
      `The bundled demonstration workbook could not be loaded: ${error.message}. ` +
        `You can still drag a workbook onto the drop zone or choose a file to continue.`,
    );
  }
}

function onSheetChange(sheetName) {
  if (!state.workbook || !sheetName) return;
  try {
    const sheet = readSheet(state.workbook, sheetName);
    state.dataset = buildDataset(sheet, {
      filename: state.filename,
      sheetNames: state.sheetNames,
    });
    // Keep nothing stale from the previous worksheet.
    state.filters.clicked = null;
    state.expanded.clear();
    state.status = { kind: 'ready', message: '' };
    render();
  } catch (error) {
    showError(error.message || 'That worksheet could not be read.');
  }
}

/* ------------------------------------------------------------------ *
 * Filters and rule actions
 * ------------------------------------------------------------------ */

function resetFilters() {
  state.filters = emptyFilters();
  state.expanded.clear();
  render();
}

function toggleCategory(question, key) {
  const current = state.filters.clicked;
  if (current && current.question === question && current.key === key) {
    state.filters.clicked = null;
  } else {
    state.filters.clicked = { question, key };
  }
  render();
  const target = document.getElementById('responses');
  if (target) {
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  }
}

function applyRules() {
  const next = cloneThemeRules(state.themeRules);
  document.querySelectorAll('#rules-editor-slot [data-rule-group]').forEach((textarea) => {
    const group = textarea.dataset.ruleGroup;
    const key = textarea.dataset.ruleKey;
    const theme = next[group] && next[group].find((t) => t.key === key);
    if (theme) theme.keywords = parseKeywordList(textarea.value);
  });
  state.themeRules = next;
  render();
}

function restoreRules() {
  state.themeRules = cloneThemeRules();
  buildRulesEditor();
  render();
}

/* ------------------------------------------------------------------ *
 * Global event wiring (delegated, so re-renders never lose listeners)
 * ------------------------------------------------------------------ */

function wireEvents() {
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'load-demo') loadDemo();
    else if (action === 'reset-filters') resetFilters();
    else if (action === 'click-category') toggleCategory(el.dataset.question, el.dataset.key);
    else if (action === 'apply-rules') applyRules();
    else if (action === 'restore-rules') restoreRules();
    else if (action === 'toggle-answer') {
      const key = `${el.dataset.row}:${el.dataset.question}`;
      if (state.expanded.has(key)) state.expanded.delete(key);
      else state.expanded.add(key);
      render();
    }
  });

  document.addEventListener('change', (event) => {
    const el = event.target;
    if (el.matches && el.matches('[data-filter-group]')) {
      const group = el.dataset.filterGroup;
      const list = state.filters[group];
      const index = list.indexOf(el.dataset.key);
      if (el.checked && index === -1) list.push(el.dataset.key);
      if (!el.checked && index !== -1) list.splice(index, 1);
      render();
    } else if (el.id === 'sheet-select') {
      onSheetChange(el.value);
    } else if (el.id === 'file-input') {
      onFileChosen(el.files && el.files[0]);
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'search-input') {
      state.filters.search = event.target.value;
      render();
    }
  });

  // Drag-and-drop upload.
  const inDropzone = (event) => event.target.closest && event.target.closest('[data-dropzone]');
  document.addEventListener('dragover', (event) => {
    if (!inDropzone(event)) return;
    event.preventDefault();
    inDropzone(event).classList.add('is-over');
  });
  document.addEventListener('dragleave', (event) => {
    if (!inDropzone(event)) return;
    inDropzone(event).classList.remove('is-over');
  });
  document.addEventListener('drop', (event) => {
    const zone = inDropzone(event);
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('is-over');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) onFileChosen(file);
  });

  // Back to top: available while scrolling, keyboard operable, reduced-motion aware.
  const backToTop = document.getElementById('back-to-top');
  const onScroll = () => {
    backToTop.hidden = window.scrollY < 480;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  backToTop.addEventListener('click', () => {
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    window.scrollTo({ top: 0, behavior });
    const heading = document.getElementById('hero-heading');
    if (heading) heading.focus({ preventScroll: true });
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function init() {
  initShell();
  wireEvents();
  render(); // draws the empty/loading shell immediately
  loadDemo(); // then loads the bundled demonstration workbook
}

init();
