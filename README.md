# Who holds the intelligence? — an AI Sovereignty classroom dashboard

A browser-only dashboard that turns the `AI_Sovereignty_35_Synthetic_Responses.xlsx` survey
workbook into evidence-linked visual insights. Built as a classroom demonstration for
Information Systems students with limited experience in data analysis.

The dashboard explains itself. Everything a student needs in order to understand what they are
looking at — where the questions and answers come from, how answers are grouped, what each chart
counts, and what the controls do — is written on the page itself, not in this README.

## What is in here

| Path | What it is |
| --- | --- |
| `app/index.html` | Development entry page (Vite root). |
| `app/main.js` | All dashboard state and rendering. |
| `app/styles.css` | The Apple-inspired minimalist styling. |
| `app/lib/` | Workbook reading, column identification, classification rules and counting. |
| `public/AI_Sovereignty_35_Synthetic_Responses.xlsx` | The demonstration workbook (35 fictional responses). Copied into `docs/` at build time and fetched at runtime. |
| `tests/` | Vitest unit and integration tests, including tests that read the real demonstration workbook. |
| `docs/` | The committed production build. GitHub Pages serves this folder. |
| `index.html` (repository root) | A static redirect to `docs/index.html`, so pointing Pages at the repository root does not serve an unbundled development page. |

There is no backend, no account, no database and no upload server. The workbook is parsed in the
browser. Uploaded workbooks never leave the student's machine.

## Running it locally

```bash
npm install
npm run dev      # development server
npm test         # unit + integration tests
npm run build    # writes the production build into docs/
npm run preview  # serve the build in docs/
```

`vite.config.js` sets `base: './'`, so the build works both at a repository root and under
`/<repository>/docs/`.

## How it was verified

| Check | Command | Result |
| --- | --- | --- |
| Unit + integration tests, including ones that read the real workbook | `npm test` | 44 passed |
| Production build | `npm run build` | `docs/index.html`, `docs/assets/*`, `docs/AI_Sovereignty_35_Synthetic_Responses.xlsx` |
| Built site driven in a real browser (filter, chart click, search, rule edit, reset, empty result, back to top, expandable answers) | `npm run check:browser` | 29/29 checks passed |
| Built site with a replacement workbook: reordered question columns, two worksheets, blank answer cells | `npm run check:upload` | 11/11 checks passed |

The two browser checks drive a headless Chrome over the DevTools Protocol against the built site,
so they test the shipped bundle rather than the source modules. Start the site first
(`npm run preview` serves `docs/`), then run them. Set `BASE_URL`, `CHROME_PATH` or `CDP_PORT` if
your setup differs from the defaults.

## Data handling

- The five survey question columns are identified from their **header wording**, never from column
  positions, so reordered columns, renamed worksheets and extra questions still resolve correctly.
- Administrative and scoring fields (ID, timestamps, email, name, total points, quiz feedback, last
  modified time, and every `Points - …` / `Feedback - …` duplicate) are excluded from the analysis
  and from the response table. The ID is kept only for tracing a response back to its spreadsheet row.
- A blank cell is never treated as zero, a "no" or a score. It is counted as a **missing answer**.
- All counts, percentages and denominators are computed from the workbook that is currently loaded.
  Nothing is hardcoded.

## The demonstration data is synthetic

The bundled workbook contains 35 **fictional** teaching examples written for a classroom exercise.
They are not findings about real students. The dashboard displays a "synthetic classroom data" badge
whenever it detects that disclaimer in the loaded workbook.

## Hosting

GitHub Pages serves the prebuilt `docs/` folder from the repository. Both of these entry points work:

- `<repo root>/` → `index.html` → redirects to the dashboard
- `<repo root>/docs/` → the dashboard directly
