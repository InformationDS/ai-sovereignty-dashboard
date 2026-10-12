/**
 * Column identification.
 *
 * The dashboard must never trust column *positions*. Everything here works from
 * the header wording found in the loaded workbook, so a reordered, renamed or
 * differently-sheeted workbook still resolves the five survey questions.
 */

/** Uppercase letter for a zero-based column index. 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Lowercase, curly quotes flattened, whitespace collapsed. Used for all matching. */
export function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Headers that are administrative or scoring fields and must stay out of the analysis. */
export const ADMIN_EXACT = [
  'id',
  'respondent id',
  'response id',
  'user id',
  'name',
  'full name',
  'first name',
  'last name',
  'email',
  'e-mail',
  'email address',
  'start time',
  'completion time',
  'submit time',
  'submitted time',
  'submitted at',
  'last modified time',
  'last modified',
  'timestamp',
  'date',
  'total points',
  'points',
  'score',
  'total score',
  'quiz feedback',
  'feedback',
  'status',
  'ip',
  'ip address',
  'username',
  'user',
  'group',
  'duration',
];

const ADMIN_PATTERNS = [
  /\bid\b/,
  /e-?mail/,
  /\bname\b/,
  /\btime\b/,
  /\btimestamp\b/,
  /\bdate\b/,
  /\bpoints?\b/,
  /\bscore\b/,
  /\bfeedback\b/,
  /\bstatus\b/,
  /\bip address\b/,
  /\busername\b/,
  /\bduration\b/,
];

/** Column letters that carry an ID we keep for tracing responses. */
const ID_EXACT = ['id', 'respondent id', 'response id', 'user id', 'userid', 'username', 'respondent', 'response', 'no', 'no.'];

/**
 * Scoring duplicates of a question column look like "Points - <question>" or
 * "Feedback - <question>". They must be excluded before question detection so a
 * scoring column can never be mistaken for an answer column.
 */
export function isScoringDuplicate(header) {
  const h = normalizeHeader(header);
  return /^(points?|score|feedback|mark|marks|grade)\s*[-–—:·|]/.test(h);
}

export function isAdminField(header) {
  const h = normalizeHeader(header);
  if (!h) return true;
  if (isScoringDuplicate(h)) return true;
  if (ADMIN_EXACT.includes(h)) return true;
  return ADMIN_PATTERNS.some((re) => re.test(h));
}

export function isIdColumn(header) {
  return ID_EXACT.includes(normalizeHeader(header));
}

export function adminReason(header) {
  const h = normalizeHeader(header);
  if (isScoringDuplicate(h)) return 'Scoring duplicate of a question column (Points / Feedback)';
  if (ADMIN_EXACT.includes(h)) return 'Administrative or scoring field';
  if (ADMIN_PATTERNS.some((re) => re.test(h))) return 'Administrative or scoring field';
  return 'Not recognised as a survey question column';
}

/**
 * The five survey questions, described by their subject rather than by a fixed
 * header string. Each pattern group adds weight when any of its phrases appears
 * in the header.
 */
export const QUESTION_DEFINITIONS = [
  {
    id: 'q1',
    short: 'Q1 · AI sovereignty',
    subject: 'How would you define AI sovereignty?',
    chartTitle: 'What does AI sovereignty mean?',
    patterns: [
      { any: ['sovereignty'], weight: 4 },
      { any: ['define', 'definition', 'defined', 'meaning'], weight: 3 },
    ],
  },
  {
    id: 'q2',
    short: 'Q2 · Everyday reliance',
    subject: 'Which everyday student task would become most difficult if Australia banned foreign AI apps?',
    chartTitle: 'Everyday reliance on AI',
    patterns: [
      { any: ['foreign ai apps', 'foreign ai app'], weight: 3 },
      { any: ['banned', 'ban '], weight: 3 },
      { any: ['most difficult', 'difficult task', 'hardest'], weight: 3 },
      { any: ['daily student life', 'student life', 'daily life'], weight: 2 },
    ],
  },
  {
    id: 'q3',
    short: 'Q3 · Privacy concern',
    subject: 'How concerned are you about which country or company owns your personal data?',
    chartTitle: 'Privacy concerns',
    patterns: [
      { any: ['which country or company'], weight: 4 },
      { any: ['owns your personal data', 'own your personal data', 'ownership of personal data'], weight: 4 },
      { any: ['personal data'], weight: 2 },
      { any: ['worry', 'worried', 'concern', 'concerned'], weight: 2 },
    ],
  },
  {
    id: 'q4',
    short: 'Q4 · AI preference',
    subject: 'Should Australia rely on foreign AI providers or invest in local AI technology?',
    chartTitle: 'Local versus foreign AI',
    patterns: [
      { any: ['rely on foreign', 'relying on foreign'], weight: 4 },
      { any: ['foreign tech giants', 'foreign providers', 'foreign providers versus'], weight: 4 },
      { any: ['build its own', 'build our own', 'own local ai', 'local ai technology'], weight: 3 },
      { any: ['billions'], weight: 2 },
      { any: ['invest in local', 'local investment'], weight: 3 },
      { any: ['local or foreign'], weight: 1 },
    ],
  },
  {
    id: 'q5',
    short: 'Q5 · Business considerations',
    subject: 'Why might an Australian business care about using local or foreign AI?',
    chartTitle: 'Business considerations',
    patterns: [
      { any: ['boss', 'employer'], weight: 4 },
      { any: ['australian business', 'business in australia'], weight: 4 },
      { any: ['local ai or foreign ai', 'local or foreign ai'], weight: 2 },
      { any: ['rules, security, or secrets', 'secrets'], weight: 2 },
      { any: ['future boss'], weight: 2 },
    ],
  },
];

export const QUESTION_ORDER = QUESTION_DEFINITIONS.map((d) => d.id);

export function questionDefinition(id) {
  return QUESTION_DEFINITIONS.find((d) => d.id === id);
}

/** Minimum score before a column is accepted as a question column. */
export const MIN_QUESTION_SCORE = 4;

/**
 * @param {Array<{index:number, letter:string, header:string}>} columns
 * @returns {{mapping: Record<string, object>, missing: string[], excluded: Array<object>}}
 */
export function detectQuestionColumns(columns) {
  const excluded = [];
  const candidates = [];

  for (const column of columns) {
    if (!normalizeHeader(column.header)) {
      excluded.push({ ...column, reason: 'Empty header cell' });
      continue;
    }
    if (isAdminField(column.header)) {
      excluded.push({ ...column, reason: adminReason(column.header) });
      continue;
    }
    candidates.push(column);
  }

  // Score every (question, candidate column) pair, then assign greedily from the
  // strongest match downwards so that one column can never serve two questions.
  const pairs = [];
  for (const def of QUESTION_DEFINITIONS) {
    for (const column of candidates) {
      const haystack = normalizeHeader(column.header);
      let score = 0;
      for (const group of def.patterns) {
        if (group.any.some((phrase) => haystack.includes(normalizeHeader(phrase)))) {
          score += group.weight;
        }
      }
      if (score >= MIN_QUESTION_SCORE) pairs.push({ id: def.id, column, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score || a.column.index - b.column.index);

  const mapping = {};
  const taken = new Set();
  for (const pair of pairs) {
    if (mapping[pair.id] || taken.has(pair.column.index)) continue;
    mapping[pair.id] = { ...pair.column, score: pair.score };
    taken.add(pair.column.index);
  }

  for (const column of candidates) {
    if (!taken.has(column.index)) {
      excluded.push({ ...column, reason: 'Not recognised as one of the five survey questions' });
    }
  }

  const missing = QUESTION_DEFINITIONS.filter((d) => !mapping[d.id]).map((d) => d.id);
  return { mapping, missing, excluded, candidates };
}
