/**
 * Per-block-type HTML renderers.
 *
 * Every user-provided string (text, captions, cells, titles, sources,
 * metadata) is HTML-escaped. Citation markers are already stripped upstream
 * (see citations.ts); escaping happens on the clean text here.
 */
import {
  type Block,
  type DocumentModel,
  type ListItem,
  type Source,
  type Span,
  type TableCell,
} from "../document.js";
import { citationSup } from "../citations.js";
import { renderMath, splitMath, stripMathDelimiters } from "./math.js";

/** Escape a string for safe use in an HTML text node. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a string for safe use inside a double-quoted HTML attribute. */
export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/** True for URLs we are willing to emit as a real href. */
function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Flush renderer-side warnings (math fallbacks, skipped figures, ...). */
function reportWarnings(warnings: readonly string[], opts: BlockRenderOptions): void {
  for (const w of warnings) opts.onWarning?.(w);
}

/**
 * Render cited text (escaped text + math groups + citation sup). Math is
 * extracted first via splitMath: text segments are escaped, math groups are
 * typeset by renderMath (invalid TeX -> visible fallback + warning). The
 * terminal-punct rule (applied to the whole text when math is absent, to the
 * trailing text segment when it is present) orders the sup as `word [4,5].`,
 * never `word.[4,5]`: one space before the sup, the mark after it. The space
 * the marker strip in citations.ts consumed is re-inserted here; any other
 * trailing space before the mark is dropped (also normalizes "word ." ->
 * "word."). Without a citation the text just normalizes to "word."; a span
 * ending in a math group has no terminal punct (the formula is
 * self-contained) and the sup, if any, follows it.
 */
function renderCitedText(text: string, positions: readonly number[], warnings: string[]): string {
  const raw = text.trim();
  const sup = citationSup(positions);
  const segments = splitMath(raw);

  if (segments.length === 1 && segments[0].kind === "text") {
    // No math markers: whole-text punct rule (unchanged legacy behavior).
    const m = raw.match(/^(.*?)([.!?]+)$/s);
    if (m) {
      const base = m[1].replace(/\s+$/, "");
      const punct = m[2];
      if (sup) return (base ? escapeHtml(base) + " " : " ") + sup + escapeHtml(punct);
      return escapeHtml(base + punct);
    }
    return escapeHtml(raw) + sup;
  }

  // Math present: render segment by segment; text segments are escaped.
  // The trailing-punct rule applies only to a trailing TEXT segment — a
  // span ending in a math group has no terminal punct (the formula is
  // self-contained); the sup, if any, follows the trailing group.
  let out = "";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "math") {
      out += renderMath(seg.tex, seg.display, warnings);
      continue;
    }
    if (i < segments.length - 1) {
      out += escapeHtml(seg.text);
      continue;
    }
    const m = seg.text.match(/^(.*?)([.!?]+)$/s);
    if (m) {
      const base = m[1].replace(/\s+$/, "");
      const punct = m[2];
      if (sup) out += (base ? escapeHtml(base) + " " : " ") + sup + escapeHtml(punct);
      else out += escapeHtml(base + punct);
    } else {
      out += escapeHtml(seg.text);
    }
  }
  if (segments[segments.length - 1].kind === "math" && sup !== "") out += sup;
  return out;
}

/** Render one span: see renderCitedText for the citation ordering rules. */
function renderSpan(span: Span, warnings: string[]): string {
  return renderCitedText(span.text, span.sourcePositions, warnings);
}

/**
 * True when a span's trimmed text should receive a leading space in
 * joinSpans: it starts with a letter/digit, or it opens a math delimiter
 * (`$`, `$$`, `\(`, `\[`). The producer emits each inline formula as a
 * standalone span with the inter-word space at the span edge; renderCitedText
 * trims those edges, so without the math case a math span would glue to the
 * preceding word ("…form$\dot{x}$"). Punctuation-initial spans (".", ",")
 * still glue directly — the terminal-punct behavior is preserved.
 */
function startsWithMathOrWord(t: string): boolean {
  return (
    /^[\p{L}\p{N}]/u.test(t) ||
    /^\$\$/.test(t) ||
    /^\$(?!\$)/.test(t) ||
    /^\\\(/.test(t) ||
    /^\\\[/.test(t)
  );
}

/**
 * Join span texts for a paragraph/quote: a single space is inserted before a
 * span only when its trimmed text starts with a letter, digit, or math
 * delimiter (see startsWithMathOrWord); spans starting with other
 * punctuation (e.g. a lone ".") glue directly to the prior span.
 */
function joinSpans(spans: Span[], warnings: string[]): string {
  let out = "";
  for (const span of spans) {
    if (out !== "" && startsWithMathOrWord(span.text.trim())) out += " ";
    out += renderSpan(span, warnings);
  }
  return out;
}

function renderListItem(item: ListItem, warnings: string[]): string {
  return `<li>${renderCitedText(item.text, item.sourcePositions, warnings)}</li>`;
}

function renderTableCell(cell: TableCell, warnings: string[]): string {
  return `<td>${renderCitedText(cell.text, cell.sourcePositions, warnings)}</td>`;
}

export interface BlockRenderOptions {
  /** Called once per duplicate/unknown-ish anomaly, if any. */
  onWarning?: (w: string) => void;
}

export function renderBlock(block: Block, opts: BlockRenderOptions = {}): string {
  switch (block.type) {
    case "heading": {
      const tag = block.level === 2 ? "h2" : "h3";
      return `<${tag}>${escapeHtml(block.text)}</${tag}>`;
    }

    case "paragraph": {
      const warnings: string[] = [];
      const html = `<p>${joinSpans(block.spans, warnings)}</p>`;
      reportWarnings(warnings, opts);
      return html;
    }

    case "quote": {
      const warnings: string[] = [];
      const html = `<div class="quote">${joinSpans(block.spans, warnings)}</div>`;
      reportWarnings(warnings, opts);
      return html;
    }

    case "callout": {
      const warnings: string[] = [];
      const title = block.calloutTitle !== "" ? block.calloutTitle : "Note";
      const body = block.spans
        .map((s) => `<p>${renderSpan(s, warnings)}</p>`)
        .join("");
      const html = `<div class="callout ${block.calloutType}"><span class="callout-title">${escapeHtml(
        title,
      )}</span>${body}</div>`;
      reportWarnings(warnings, opts);
      return html;
    }

    case "citation_note": {
      // Source note: callout styling, verbatim prose (no citation sups).
      const warnings: string[] = [];
      const title = block.calloutTitle !== "" ? block.calloutTitle : "Sources";
      const body = block.spans
        .map((s) => `<p>${renderSpan(s, warnings)}</p>`)
        .join("");
      const html = `<div class="callout note"><span class="callout-title">${escapeHtml(title)}</span>${body}</div>`;
      reportWarnings(warnings, opts);
      return html;
    }

    case "comparison_table": {
      const parts: string[] = [];
      if (block.caption !== "") {
        parts.push(`<div class="table-caption">${escapeHtml(block.caption)}</div>`);
      }
      const head = block.columns
        .map((c) => `<th>${escapeHtml(c)}</th>`)
        .join("");
      const warnings: string[] = [];
      const rows = block.rows
        .map((row) => `<tr>${row.map((c) => renderTableCell(c, warnings)).join("")}</tr>`)
        .join("");
      parts.push(
        `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`,
      );
      const html = parts.join("");
      reportWarnings(warnings, opts);
      return html;
    }

    case "ordered_list": {
      const warnings: string[] = [];
      const html = `<ol>${block.items.map((it) => renderListItem(it, warnings)).join("")}</ol>`;
      reportWarnings(warnings, opts);
      return html;
    }

    case "unordered_list": {
      const warnings: string[] = [];
      const html = `<ul>${block.items.map((it) => renderListItem(it, warnings)).join("")}</ul>`;
      reportWarnings(warnings, opts);
      return html;
    }

    case "code_block": {
      // latex/tex code blocks are typeset as a display equation; everything
      // else renders as a plain code block, unchanged.
      if (block.language.toLowerCase() === "latex" || block.language.toLowerCase() === "tex") {
        const warnings: string[] = [];
        const html = `<div class="equation">${renderMath(block.text.trim(), true, warnings)}</div>`;
        reportWarnings(warnings, opts);
        return html;
      }
      const langAttr =
        block.language !== "" ? ` class="language-${escapeAttr(block.language)}"` : "";
      return `<pre${langAttr}><code>${escapeHtml(block.text)}</code></pre>`;
    }

    case "figure": {
      const inner: string[] = [];
      if (block.url !== "" && isSafeUrl(block.url)) {
        inner.push(`<img src="${escapeAttr(block.url)}" alt="">`);
      }
      if (block.caption !== "") {
        inner.push(`<figcaption>${escapeHtml(block.caption)}</figcaption>`);
      }
      if (inner.length === 0) {
        opts.onWarning?.(`figure with no url or caption skipped`);
        return "";
      }
      return `<figure>${inner.join("")}</figure>`;
    }

    case "equation": {
      const t = block.text.trim();
      const tex = stripMathDelimiters(t);
      // Typeset when the producer said so (language latex/tex) or when the
      // text carries $$ / \[ \] delimiters; otherwise the plain div.
      if (block.language.trim().toLowerCase() === "latex" || block.language.trim().toLowerCase() === "tex" || tex !== t) {
        const warnings: string[] = [];
        const html = `<div class="equation">${renderMath(tex, true, warnings)}</div>`;
        reportWarnings(warnings, opts);
        return html;
      }
      return `<div class="equation">${escapeHtml(block.text)}</div>`;
    }

    case "page_break": {
      return `<div class="page-break" style="break-before: page"></div>`;
    }

    default: {
      // unknown:<type> blocks carry plain (already marker-stripped) text.
      if (block.text.trim() === "") return "";
      return `<p>${escapeHtml(block.text)}</p>`;
    }
  }
}

/** Render the References list: every source, original order, anchorable. */
export function renderReferences(sources: Source[]): string {
  if (sources.length === 0) return "";
  const items = sources
    .map((s) => {
      const details: string[] = [];
      if (s.author !== "") details.push(s.author);
      if (s.publisher !== "") details.push(s.publisher);
      if (s.issued !== "") details.push(s.issued);
      if (s.accessed !== "") details.push(`accessed ${s.accessed}`);
      const detail = details.filter((d) => d.trim() !== "").join(" · ");

      const links: string[] = [];
      if (s.url !== "" && isSafeUrl(s.url)) {
        links.push(`<a href="${escapeAttr(s.url)}">${escapeHtml(s.url)}</a>`);
      }
      if (s.doi !== "") {
        const doiUrl = `https://doi.org/${s.doi}`;
        links.push(
          isSafeUrl(doiUrl)
            ? `<a href="${escapeAttr(doiUrl)}">doi:${escapeHtml(s.doi)}</a>`
            : `doi:${escapeHtml(s.doi)}`,
        );
      }

      const inner: string[] = [`<span class="ref-num">[${s.position}]</span>`];
      inner.push(`<span class="ref-title">${escapeHtml(s.title)}</span>`);
      if (detail !== "") inner.push(`<span class="ref-detail"> — ${escapeHtml(detail)}</span>`);
      if (links.length > 0) inner.push(`<div class="ref-links">${links.join(" ")}</div>`);
      return `<li id="src-${s.position}">${inner.join("")}</li>`;
    })
    .join("\n");
  return `<section class="doc-section references"><h2>References</h2><ul>${items}</ul></section>`;
}

/**
 * Check that every source position referenced by the model has a matching
 * anchor target (defensive; the normalizer guarantees it).
 */
export function modelCitesMissingAnchors(model: DocumentModel): string[] {
  const warnings: string[] = [];
  const known = new Set(model.sources.map((s) => s.position));
  const all = (pos: number[]) => {
    for (const p of pos) if (!known.has(p)) warnings.push(`citation ${p} has no source anchor`);
  };
  for (const sec of model.sections) {
    for (const b of sec.blocks) {
      if (b.type === "paragraph" || b.type === "quote" || b.type === "callout") {
        for (const s of b.spans) all(s.sourcePositions);
      } else if (b.type === "comparison_table") {
        for (const row of b.rows) for (const c of row) all(c.sourcePositions);
      } else if (b.type === "ordered_list" || b.type === "unordered_list") {
        for (const it of b.items) all(it.sourcePositions);
      }
    }
  }
  return [...new Set(warnings)];
}
