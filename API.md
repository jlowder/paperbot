# Paperbot API

HTTP service that renders structured research documents (JSON or Markdown) into
polished **PDF** or **HTML bytes**, in memory. Nothing is written to disk — the
response *is* the deliverable. A single Chromium instance is shared across
renders and launched at startup.

## Run

```bash
npm run serve        # dev (tsx)
npm run build && npm run serve:prod   # built
PORT=3000 HOST=0.0.0.0 node dist/start-server.js
```

Machine-readable spec: `GET /openapi.json`.

## Endpoints

| Method | Path             | Purpose                                    |
| ------ | ---------------- | ------------------------------------------ |
| POST   | `/render`        | Render a document → PDF or HTML bytes      |
| GET    | `/health`        | `{service, version, pdf_ready, ...}`       |
| GET    | `/`              | Service index                              |
| GET    | `/openapi.json`  | OpenAPI 3.1 document                       |

## POST /render

Two body shapes:

**Wrapped** (explicit):

```bash
curl -s -o report.pdf -H 'content-type: application/json' \
  -d '{"document": {…report envelope…}, "format": "pdf"}' \
  http://localhost:3000/render
```

Body fields: `document` (object, exactly one of this or `markdown`),
`markdown` (string), `format` (`"pdf"` | `"html"`, default `pdf`),
`page_format` (`letter`|`a4`|`legal`|`a5`|`tabloid`, default `letter`),
`title`, `validate` (default `true`).

**Raw** (the document itself as the JSON body — detect the envelope by its
top-level `report` key). For this shape, pass options as query params:

```bash
curl -s -o report.pdf -H 'content-type: application/json' \
  -d @report.json 'http://localhost:3000/render?format=pdf'
```

Raw markdown arrives via `Content-Type: text/plain` or `text/markdown`
(then defaults to `format=pdf`; add `?format=html` for HTML).

### Response

- `200` — bytes; `Content-Type: application/pdf` (with
  `Content-Disposition: attachment; filename="<slug>.pdf"`) or
  `text/html; charset=utf-8`. `X-Paperbot-warnings: <n>`.
- `400` — invalid document or request: `{"error": "document validation failed:\n  - report.sources.1.url: …"}`.
- `413` — body over 10 MB. `500` — rendering failure. `503` — PDF requested
  but Chromium is unavailable.

## Programmatic use

The server is a thin shell over the same functions an app can import directly
(`prepareContent`, `htmlToPdfBuffer`, `validatePdfBuffer` from `paperbot`),
so you can embed rendering without HTTP at all.
