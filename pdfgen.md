## Recommendation

Keep Markdown as the **canonical research representation**, but do not treat it as the final document format. Convert a structured intermediate representation—preferably JSON or an internal document model—to polished HTML, then render that HTML to PDF with a real browser engine or a print-oriented renderer.

I would not have the LLM generate PDF directly. PDFs are layout artifacts, not a good language-generation target. Direct PDF generation makes the model responsible for pagination, font handling, tables, links, orphaned headings, page breaks, and other concerns that deterministic software handles much better.

A robust architecture is:

```text
Research agent
    ↓
Structured research document
    ↓
LLM editorial/formatting pass
    ↓
Markdown and/or HTML
    ↓
Sanitization + citation validation
    ↓
HTML/CSS print template
    ↓
PDF renderer
    ↓
PDF validation
```

## Use a structured document model

Markdown is useful for humans and debugging, but it is underspecified for high-quality publishing. For example, a Markdown link does not tell your renderer whether it is a source citation, a normal hyperlink, or a related reading item.

Have the writer produce validated JSON such as:

```json
{
  "metadata": {
    "title": "The Future of Grid-Scale Battery Storage",
    "subtitle": "Technology, economics, and deployment constraints",
    "date": "2026-08-25",
    "author": "Research Assistant"
  },
  "executive_summary": [
    "Finding one.",
    "Finding two."
  ],
  "sections": [
    {
      "id": "market",
      "title": "Market landscape",
      "blocks": [
        {
          "type": "paragraph",
          "text": "..."
        },
        {
          "type": "table",
          "columns": ["Technology", "Strength", "Limitation"],
          "rows": [
            ["Lithium-ion", "...", "..."]
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "source-1",
      "title": "...",
      "publisher": "...",
      "url": "https://example.com",
      "accessed": "2026-08-25"
    }
  ]
}
```

You can then render the same model into:

- Markdown for debugging and copying.
- HTML for the web interface.
- PDF for distribution.
- DOCX or EPUB later, if useful.
- A machine-readable archive for reproducibility.

This also makes it possible to enforce rules such as “every factual claim must have at least one source reference” before rendering.

## Prefer HTML/CSS to PDF

For a report resembling a polished web-based deep-research result, HTML/CSS is usually the best layout layer. It gives you control over:

- Typography and font fallback.
- Page size and margins.
- Headers and footers.
- Page numbers.
- Tables.
- Callout boxes.
- Source cards.
- Syntax-highlighted code.
- Math rendered with MathJax or KaTeX.
- Hyperlinks and bookmarks.
- Print-specific page breaks.
- Responsive screen and print versions.

A browser renderer such as Chromium via Playwright is a strong choice if your app already uses JavaScript or Next.js. It provides excellent CSS and font rendering and is especially convenient when the report is already available as a React page.

A typical pipeline might be:

```text
JSON document
  → React report template
  → server-side HTML
  → Playwright Chromium
  → PDF
```

Example:

```js
await page.pdf({
  path: outputPath,
  format: "Letter",
  printBackground: true,
  displayHeaderFooter: true,
  margin: {
    top: "0.75in",
    right: "0.7in",
    bottom: "0.75in",
    left: "0.7in"
  },
  headerTemplate: "<span></span>",
  footerTemplate: `
    <div style="font-size:9px;width:100%;text-align:center">
      <span class="pageNumber"></span> / <span class="totalPages"></span>
    </div>
  `
});
```

For a Python-first service, WeasyPrint is also attractive because it is designed around HTML/CSS print rendering and supports repeating headers and footers. Pandoc with XeLaTeX or LuaLaTeX remains a good option for academic, mathematical, or citation-heavy reports, but it can be more difficult to package consistently across macOS and Linux. HTML-to-PDF tooling is commonly recommended for custom styling, while ReportLab is better suited to programmatic, highly controlled layouts rather than converting arbitrary rich text. [skills.mercuryagent](https://skills.mercuryagent.sh/skills/pdf-generation/markdown-to-pdf)

## Solve character problems systematically

Character corruption is usually not an LLM problem. It is generally caused by one of these:

- An incorrect encoding declaration.
- A renderer using a font without the required glyphs.
- Smart quotes or Unicode dashes being normalized inconsistently.
- Broken HTML escaping.
- Markdown parsing that interprets citation syntax incorrectly.
- PDF generation through a legacy Latin-1 font.
- Missing CJK, Arabic, mathematical, or emoji fonts.
- Copying text through an intermediate terminal or document format.

Use these safeguards:

1. Keep all text UTF-8 from ingestion through rendering.
2. Add `<meta charset="utf-8">` to generated HTML.
3. Embed known fonts in the PDF pipeline.
4. Avoid relying on PDF base fonts such as Helvetica for arbitrary Unicode.
5. Define explicit fallback fonts for Latin, Greek, Cyrillic, CJK, and symbols.
6. Escape text according to its context: HTML text, HTML attribute, URL, and CSS each require different handling.
7. Test with a Unicode fixture containing curly quotes, em dashes, nonbreaking spaces, mathematical symbols, accented names, Arabic, CJK, and emoji.

For example:

```text
“Quoted text” — café, naïve, coöperate
α β γ   ∑ ∫ ≤ ≥ ≠
東京   العربية   हिन्दी
```

Do not silently replace unsupported characters with ASCII approximations. Detect missing glyphs and either select a fallback font or fail the build with a useful diagnostic. Font embedding is also important for reliable rendering across systems; PDF/A workflows, in particular, require embedded and properly embeddable fonts. [github](https://github.com/Kozea/WeasyPrint/issues/630)

## Give the LLM an editorial role

Prompt improvements are worthwhile, but they should improve the **content model and editorial quality**, not ask the model to imitate page layout.

Have the LLM generate or validate:

- A concise title and subtitle.
- An executive summary.
- A clear hierarchy of sections.
- Short paragraphs.
- Claims tied to source IDs.
- Tables only when they improve comprehension.
- Explicit uncertainty and disagreement.
- A limitations section.
- A bibliography generated from source metadata.
- Suggested figures or diagrams, if your application supports them.

A useful instruction is:

```text
Return only valid JSON matching the supplied schema.

Every externally verifiable claim must include one or more source IDs.
Do not invent sources, URLs, page numbers, quotations, or publication dates.
Use section headings that describe the subject rather than generic labels.
Prefer prose for nuanced analysis and tables for direct comparisons.
Mark uncertain or disputed claims explicitly.
Do not include Markdown, HTML, CSS, or layout instructions.
```

Then use a separate deterministic renderer to decide:

- Font sizes.
- Colors.
- Spacing.
- Page breaks.
- Citation appearance.
- Table widths.
- Header and footer content.
- Whether a section begins on a new page.

A separate “editor” LLM pass can improve readability, but it should operate against the schema and source set. It should not be allowed to alter URLs or citation metadata without validation.

## Make citations first-class

Deep-research reports look polished partly because their citations are consistent. Represent citations as objects, not merely as text inserted into paragraphs.

For example:

```json
{
  "text": "Grid storage deployments increased substantially.",
  "citations": ["source-3", "source-7"]
}
```

The renderer can turn this into:

```html
<p>
  Grid storage deployments increased substantially.
  <sup><a href="#source-3"> [templated](https://templated.io/blog/generate-pdfs-in-python-with-libraries/)</a><a href="#source-7"> [chromewebstore.google](https://chromewebstore.google.com/detail/ai-exporter-save-chatgpt/kagjkiiecagemklhmhkabbalfpbianbe?hl=en)</a></sup>
</p>
```

At the end, generate a “Sources” section from the source records. Validate that:

- Every cited source exists.
- Every source ID resolves to a URL.
- Every source is cited or intentionally marked as background.
- Citation numbering is stable.
- Links are clickable in the PDF.
- Long URLs wrap correctly.
- Source titles and publishers are escaped safely.

Reports modeled after Gemini’s deep-research output commonly use a structured hierarchy, an executive summary, inline numeric citations, and a Works Cited section. [datastudios](https://www.datastudios.org/post/google-gemini-for-research-reports-structure-citations-and-output-formats)

## Design the report template

A good default report might contain:

1. Cover area with title, subtitle, date, and research scope.
2. Executive summary with three to seven findings.
3. Key takeaways or “At a glance” callout.
4. Main sections with numbered headings.
5. Comparison tables where appropriate.
6. Methodology and limitations.
7. Sources and optional appendices.

Useful CSS ideas include:

```css
@page {
  size: Letter;
  margin: 0.78in 0.72in 0.78in 0.72in;

  @bottom-right {
    content: counter(page);
    font-size: 9pt;
    color: #6b7280;
  }
}

body {
  color: #202124;
  font-family: "Inter", "Noto Sans", sans-serif;
  font-size: 10.5pt;
  line-height: 1.48;
}

h1, h2, h3 {
  break-after: avoid;
}

table, figure, blockquote, .callout {
  break-inside: avoid;
}

h2 {
  break-before: auto;
  margin-top: 1.4em;
}

.source-list {
  font-size: 8.5pt;
  overflow-wrap: anywhere;
}
```

Do not over-design it. The visual quality should come from typography, spacing, hierarchy, restrained color, and predictable page composition—not from adding decorative elements everywhere.

## Renderer choice

| Approach | Best use | Strengths | Weaknesses |
|---|---|---|---|
| Chromium/Playwright | Web-style reports and React/Next.js apps | Excellent CSS, fonts, tables, JavaScript, and visual consistency | Larger runtime; pagination can require testing |
| WeasyPrint | Python services and print-focused HTML | Good print CSS, headers, footers, and deterministic server rendering | Smaller CSS feature set than Chromium |
| Pandoc + XeLaTeX/LuaLaTeX | Academic and mathematical reports | Excellent typography, equations, bibliographies, and cross-references | More complex deployment and template maintenance |
| ReportLab | Highly controlled programmatic PDFs | Reliable, powerful, and suitable for charts/forms | You must implement layout yourself |
| Direct PDF from the LLM | Almost never | No conversion step in theory | Poor control, brittle pagination, difficult validation |

For your background with Next.js, Docker, JavaScript, Python, and local model deployment, I would start with **structured JSON → React/HTML → Playwright PDF**. If you want a smaller Python service, use **structured JSON → Jinja2 HTML → WeasyPrint**. Keep ReportLab as a fallback for specialized elements such as charts, certificates, or highly controlled appendices.

## Build a PDF test suite

Treat PDF rendering as a software subsystem, not a one-off export function. Every build should test:

- ASCII and Unicode text.
- Long headings.
- Very long URLs.
- Tables with many columns.
- Tables spanning multiple pages.
- Code blocks.
- Inline and block mathematics.
- Images with captions.
- Empty or missing sections.
- Extremely long paragraphs.
- Citation links.
- Page numbers and bookmarks.
- Right-to-left or non-Latin text, if supported.

Run automated checks with tools such as `pdftotext` and a PDF parser:

- The PDF opens successfully.
- Extracted text contains expected phrases.
- No replacement characters such as `�` occur.
- The page count is reasonable.
- All expected source URLs are present.
- The output is not suspiciously small or empty.

Also render a sample PDF to page images during development and inspect representative pages. Text extraction alone will not detect clipped tables, awkward page breaks, or headings stranded at the bottom of a page.

## Bottom line

Use this division of responsibility:

- **Research model:** facts, reasoning, source linkage, uncertainty.
- **Editorial model:** organization, clarity, concise wording, report structure.
- **Schema validator:** completeness and citation integrity.
- **Template:** visual identity and document hierarchy.
- **PDF renderer:** pagination, fonts, links, and print layout.
- **QA layer:** text, metadata, visual, and link validation.

The most important change is not “prompt the LLM to write a prettier PDF.” It is to stop making Markdown the only internal representation. Preserve Markdown as a convenient export, but generate the PDF from a validated structured document rendered through a carefully designed HTML/CSS template.

**Q: Are there any standardized structured document models that already exist and have been proven out? Maybe there are existing pipelines that could be applied, so the main change would be to generate the report in this structured output instead of markdown, and then use the existing pipeline on it.**

Yes. There are mature, proven document models and publishing pipelines—but they target different kinds of documents. For your AI-generated deep-research reports, I would use a **hybrid standards-based approach** rather than adopting a heavyweight publishing standard wholesale.

The most practical default is:

```text
LLM → application JSON schema
      ├─ rich body: Pandoc AST-compatible JSON or semantic HTML
      ├─ citations: CSL-JSON
      └─ report metadata/assets: your schema
   → HTML template (Jinja2)
   → WeasyPrint PDF
```

That preserves deterministic layout while leveraging established models for the parts that benefit most from interoperability—especially body structure and citations.

## Best-fit options

| Model / pipeline | Maturity | Best for | Fit for your reports |
|---|---:|---|---|
| **Pandoc AST** | Very mature, broad format conversion | General documents; Markdown, HTML, DOCX, LaTeX, EPUB, PDF | **Best general-purpose base** |
| Semantic HTML + CSS | Web standard; extremely mature | Attractive report rendering and browser/PDF workflows | **Best layout target** |
| CSL-JSON + citeproc | Mature scholarly citation ecosystem | Source metadata, inline citations, bibliographies | **Strongly recommended** |
| DocBook | Long-established OASIS XML standard | Technical books, manuals, reference docs | Good, but unnecessarily verbose |
| DITA + DITA Open Toolkit | Enterprise-grade OASIS ecosystem | Reusable technical documentation at scale | Usually overkill |
| JATS XML | NISO/ANSI standard | Journal articles, archival scholarly publishing | Useful only for journal-like reports |
| Quarto / Typst | Mature authoring/rendering ecosystems | Analytical and research documents | Good renderer option, not ideal LLM-native model |
| ProseMirror / TipTap JSON | Well-proven application editor model | Human editing within a web application | Good if users will edit reports interactively |

## Recommended: Pandoc AST + CSL-JSON

Pandoc is especially relevant because it already implements the model you are describing: it parses many input formats into a language-neutral abstract syntax tree (AST), optionally transforms that tree with filters, then writes the result to formats including HTML, DOCX, LaTeX, EPUB, and PDF. Its JSON AST is a documented interchange format, and its filter system is designed specifically for programmatic document transformations. [pandoc](https://pandoc.org/filters.html)

Instead of asking the LLM for Markdown:

```markdown
## Market landscape

Grid-scale deployment rose sharply.[^1]
```

you could instruct it to produce a constrained JSON representation such as:

```json
{
  "pandoc-api-version": [1, 23, 1],
  "meta": {
    "title": {
      "t": "MetaInlines",
      "c": [{ "t": "Str", "c": "Grid-Scale" }, { "t": "Space" }, { "t": "Str", "c": "Storage" }]
    }
  },
  "blocks": [
    {
      "t": "Header",
      "c": [
        2,
        ["market-landscape", [], []],
        [{ "t": "Str", "c": "Market" }, { "t": "Space" }, { "t": "Str", "c": "landscape" }]
      ]
    },
    {
      "t": "Para",
      "c": [
        { "t": "Str", "c": "Grid-scale" },
        { "t": "Space" },
        { "t": "Str", "c": "deployment" },
        { "t": "Space" },
        { "t": "Str", "c": "rose" },
        { "t": "Space" },
        { "t": "Str", "c": "sharply." }
      ]
    }
  ]
}
```

However, I would **not** make the LLM emit raw Pandoc AST directly as your primary contract. It is verbose, easy for a model to malform, relatively unpleasant to inspect, and contains formatting-level implementation details your research writer should not need to decide.

Instead, define a simpler domain model, validate it with JSON Schema or Pydantic/Zod, and compile it to Pandoc AST or semantic HTML yourself.

For example:

```json
{
  "schema_version": "1.0",
  "report": {
    "title": "Grid-Scale Battery Storage",
    "subtitle": "Technology, economics, and deployment constraints",
    "generated_at": "2026-08-25",
    "executive_summary": [
      {
        "text": "Storage deployment is accelerating, but economics vary significantly by duration and grid market.",
        "citations": ["iea-2025", "eia-2026"]
      }
    ],
    "sections": [
      {
        "id": "market-landscape",
        "heading": "Market landscape",
        "blocks": [
          {
            "type": "paragraph",
            "spans": [
              {
                "text": "Grid-scale deployment rose sharply in several major electricity markets.",
                "citations": ["iea-2025"]
              }
            ]
          },
          {
            "type": "comparison_table",
            "caption": "Common grid-storage technologies",
            "columns": ["Technology", "Strength", "Constraint"],
            "rows": [
              ["Lithium-ion", "Mature supply chain", "Duration and degradation trade-offs"]
            ]
          }
        ]
      }
    ]
  },
  "references": [
    {
      "id": "iea-2025",
      "type": "report",
      "title": "Example report title",
      "author": [{ "literal": "International Energy Agency" }],
      "issued": { "date-parts": [[2025]] },
      "URL": "https://example.org/report"
    }
  ]
}
```

Your renderer then performs these deterministic transformations:

1. Validate the report model.
2. Validate every citation ID against `references`.
3. Convert citations to Pandoc `Cite` nodes or HTML citation anchors.
4. Apply a CSL style to produce inline citations and bibliography entries.
5. Render semantic HTML with Jinja2.
6. Apply your CSS report design.
7. Render the HTML with WeasyPrint.

## Citation standards

Use **CSL-JSON** for your source metadata rather than inventing a bibliography format. It is the JSON data model used by citeproc tooling and has a published JSON Schema; it includes authors, dates, titles, publishers, DOIs, URLs, page locators, and other bibliographic fields. The project notes that CSL-JSON is widely adopted, although its schema is not fully normative across every implementation. [github](https://github.com/citation-style-language/schema)

A citation record might look like:

```json
{
  "id": "iea-2025",
  "type": "report",
  "title": "Batteries and Secure Energy Transitions",
  "author": [
    { "literal": "International Energy Agency" }
  ],
  "issued": {
    "date-parts": [[2025]]
  },
  "publisher": "International Energy Agency",
  "URL": "https://www.iea.org/reports/batteries-and-secure-energy-transitions"
}
```

Then use a citeproc implementation to generate:

- Inline numeric citations: ` [pandoc](https://pandoc.org/filters.html)`
- Author-date citations: `(International Energy Agency, 2025)`
- Footnote citations
- A consistently formatted bibliography in APA, Chicago, IEEE, Vancouver, or a custom CSL style

CSL processors distinguish source records (“items”), in-text citation clusters, and individual cite-items with optional locators such as a page, chapter, or section. [citeproc-js.readthedocs](https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html)

For a deep-research product, I would keep two separate concepts:

- **Evidence links:** source IDs attached to factual claims in the report model.
- **Citation rendering:** the visual realization of those links in HTML/PDF through CSL.

This gives you validation and traceability that typical Markdown citation syntax alone does not provide.

## Established XML standards

### DocBook

DocBook is an OASIS-maintained semantic XML vocabulary originally designed for technical books and software/hardware documentation, though it can represent general papers as well. It has a long history, formal schemas, and established transformation tooling. [oasis-open](https://www.oasis-open.org/docbook/)

Its vocabulary is rich:

```xml
<article>
  <info>
    <title>Grid-Scale Battery Storage</title>
  </info>

  <section xml:id="market">
    <title>Market landscape</title>
    <para>
      Grid-scale deployments expanded substantially.
    </para>
  </section>
</article>
```

**Use it if:** You expect to produce manuals, multi-chapter books, technical references, or deeply structured documentation that needs a long shelf life.

**Do not use it by default** for LLM research reports. XML verbosity increases generation errors, authoring complexity, and schema-management cost, without giving you proportionate benefit for a standalone 10–30 page report.

### DITA

DITA is another OASIS XML standard, optimized for topic-based, reusable technical content. Its central design is to build reusable concepts, tasks, and reference topics, then assemble them through “maps” into different publications. [docs.oasis-open](https://docs.oasis-open.org/dita/dita/v1.3/dita-v1.3-part3-all-inclusive.html)

The DITA Open Toolkit is an open-source implementation that can generate HTML and PDF. Its PDF path converts DITA to XSL Formatting Objects and then uses an FO formatter such as Apache FOP or commercial renderers. [dita-ot](https://www.dita-ot.org/)

**Use it if:** Your research output will become a reusable enterprise knowledge base with content reuse across web docs, help systems, product manuals, and PDFs.

**Avoid it if:** Each research report is primarily unique narrative analysis. DITA’s reuse model and publishing machinery will likely slow you down.

### JATS

JATS—Journal Article Tag Suite—is an ANSI/NISO standard for representing scholarly journal articles in XML. The current JATS ecosystem defines elements and attributes for textual and graphical journal-article content, with multiple article models. [loc](https://www.loc.gov/preservation/digital/formats/fdd/fdd000451.shtml)

It is ideal for documents that truly resemble academic articles:

- Structured abstracts.
- Authors and affiliations.
- Funding statements.
- Methods, results, and discussion.
- Formal references.
- Tables, figures, equations, and supplements.
- Archival or library interoperability.

**Use it if:** You aim to publish research in scholarly repositories, exchange content with academic publishing systems, or produce formal article-style reports.

**Avoid it if:** You want a modern, visually flexible, Gemini-like client report. JATS is semantically excellent but is not a pleasant primary authoring format for an LLM or a product UI.

## Rendering pipelines

### Your best pipeline: custom JSON → Jinja2 → WeasyPrint

This aligns with the stack you were already considering. Treat the document model as your stable API, write one excellent HTML template, and use CSS for the visual identity.

```text
LLM
  → JSON Schema / Pydantic validation
  → citation validation and CSL formatting
  → Jinja2 HTML template
  → print CSS + embedded fonts
  → WeasyPrint
  → PDF QA checks
```

Advantages:

- You own the schema and can keep it LLM-friendly.
- You can make the PDF look substantially better than a generic Markdown conversion.
- The HTML can be rendered in your application as a browser preview.
- You retain a clean source format for re-rendering with a new design later.
- You can provide Markdown, HTML, PDF, and DOCX exports from one source model.

Use a schema with a small fixed vocabulary of blocks:

```text
heading
paragraph
bullet_list
ordered_list
quote
callout
comparison_table
figure
code_block
equation
page_break
source_list
appendix
```

For inline content, use:

```text
text
emphasis
strong
link
citation
code
math
```

That is intentionally similar to Pandoc, ProseMirror, and Contentful’s rich-text AST, but optimized for your particular research product rather than being a general-purpose CMS. Contentful, for example, stores rich content as a JSON AST rather than HTML, then provides renderers that map nodes to HTML and custom components. [contentful](https://contentful.com/developers/docs/concepts/rich-text)

### Pandoc pipeline

```text
Custom JSON
  → custom JSON-to-Pandoc-AST compiler
  → Pandoc JSON
  → Pandoc filters / citeproc
  → HTML, DOCX, EPUB, LaTeX, or PDF
```

This is useful if multi-format output matters immediately. Pandoc supports a wide set of input/output formats and can use different PDF engines depending on the desired output path. [pandoc](https://pandoc.org/MANUAL.html)

I would use Pandoc as an **export subsystem**, not as the LLM’s direct output target.

### Quarto + Typst

Quarto is built on Pandoc and can render one document into PDF, HTML, DOCX, and other formats. Its authoring system supports structured features such as citations, cross-references, equations, tables of contents, and multiple output targets. [quarto](https://quarto.org/docs/get-started/authoring/vscode.html)

Typst is a modern markup-based typesetting system intended to offer high-quality PDF generation with a simpler authoring model than LaTeX; PDF is its default output. [typst](https://typst.app/docs/reference/pdf/)

A possible pipeline is:

```text
Custom JSON → generated Quarto Markdown → Quarto → Typst → PDF
```

This can produce attractive output, especially for analytical reports with tables, code, equations, and figures. But it still means generating a markup language from your structured model and maintaining templates in another rendering stack.

I would choose this if:

- High-end typesetting is more important than HTML/CSS design flexibility.
- Your reports contain substantial math or sophisticated figure/table layouts.
- You want strong print output and are comfortable adopting Typst templates.

I would not choose it as the first version if you already have a Next.js/HTML-oriented product and want a browser preview that exactly resembles the PDF.

## Practical implementation choice

For your app, define a **versioned `ResearchReport` JSON Schema**, with CSL-JSON source records embedded or referenced by ID.

Use:

- `Zod` if the report pipeline is primarily TypeScript/Next.js.
- `Pydantic` if generation, validation, and rendering orchestration are primarily Python.
- Jinja2 templates and WeasyPrint for the first PDF implementation.
- A semantic HTML renderer that maps your report blocks to known components.
- `citeproc-py`, `citeproc-js`, or Pandoc citeproc for bibliography formatting.
- Pandoc later as an export adapter for DOCX, EPUB, or alternative PDF generation.

The core distinction is:

```text
Do not use Markdown as your document data model.
Do not use PDF as your generation model.
Use a validated semantic report model.
```

Markdown can still remain an export format, and Pandoc can still be part of the toolchain. But the system should treat the structured model—not the Markdown file—as the authoritative report.