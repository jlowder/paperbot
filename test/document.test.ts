import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromiumAvailable } from "../src/pdf.js";
import { prepare } from "../src/pipeline.js";
import { runCli, tempFile } from "./util.js";

const hasChromium = chromiumAvailable();
const noChromium = "chromium not installed (run: npx playwright install chromium)";

function docWith(block: Record<string, unknown>): string {
  return JSON.stringify({
    schema_version: "1.0",
    report: {
      metadata: { title: "Callout Fixture" },
      sections: [{ heading: "Section", blocks: [block] }],
      sources: [],
    },
  });
}

test("unknown callout_type -> exit 1 with actionable schema error naming the value", async () => {
  const f = tempFile(
    "bad-callout.json",
    docWith({
      type: "callout",
      callout_type: "banana",
      callout_title: "X",
      spans: [{ text: "hello" }],
    }),
  );
  const res = await runCli([f]);
  assert.equal(res.code, 1);
  assert.match(res.err, /validation failed/);
  assert.match(res.err, /callout_type/);
  assert.match(res.err, /banana/);
});

test("key_insight is a real callout variant: rendered with its own style", () => {
  const f = tempFile(
    "key-insight.json",
    docWith({
      type: "callout",
      callout_type: "key_insight",
      callout_title: "Insight",
      spans: [{ text: "The key insight." }],
    }),
  );
  const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
  assert.ok(html.includes('class="callout key_insight"'), "callout must carry the key_insight class");
  assert.ok(html.includes(".callout.key_insight"), "embedded CSS must style key_insight");
  assert.ok(html.includes("#8e44ad"), "key_insight must use its own (violet) color");
  assert.deepEqual(warnings, []);
});

test("all documented callout variants render distinct styles", () => {
  const f = tempFile(
    "all-callouts.json",
    JSON.stringify({
      schema_version: "1.0",
      report: {
        metadata: { title: "All" },
        sections: [
          {
            heading: "Section",
            blocks: ["note", "warning", "danger", "tip", "info", "key_insight"].map((ct) => ({
              type: "callout",
              callout_type: ct,
              callout_title: ct,
              spans: [{ text: `body ${ct}` }],
            })),
          },
        ],
        sources: [],
      },
    }),
  );
  const { html } = prepare(f, { outPath: "out/unused.pdf" });
  for (const ct of ["note", "warning", "danger", "tip", "info", "key_insight"]) {
    assert.ok(html.includes(`class="callout ${ct}"`), `missing callout variant ${ct}`);
    assert.ok(html.includes(`.callout.${ct}`), `missing CSS for ${ct}`);
  }
});

test("marker-only span keeps its terminal period and glues to the prior sentence", () => {
  const f = tempFile(
    "punct-span.json",
    JSON.stringify({
      schema_version: "1.0",
      report: {
        metadata: { title: "Punct Span" },
        sections: [
          {
            heading: "Section",
            blocks: [
              {
                type: "paragraph",
                text: "",
                spans: [
                  { text: "a wide array of disciplines ", citations: [] },
                  { text: "[D41] [D14].", citations: ["7", "15"] },
                  { text: "Since its rise, it spread", citations: [] },
                ],
              },
            ],
          },
        ],
        // 15 sources so the span's numeric refs ["7","15"] resolve to a real sup.
        sources: Array.from({ length: 15 }, (_, i) => ({ title: `Source ${i + 1}` })),
      },
    }),
  );
  const { html } = prepare(f, { outPath: "out/unused.pdf" });
  assert.ok(
    html.includes(
      'array of disciplines <span class="cite"><a href="#src-7">[7,15]</a></span>. Since its rise',
    ),
    `expected "disciplines [7,15]. Since" (space, sup, period), got: ${html.match(/<p>[\s\S]*?<\/p>/)?.[0] ?? "(no <p>)"}`,
  );
  assert.ok(!html.includes("disciplines ."), "stranded space before period");
  assert.ok(!html.includes("disciplines.."), "doubled period");
});

test("cited span ending in a period renders as word [1,2]. Next", () => {
  const f = tempFile(
    "eos-citation.json",
    JSON.stringify({
      schema_version: "1.0",
      report: {
        metadata: { title: "EOS Citation" },
        sections: [
          {
            heading: "Section",
            blocks: [
              {
                type: "paragraph",
                text: "",
                spans: [
                  { text: "This provides the underlying information [W4].", citations: ["2"] },
                  { text: "For an input matrix X with dimension d", citations: [] },
                ],
              },
            ],
          },
        ],
        sources: [
          { title: "First source", citation_key: "W4" },
          { title: "Second source" },
        ],
      },
    }),
  );
  const { html } = prepare(f, { outPath: "out/unused.pdf" });
  const p = html.match(/<p>[\s\S]*?<\/p>/)?.[0] ?? "(no <p>)";
  // Order: last char, SPACE, sup, PERIOD, space, first char of next sentence.
  assert.ok(
    html.includes(
      'underlying information <span class="cite"><a href="#src-1">[1,2]</a></span>. For an input matrix',
    ),
    `expected "information [1,2]. For" in the new order, got: ${p}`,
  );
  assert.ok(!html.includes("information.<span"), `citation must precede the period, got: ${p}`);
});

test("list item ending in a period renders as word [1]. per the citation convention", () => {
  const f = tempFile(
    "eos-list-item.json",
    JSON.stringify({
      schema_version: "1.0",
      report: {
        metadata: { title: "EOS List Item" },
        sections: [
          {
            heading: "Section",
            blocks: [
              {
                type: "unordered_list",
                items: [
                  { text: "Most effective on ImageNet and CIFAR-10 datasets [W3]. " },
                  { text: "Plain item without a period" },
                ],
              },
            ],
          },
        ],
        sources: [{ title: "Third source", citation_key: "W3" }],
      },
    }),
  );
  const { html } = prepare(f, { outPath: "out/unused.pdf" });
  const li = html.match(/<li>[\s\S]*?datasets[\s\S]*?<\/li>/)?.[0] ?? "(no item)";
  assert.ok(
    html.includes(
      'CIFAR-10 datasets <span class="cite"><a href="#src-1">[1]</a></span>.</li>',
    ),
    `expected "datasets [1].</li>" (space, sup, period), got: ${li}`,
  );
  assert.ok(!html.includes("datasets.<span"), "citation must precede the period in list items");
  assert.ok(html.includes("<li>Plain item without a period</li>"), "item without a mark unchanged");
});

test("citation_note block renders as a Sources callout, verbatim, no citation sups", () => {
  const f = tempFile(
    "citation-note.json",
    JSON.stringify({
      schema_version: "1.0",
      report: {
        metadata: { title: "Citation Note" },
        sections: [
          {
            heading: "Section",
            blocks: [
              {
                type: "citation_note",
                text: "",
                spans: [
                  {
                    text: "Sources used in this section: W9 (Treibergs) for definitions; W10 (SIAM) for surveys.",
                    citations: ["1"],
                  },
                ],
              },
            ],
          },
        ],
        sources: [{ title: "First source" }],
      },
    }),
  );
  const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
  assert.ok(
    !warnings.some((w) => w.includes("unknown block type")),
    `citation_note must not warn, got: ${warnings.join("; ")}`,
  );
  assert.ok(html.includes('class="callout note"'), html);
  assert.ok(html.includes("Sources</span>"), "default title must be Sources");
  assert.ok(html.includes("W9 (Treibergs) for definitions"), "note text must appear verbatim");
  const note = html.match(/<div class="callout note">[\s\S]*?<\/div>/)?.[0] ?? "(no note)";
  assert.ok(!note.includes('<span class="cite">'), `no citation sups in the note, got: ${note}`);
});

test("consecutive normal sentence spans get exactly one space", () => {
  const f = tempFile(
    "two-sentences.json",
    docWith({
      type: "paragraph",
      text: "",
      spans: [{ text: "First sentence. " }, { text: " Second sentence." }],
    }),
  );
  const { html } = prepare(f, { outPath: "out/unused.pdf" });
  assert.ok(html.includes("<p>First sentence. Second sentence.</p>"), html.match(/<p>[\s\S]*?<\/p>/)?.[0] ?? "(no <p>)");
});

test("whitespace-only span is still dropped", () => {
  const f = tempFile(
    "blank-span.json",
    docWith({
      type: "paragraph",
      text: "",
      spans: [{ text: "First sentence." }, { text: "   " }, { text: "Second sentence." }],
    }),
  );
  const { html } = prepare(f, { outPath: "out/unused.pdf" });
  assert.ok(html.includes("<p>First sentence. Second sentence.</p>"), html.match(/<p>[\s\S]*?<\/p>/)?.[0] ?? "(no <p>)");
});

test("figure with no url and no caption -> warning emitted, exit 0", async () => {
  const f = tempFile(
    "figure.json",
    docWith({ type: "figure", url: "", caption: "" }),
  );

  if (!hasChromium) {
    // No browser: assert the warning through the no-PDF entry point.
    const { warnings } = prepare(f, { outPath: "out/unused.pdf" });
    assert.ok(
      warnings.some((w) => w.includes("figure with no url or caption skipped")),
      `expected a figure warning, got: ${JSON.stringify(warnings)}`,
    );
    return;
  }

  const out = join(tmpdir(), `paperbot-figure-${process.pid}.pdf`);
  try {
    const res = await runCli([f, "--out", out]);
    assert.equal(res.code, 0, `expected exit 0: ${res.err}`);
    assert.match(res.out, /figure with no url or caption skipped/);
  } finally {
    rmSync(out, { force: true });
  }
});

test("figure with an unsafe url and no caption -> render-side warning surfaces", async () => {
  // Normalization keeps the block (url is non-empty); the renderer refuses the
  // javascript: URL and, with no caption either, warns instead of vanishing.
  const f = tempFile(
    "figure-unsafe.json",
    docWith({ type: "figure", url: "javascript:alert(1)", caption: "" }),
  );

  if (!hasChromium) {
    const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
    assert.ok(!html.toLowerCase().includes("javascript:"), "unsafe url must not be emitted");
    assert.ok(
      warnings.some((w) => w.includes("figure with no url or caption skipped")),
      `expected a figure warning, got: ${JSON.stringify(warnings)}`,
    );
    return;
  }

  const out = join(tmpdir(), `paperbot-figure-unsafe-${process.pid}.pdf`);
  try {
    const res = await runCli([f, "--out", out]);
    assert.equal(res.code, 0, `expected exit 0: ${res.err}`);
    assert.match(res.out, /figure with no url or caption skipped/);
  } finally {
    rmSync(out, { force: true });
  }
});
