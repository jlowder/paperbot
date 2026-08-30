import { test } from "node:test";
import assert from "node:assert/strict";
import { prepare } from "../src/pipeline.js";
import { tempFile } from "./util.js";

function docWith(blocks: Record<string, unknown> | Record<string, unknown>[]): string {
  const list = Array.isArray(blocks) ? blocks : [blocks];
  return JSON.stringify({
    schema_version: "1.0",
    report: {
      metadata: { title: "Math Fixture" },
      sections: [{ heading: "Section", blocks: list }],
      sources: [],
    },
  });
}

/** Count exact `class="katex"` (inline+display) and `class="katex-display"` occurrences. */
const katexCount = (html: string) => (html.match(/class="katex"/g) ?? []).length;
const displayCount = (html: string) => (html.match(/class="katex-display"/g) ?? []).length;

test("display equation block renders .katex-display with inlined fonts, no delimiters", () => {
  const f = tempFile("eq-delimited.json", docWith({ type: "equation", text: "$$E = mc^2$$" }));
  const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
  assert.ok(html.includes('class="katex-display"'), "delimited equation must be typeset (display)");
  assert.ok(!html.includes("$$E = mc^2$$"), "delimiters must be stripped");
  assert.ok(html.includes("data:font/woff2;base64,"), "KaTeX fonts must be inlined as data URIs");
  assert.ok(html.includes(".math-fallback"), "math-fallback CSS must be embedded");
  assert.ok(html.includes(".equation .katex-display"), "equation display margin rule must be embedded");
  assert.deepEqual(warnings, []);
});

test("equation with language latex typesets; undelimited without language stays plain", () => {
  const f = tempFile(
    "eq-lang.json",
    docWith([
      { type: "equation", text: "\\int_0^1 x^2\\,dx", language: "latex" },
      { type: "equation", text: "a plain undelimited line" },
    ]),
  );
  const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
  assert.equal(displayCount(html), 1, "only the language:latex equation typesets");
  assert.ok(html.includes("a plain undelimited line"), "undelimited equation stays a plain div");
  assert.deepEqual(warnings, []);
});

test("span with $x^2 + y$ renders .katex inline; surrounding text escaped", () => {
  const f = tempFile(
    "inline-span.json",
    docWith({
      type: "paragraph",
      text: "",
      spans: [{ text: "Velocity $x^2 + y$ is <odd>." }],
    }),
  );
  const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
  assert.equal(katexCount(html), 1, "one inline katex group");
  assert.equal(displayCount(html), 0, "single-$ math must be inline, not display");
  assert.ok(html.includes("Velocity <span class=\"katex\">"), "math glues into the text");
  assert.ok(html.includes("is &lt;odd&gt;."), "text segments must be escaped");
  assert.ok(!html.includes("<odd>"), "raw < must not leak");
  assert.ok(!html.includes('class="math-fallback"'), "valid tex must not fall back");
  assert.deepEqual(warnings, []);
});

test("costs $5 and $10 total stays plain text (pandoc digit rule)", () => {
  const f = tempFile(
    "dollar-prices.json",
    docWith({
      type: "paragraph",
      text: "",
      spans: [{ text: "It costs $5 and $10 total." }],
    }),
  );
  const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
  assert.equal(katexCount(html), 0, "no math for $5 / $10 price pairs");
  assert.ok(html.includes("It costs $5 and $10 total."), "text must be untouched");
  assert.deepEqual(warnings, []);
});

test("whitespace around $ and unpaired $ stay text; \\( \\) and \\$ behave", () => {
  const f = tempFile(
    "pandoc-rules.json",
    docWith([
      { type: "paragraph", text: "", spans: [{ text: "For $ n $ we get $ 2 + 2$ and $50 saved" }] },
      {
        type: "paragraph",
        text: "",
        spans: [{ text: "price is \\$5 and \\(a+b\\) here" }],
      },
    ]),
  );
  const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
  assert.equal(displayCount(html), 0);
  assert.equal(katexCount(html), 1, "only the \\(a+b\\) group typesets");
  assert.ok(html.includes("For $ n $ we get $ 2 + 2$ and $50 saved"), "pandoc-rejected $ stay literal");
  assert.ok(html.includes("price is $5 and "), "\\$ renders a literal dollar");
  assert.ok(!html.includes('class="math-fallback"'));
  assert.deepEqual(warnings, []);
});

test("invalid tex in a span -> math-fallback span + exactly 1 warning", () => {
  const f = tempFile(
    "bad-tex.json",
    docWith({
      type: "paragraph",
      text: "",
      spans: [{ text: "Watch $\\frac{1$ closely" }],
    }),
  );
  const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
  assert.equal(warnings.length, 1, `expected one math warning, got: ${JSON.stringify(warnings)}`);
  assert.ok(warnings[0].startsWith("math:"), `warning must be a math warning: ${warnings[0]}`);
  assert.ok(html.includes('class="math-fallback"'), "fallback span must be emitted");
  assert.ok(html.includes("\\frac{1"), "the bad tex must be visible in the fallback");
  assert.equal(katexCount(html), 0, "no katex output for invalid tex");
});

test("code_block language latex typesets as display; invalid falls back; other langs unchanged", () => {
  const f = tempFile(
    "latex-code.json",
    docWith([
      { type: "code_block", language: "latex", text: "E = mc^2" },
      { type: "code_block", language: "latex", text: "E = \\frac{" },
      { type: "code_block", language: "python", text: "print(1)" },
    ]),
  );
  const { html, warnings } = prepare(f, { outPath: "out/unused.pdf" });
  assert.equal(displayCount(html), 1, "valid latex block typesets as a display equation");
  assert.ok(html.includes('class="equation"'), "latex block renders in the equation container");
  assert.equal((html.match(/class="math-fallback"/g) ?? []).length, 1, "invalid latex block falls back");
  assert.equal(warnings.length, 1, "one warning for the invalid block");
  assert.ok(
    html.includes('<pre class="language-python"><code>print(1)</code></pre>'),
    "non-latex code blocks must be unchanged",
  );
});
