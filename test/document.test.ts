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
        sources: [],
      },
    }),
  );
  const { html } = prepare(f, { outPath: "out/unused.pdf" });
  assert.ok(
    html.includes("array of disciplines. Since its rise"),
    `expected glued period, got: ${html.match(/<p>[\s\S]*?<\/p>/)?.[0] ?? "(no <p>)"}`,
  );
  assert.ok(!html.includes("disciplines ."), "stranded space before period");
  assert.ok(!html.includes("disciplines.."), "doubled period");
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
