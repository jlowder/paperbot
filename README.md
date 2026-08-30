# paperbot

Converts structured research documents into polished, print-quality PDF reports.

Paperbot takes the JSON artifacts that LLM research agents emit (the `examples/`
in this repo are real ones), plus plain markdown, and turns them into
10–30-page client-ready PDFs: cover title area, executive summary panel,
sectioned body with zebra-striped comparison tables, tinted callouts, and a
numbered reference list with working `[1]`-style citation back-links.

## How it works

```
┌────────────────────┐    ┌─────────┐    ┌────────┐    ┌──────────────┐
│  input file        │    │  parse  │    │  zod   │    │  normalize   │
│  *.json (schema)   ├────┤  JSON   ├────┤ valid. ├────┤ doc model +  │
│  *.md  (marked)    │    │  / marked│   │  shape │    │ citations    │
└────────────────────┘    └─────────┘    └────────┘    └──────┬───────┘
                                                              │
        ┌─────────────────────────────────────────────────────┘
        ▼
┌────────────────────┐    ┌──────────────────────────────────────────────┐
│  self-contained    │    │  Playwright Chromium                        │
│  HTML + embedded   ├────┤   page.setContent(html)                     │
│  print CSS         │    │   await document.fonts.ready                 │
└────────────────────┘    │   page.pdf(margins, footer, format)          │
                          └──────────────────────┬───────────────────────┘
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │  validate (pdf-parse, retried up to 5×):    │
                          │  file exists, >10 KB, %PDF header, ≥1 page,  │
                          │  title in extracted text                    │
                          └──────────────────────────────────────────────┘
```

`src/pipeline.ts` exposes `run()` / `prepare()` as a stable library API —
the future API server can drive the same code path without shelling out.
(`prepare()` is the no-PDF entry point; both accept a file path or `-` for
stdin.)

## Install

```bash
npm install
npm run build
npx playwright install chromium   # one-time, ~170 MB
```

Requires Node ≥ 20 (uses the built-in test runner).

## CLI

```
paperbot [convert] <input> [options]

Input (exactly one):
  <input>                .json (structured report) or .md (markdown)
  -                      read the document from stdin (JSON or markdown, sniffed)
  "convert"              optional no-op subcommand (first argument only)

Options:
  -o, --out <path>       output PDF file (default: out/<input-basename>.pdf)
  --format <fmt>         letter | a4 | legal | a5 | tabloid (default: letter)
  --title <text>         override the document title
  --keep-html[=path]     also write the intermediate HTML; path in
                         "--keep-html=path" or "--keep-html path" form
                         (default: output path with .html)
  --no-validate          skip the post-render pdf-parse text check
  --quiet                suppress non-essential output
  -h, --help             show usage (wins over other errors, exit 0)
```

A second positional argument is a usage error:
`✗ unexpected extra argument 'b.json' (expected exactly one input file)`.

Exit codes: `0` ok · `1` input error (missing file, empty stdin, bad JSON,
schema violation) · `2` usage error (unknown flag, bad value, two inputs)
· `3` PDF/render failure (includes "Chromium not installed" with the install
command).

Example:

```bash
$ node dist/cli.js "examples/make a report on genetic programming_20260826_111539.json"
✓ Wrote out/make a report on genetic programming_20260826_111539.pdf, 9 pages, 2 warnings
  ⚠ 36 unresolvable citation references (numeric index out of range for 18 sources)
  ⚠ 7 citation marker(s) without a matching source citation_key (stripped)
```

`dist/` is not committed — after any source changes, run `npm run build`
before invoking the CLI, or use the dev entry (`npm run dev`) instead.

Errors are actionable, not stack traces (real output):

```
✗ invalid JSON (near line 2, column 27) (approximate): Unexpected token '}', ...
✗ document validation failed:
  - report.metadata.title: Required
  - report.sections.0.blocks.0.spans: Expected array, received string
✗ no data on stdin (pipe a JSON or markdown document, e.g. `cat doc.md | paperbot -`)
```

Markdown also works from a pipe: `cat report.md | paperbot - --out out/report.pdf`.

## Input format

JSON documents follow the deep-research agent's schema (see
`src/document.ts` — zod, lenient on dirt, strict on shape):

```jsonc
{
  "schema_version": "1.0",
  "report": {
    "metadata": { "title": "…", "author": "…", "generated_at": "ISO-8601",
                  "report_type": "deep_research" },
    "executive_summary": [ "plain string" ],
    "sections": [
      { "id": "s1", "heading": "…", "blocks": [
          { "type": "paragraph",        "spans": [ { "text": "… [W2]", "citations": [2] } ] },
          { "type": "heading",          "text": "Sub-heading", "level": 3 },
          { "type": "unordered_list",   "items": [ { "text": "…", "citations": [1] } ] },
          { "type": "ordered_list",     "items": [ { "text": "…" } ] },
          { "type": "comparison_table", "caption": "…", "columns": ["…"], "rows": [[ { "text": "…", "citations": [3] } ]] },
          { "type": "code_block",       "language": "python", "text": "…" },
          { "type": "callout",          "callout_type": "key_insight", "callout_title": "…", "spans": [ { "text": "…" } ] },
          { "type": "page_break" }
      ] }
    ],
    "sources": [ { "id": "s01", "title": "…", "URL": "…",
                   "citation_key": "W1", "author": "…", "issued": "2024" } ]
  }
}
```

`callout_type` is a strict enum: `note` | `warning` | `danger` | `tip` |
`info` | `key_insight` — any other value is a schema error naming the value.

Every string that reaches the HTML is escaped (`<`, `>`, `&`, quotes) at
render time. Bracket markers like `[W1]` / `[D6]` embedded in text resolve
against `sources[].citation_key` (case-insensitive) and are **always**
stripped from the visible text; the `citations` array on spans/cells/items
resolves positionally into `sources[]` (1-based). Each resolved source
becomes a `<sup>` anchor into the reference list (`<li id="src-N">`), so
PDF readers get clickable, bidirectional citations.

Markdown input maps straightforwardly: first H1 → title, `## Executive
Summary` → summary panel, other H2 → sections, H3+ → sub-headings, plus
lists, GFM tables, code fences, blockquotes (→ note callouts), and `---`
(→ page break).

## Citation algorithm

Per span/cell/item, exactly what `src/citations.ts` does:

1. **Numeric refs** in the `citations` array resolve 1-based *positionally*
   into `report.sources`: `2` or `"2"` → the second source, when
   `1 ≤ n ≤ sources.length`. Non-numeric strings get a lenient fallback
   (match `citation_key`, then `id`, both case-insensitive).
2. **Bracket markers** in the text — `…[W4]` / `…[D12]`
   (regex `\[(?:W|D)\d+\]`, case-insensitive) — resolve via
   `sources[].citation_key`.
3. **All bracket markers are stripped from visible text**, resolved or not.
   The superscript label is each resolved source's 1-based array position,
   deduped, sorted ascending, comma-joined (`[2,3]`).

Unresolvable references **never fail the build**; they aggregate into two
warnings (`N unresolvable citation references …`, `N citation marker(s)…`).
Spans/cells/items left with no visible content after stripping are dropped
(16 in the GP example); empty cells stay empty. One `CitationResolver`
instance serves the whole document, so the warning counts are document-wide.

## Layout & styling

All CSS is embedded in the generated HTML (`src/render/css.ts`): serif
(Charter/Georgia + CJK fallbacks) body at 10.5 pt, sans display, letter-spaced
overline labels, 1 pt rules, zebra-striped tables with `break-inside: avoid`
and repeated `thead`, page-number footer, and page-break rules (headings keep
with next block). Six callout variants, each with its own color:
`note` (blue), `warning` (amber), `danger` (red), `tip` (green), `info`
(indigo), `key_insight` (violet). Design language follows the reference spec
in `pdfgen.md`.

## Known tech debt

- `pdf-parse@1.1.4` vendors pdf.js 1.10.100 (2018), whose fake-worker path
  (LoopbackPort clone `new value.constructor(value)` + `Stream.makeSubStream`
  re-deriving from `this.bytes.buffer`) mis-reads any input whose underlying
  ArrayBuffer has a non-zero byteOffset — i.e. Node's pooled Buffers for
  sub-64 KB files — surfacing as "bad XRef entry" / "Command token too long"
  on perfectly valid small PDFs. The shipped fix (`toPdfParseInput()` in
  `src/pdf.ts`) normalizes parser input to a dedicated, offset-0 plain
  Uint8Array (zero-copy when the input already is one). A one-time 321-byte
  pre-warm prime parse and the 5-attempt retry loop (re-reading the file,
  50 ms backoff) are retained as defense-in-depth. Follow-up: consider
  `pdfjs-dist`.

## Tests

```bash
npm test
```

`node:test` + `tsx`, seven suites, 32 tests:

| suite | covers |
| --- | --- |
| `examples.test.ts` | both real example JSONs end-to-end through `prepare()`: citation counts, no residual markers, references `<li>` count, table rows, all section headings, warning behavior |
| `unicode.test.ts` | the full pdfgen.md test string (curly quotes, em dash, NBSP, Greek, math, CJK, Arabic, Devanagari, emoji) + HTML-injection escaping |
| `markdown.test.ts` | fixture round-trip: titles, exec summary, H3 sub-headings, lists, tables, code, callouts, page breaks; raw-HTML dropping with warning |
| `document.test.ts` | strict callout enum (unknown → exit 1 naming the value; `key_insight` renders with its own style), figure warnings |
| `failures.test.ts` | CLI exit codes: missing file / bad JSON (line+col) / schema violations / bad `--format` (all five accepted) / two positionals / `--keep-html` space form / `--help` wins / unknown flag / `convert` alias |
| `cli-fresh.test.ts` | spawns the **built** CLI as a child process: 1-page doc cold-start regression, empty stdin, markdown via stdin; skips cleanly without `dist/` (and without chromium for the render legs) |
| `pdf.e2e.test.ts` | real Chromium → real PDF → pdf-parse text assertions; **skips cleanly when Chromium is absent** |

## Project layout

```
src/
  cli.ts          arg parsing (injectable streams, testable), exit codes
  pipeline.ts     run() / prepare() library API, format detection, error shaping
  document.ts     zod schemas + normalizeDocument() (dirty-data guards)
  citations.ts    marker regex, CitationResolver, sup-link renderer
  markdown.ts     marked lexer -> DocumentModel
  pdf.ts          Playwright launch, pdf options, pdf-parse validation
  render/
    html.ts       self-contained document shell (title, summary, sections, refs)
    blocks.ts     per-block renderers + HTML escaping
    css.ts        embedded print stylesheet
test/             node:test suites + fixtures
examples/         the two real deep-research agent outputs
out/              generated PDFs (gitignored)
```

## Next phase: API server

Phase 2 serves the same pipeline over HTTP: `POST /reports` accepts JSON
or markdown, runs `prepare()` + `htmlToPdf()` in-process, streams progress
(parallel browser contexts, not process-per-request), and returns the PDF
with `Content-Disposition`. The `pipeline.ts` API is shaped for exactly
this: no global state, all I/O paths injected via options. (The stdin
handling lives in the CLI-facing `prepare()` path; the API server will take
request bodies directly and skip it.)
