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

function renderSpan(span: Span): string {
  const text = escapeHtml(span.text.trim());
  const sup = citationSup(span.sourcePositions);
  return `${text}${sup}`;
}

function renderListItem(item: ListItem): string {
  const text = escapeHtml(item.text);
  const sup = citationSup(item.sourcePositions);
  return `<li>${text}${sup}</li>`;
}

function renderTableCell(cell: TableCell): string {
  const text = escapeHtml(cell.text);
  const sup = citationSup(cell.sourcePositions);
  return `<td>${text}${sup}</td>`;
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
      return `<p>${block.spans.map(renderSpan).join(" ")}</p>`;
    }

    case "quote": {
      return `<div class="quote">${block.spans.map(renderSpan).join(" ")}</div>`;
    }

    case "callout": {
      const title = block.calloutTitle !== "" ? block.calloutTitle : "Note";
      const body = block.spans
        .map((s) => `<p>${renderSpan(s)}</p>`)
        .join("");
      return `<div class="callout ${block.calloutType}"><span class="callout-title">${escapeHtml(
        title,
      )}</span>${body}</div>`;
    }

    case "comparison_table": {
      const parts: string[] = [];
      if (block.caption !== "") {
        parts.push(`<div class="table-caption">${escapeHtml(block.caption)}</div>`);
      }
      const head = block.columns
        .map((c) => `<th>${escapeHtml(c)}</th>`)
        .join("");
      const rows = block.rows
        .map((row) => `<tr>${row.map(renderTableCell).join("")}</tr>`)
        .join("");
      parts.push(
        `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`,
      );
      return parts.join("");
    }

    case "ordered_list": {
      return `<ol>${block.items.map(renderListItem).join("")}</ol>`;
    }

    case "unordered_list": {
      return `<ul>${block.items.map(renderListItem).join("")}</ul>`;
    }

    case "code_block": {
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
