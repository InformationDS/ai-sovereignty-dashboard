/**
 * Classification rules.
 *
 * There are two distinct kinds of rule in this dashboard and they must never be
 * confused with each other:
 *
 *  1. FIXED grouping rules for Q3 (privacy concern) and Q4 (AI preference).
 *     These are ordered and first-match: the first rule whose phrase appears in
 *     the answer wins, so their order is part of their meaning. Users cannot edit
 *     them.
 *
 *  2. EDITABLE theme rules for Q2 (everyday reliance) and Q5 (business
 *     considerations). These are comma-separated keyword lists. An answer scores
 *     once per theme, and can match several themes at the same time.
 */

import { normalizeHeader } from './columns.js';

/* ------------------------------------------------------------------ *
 * Matching primitive
 * ------------------------------------------------------------------ */

/**
 * Case-insensitive substring test. Matching DOES occur inside longer words
 * (e.g. "translat" matches "translation" and "translating"), which is why
 * keywords like "reliab" are used deliberately.
 */
export function containsPhrase(haystack, phrase) {
  const needle = normalizeHeader(phrase);
  if (!needle) return false;
  return normalizeHeader(haystack).includes(needle);
}

export function parseKeywordList(text) {
  return String(text ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Q3 — Privacy concern (fixed, ordered, first match)
 * ------------------------------------------------------------------ */

export const PRIVACY_CATEGORIES = [
  { key: 'not-concerned', label: 'Not concerned', group: 'scale', order: 1 },
  { key: 'slightly', label: 'Slightly concerned', group: 'scale', order: 2 },
  { key: 'moderately', label: 'Moderately concerned', group: 'scale', order: 3 },
  { key: 'very', label: 'Very concerned', group: 'scale', order: 4 },
  { key: 'unsure', label: 'Unsure', group: 'uncertain', order: 5 },
  { key: 'other', label: 'Other / unrecognised wording', group: 'unrecognised', order: 6 },
  { key: 'missing', label: 'Missing answer', group: 'missing', order: 7 },
];

export const GRADED_PRIVACY_KEYS = ['not-concerned', 'slightly', 'moderately', 'very'];

/**
 * First-match rules. Order is intentional: the "unsure" test must run before the
 * generic worry tests, and the "do not worry" test must run before the plain
 * "worry" test, otherwise "I do not worry ..." would be counted as a concern.
 */
export const PRIVACY_RULES = [
  {
    key: 'unsure',
    note: 'Answer says the respondent cannot tell, does not know, or is unsure.',
    phrases: ['unsure', 'not sure', 'not certain', 'uncertain', 'do not know', "don't know", 'no idea', 'hard to say', 'difficult to say', 'cannot tell', "can't tell"],
  },
  {
    key: 'not-concerned',
    note: 'Answer explicitly denies worry or concern.',
    phrases: ['do not worry', "don't worry", 'not worry', 'never worry', 'no worry', 'not concerned', 'no concern', 'not at all concerned', 'do not care', "don't care", 'not bothered', 'barely worry', 'rarely worry', 'unconcerned'],
  },
  {
    key: 'very',
    note: 'Answer uses a strong degree word such as "a lot", "very" or "extremely".',
    phrases: ['a lot', 'very much', 'very concerned', 'very worried', 'extremely', 'highly', 'strongly', 'seriously', 'significantly', 'greatly', 'deeply', 'really worry', 'always worry', 'constantly', 'a great deal'],
  },
  {
    key: 'moderately',
    note: 'Answer uses a middle-degree word such as "moderately", "medium" or "somewhat".',
    phrases: ['moderate', 'moderately', 'medium', 'medium level', 'some concern', 'somewhat', 'fairly', 'reasonably concerned', 'occasionally', 'sometimes worry', 'average'],
  },
  {
    key: 'slightly',
    note: 'Answer uses a weak degree word such as "a little", "a bit" or "slightly".',
    phrases: ['a little', 'a bit', 'a tiny bit', 'slightly', 'mildly', 'minor', 'mild', 'small amount', 'low level', 'only slightly', 'a little bit'],
  },
];

export function classifyPrivacy(answer) {
  const text = String(answer ?? '').trim();
  if (!text) return { key: 'missing', matchedPhrase: null };
  for (const rule of PRIVACY_RULES) {
    const hit = rule.phrases.find((phrase) => containsPhrase(text, phrase));
    if (hit) return { key: rule.key, matchedPhrase: hit };
  }
  return { key: 'other', matchedPhrase: null };
}

/* ------------------------------------------------------------------ *
 * Q4 — Local versus foreign AI (fixed, ordered, first match)
 * ------------------------------------------------------------------ */

export const AI_PREFERENCE_CATEGORIES = [
  { key: 'rely-foreign', label: 'Rely on foreign AI', group: 'position', order: 1 },
  { key: 'some-local', label: 'Develop some local capability while retaining foreign access', group: 'position', order: 2 },
  { key: 'use-both', label: 'Use both local and foreign AI', group: 'position', order: 3 },
  { key: 'build-local', label: 'Build local AI', group: 'position', order: 4 },
  { key: 'unsure', label: 'Unsure', group: 'uncertain', order: 5 },
  { key: 'other', label: 'Other / review', group: 'unrecognised', order: 6 },
  { key: 'missing', label: 'Missing answer', group: 'missing', order: 7 },
];

export const POSITION_PREFERENCE_KEYS = ['rely-foreign', 'some-local', 'use-both', 'build-local'];

/**
 * First-match rules. "Unsure" runs first, then the combined positions, then the
 * two single-sided positions. Mixed and uncertain answers are never forced into
 * a simple local-versus-foreign choice.
 */
export const PREFERENCE_RULES = [
  {
    key: 'unsure',
    note: 'Answer states the respondent cannot decide, or that it depends.',
    phrases: ['unsure', 'not sure', 'not certain', 'uncertain', 'do not know', "don't know", 'no idea', 'hard to say', 'cannot decide', "can't decide", 'undecided', 'need more information', 'not enough information'],
  },
  {
    key: 'use-both',
    note: 'Answer asks for both at the same time, or for keeping foreign access alongside local capability for sensitive uses.',
    phrases: ['use both', 'both local and foreign', 'both: ', 'a mix of', 'mix of local', 'combination of', 'hybrid', 'blend', 'keep access to foreign', 'retain access to foreign', 'keep foreign', 'use local for sensitive', 'local capability for sensitive', 'local for sensitive', 'foreign for routine', 'foreign tools for routine'],
  },
  {
    key: 'some-local',
    note: 'Answer asks for partial or incremental local capability, without replacing foreign providers.',
    phrases: ['invest in local infrastructure', 'invest in local capability', 'build some', 'some local', 'some reliance', 'partial', 'gradually', 'incremental', 'not try to build everything', 'do not try to build everything', 'cannot build everything', 'not everything ourselves', 'develop local', 'support local', 'local capability', 'strengthen local', 'local alternatives'],
  },
  {
    key: 'build-local',
    note: 'Answer asks for building local AI as the main direction, including sovereignty or self-sufficiency arguments.',
    phrases: ['build our own', 'build its own', 'build local', 'build a local', 'our own local ai', 'own sovereign', 'self-sufficient', 'self sufficient', 'sovereign capability', 'local ai only', 'only local ai', 'prioritise local', 'prioritize local', 'local first', 'local ai is safer', 'national interest'],
  },
  {
    key: 'rely-foreign',
    note: 'Answer prefers depending on foreign providers, usually for cost, quality or speed.',
    phrases: ['rely on foreign', 'relying on foreign', 'depend on foreign', 'depend on overseas', 'stick with foreign', 'keep using foreign', 'foreign providers are better', 'foreign ai providers', 'better tools at lower cost', 'no need to build local', 'not worth building'],
  },
];

export function classifyPreference(answer) {
  const text = String(answer ?? '').trim();
  if (!text) return { key: 'missing', matchedPhrase: null };
  for (const rule of PREFERENCE_RULES) {
    const hit = rule.phrases.find((phrase) => containsPhrase(text, phrase));
    if (hit) return { key: rule.key, matchedPhrase: hit };
  }
  return { key: 'other', matchedPhrase: null };
}

/* ------------------------------------------------------------------ *
 * Q2 and Q5 — editable keyword themes
 * ------------------------------------------------------------------ */

export const DEFAULT_THEME_RULES = {
  q2: [
    {
      key: 'coding',
      label: 'Coding and technical tools',
      keywords: ['code', 'coding', 'python', 'sql', 'query', 'spreadsheet', 'formula', 'html', 'css', 'javascript', 'programming', 'debug', 'script', 'error message', 'error', 'software', 'technical', 'database concept', 'lookup', 'prototype'],
    },
    {
      key: 'course-material',
      label: 'Understanding course material',
      keywords: ['lecture', 'reading', 'concept', 'explain', 'explanation', 'textbook', 'tutorial', 'understand', 'course material', 'notes', 'summaris', 'summariz', 'vocabulary', 'framework', 'class'],
    },
    {
      key: 'writing',
      label: 'Writing and communication',
      keywords: ['essay', 'writing', 'write', 'grammar', 'email', 'report', 'message', 'argument', 'proofread', 'edit', 'draft', 'outline', 'slide', 'presentation', 'rephras', 'transcrib', 'recording', 'clarity', 'review'],
    },
    {
      key: 'translation',
      label: 'Translation and language',
      keywords: ['translat', 'language', 'mandarin', 'english', 'conversation', 'conversational', 'fluency'],
    },
    {
      key: 'study-prep',
      label: 'Study preparation',
      keywords: ['exam', 'revision', 'revise', 'study schedule', 'practice question', 'practise question', 'flashcard', 'prepare', 'preparing', 'interview', 'assessment', 'exercis', 'planning'],
    },
    {
      key: 'research-ideas',
      label: 'Research and ideas',
      keywords: ['research', 'source', 'brainstorm', 'idea', 'example', 'compar', 'finding'],
    },
    {
      key: 'limited-reliance',
      label: 'Limited reliance',
      keywords: ['barely use', 'do not use ai', 'never use ai', 'rarely use', 'hardly use', 'not much', 'no effect', 'would not affect', 'would not be affected', 'textbook and ask friends', 'mainly use the textbook', 'miss ai', 'return to ordinary search', 'without ai'],
    },
  ],
  q5: [
    {
      key: 'privacy',
      label: 'Privacy and data handling',
      keywords: ['privacy', 'personal data', 'personal details', 'customer record', 'customer information', 'customer data', 'client document', 'client requirement', 'sensitive', 'data handling', 'data location', 'retention', 'prompt', 'deleted information', 'model training', 'where sensitive data', 'where their information', 'subcontractor', 'upload', 'our information', 'company information'],
    },
    {
      key: 'security',
      label: 'Security and confidentiality',
      keywords: ['security', 'secure', 'confidential', 'leak', 'secret', 'trade secret', 'access control', 'permission', 'breach', 'cyber', 'safe', 'protect'],
    },
    {
      key: 'legal',
      label: 'Legal obligations',
      keywords: ['legal', 'law', 'regulation', 'court', 'jurisdiction', 'contract', 'obligation', 'compliance', 'audit', 'procurement', 'government client', 'terms'],
    },
    {
      key: 'supplier',
      label: 'Supplier dependence',
      keywords: ['depend', 'dependent', 'only one provider', 'single provider', 'sole provider', 'lock in', 'lock-in', 'supplier', 'vendor', 'backup option', 'out of business', 'change suppliers', 'switch supplier', 'move our data', 'external access', 'second option'],
    },
    {
      key: 'reliability',
      label: 'Reliability and continuity',
      keywords: ['reliab', 'outage', 'continuity', 'downtime', 'keep essential services running', 'working when', 'disrupt', 'blocked', 'goes wrong', 'accurate'],
    },
    {
      key: 'cost-performance',
      label: 'Cost and performance',
      keywords: ['cost', 'price', 'pricing', 'cheap', 'performance', 'better tools', 'quality', 'value for money', 'efficien'],
    },
    {
      key: 'local-context',
      label: 'Local context and jobs',
      keywords: ['australian job', 'local job', 'local context', 'australian context', 'australian regulation', 'australian support', 'local infrastructure', 'local hosting', 'local tool', 'local provider', 'local ai', 'australia', 'understand australian'],
    },
  ],
};

/** Deep clone so callers can edit without touching the defaults. */
export function cloneThemeRules(rules = DEFAULT_THEME_RULES) {
  return {
    q2: rules.q2.map((theme) => ({ ...theme, keywords: [...theme.keywords] })),
    q5: rules.q5.map((theme) => ({ ...theme, keywords: [...theme.keywords] })),
  };
}

/**
 * @returns {{matched: string[], keywordsByTheme: Record<string, string[]>}}
 * An answer counts once per matching theme, even when several keywords in that
 * theme match.
 */
export function matchThemes(answer, themes) {
  const text = String(answer ?? '').trim();
  if (!text) return { matched: [], keywordsByTheme: {} };
  const matched = [];
  const keywordsByTheme = {};
  for (const theme of themes) {
    const hits = theme.keywords.filter((keyword) => containsPhrase(text, keyword));
    if (hits.length > 0) {
      matched.push(theme.key);
      keywordsByTheme[theme.key] = hits;
    }
  }
  return { matched, keywordsByTheme };
}

export const QUESTION_1_NOTE =
  'Question 1 is open-ended and is never grouped into themes. Its answers are shown as quotations only.';

export function themeLabel(themes, key) {
  const theme = themes.find((t) => t.key === key);
  return theme ? theme.label : key;
}
