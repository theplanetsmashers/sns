const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { mdToHtml, escapeHtml } = require("../../web/lib/render");

describe("escapeHtml", () => {
  test("escapes the five special characters", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("mdToHtml", () => {
  test("renders headings", () => {
    assert.equal(mdToHtml("# 見出し1\n## 見出し2"), "<h1>見出し1</h1>\n<h2>見出し2</h2>");
  });

  test("renders bold and inline code without unescaping surrounding text", () => {
    const html = mdToHtml("これは**太字**と`コード`です。<script>x</script>");
    assert.match(html, /<strong>太字<\/strong>/);
    assert.match(html, /<code>コード<\/code>/);
    assert.doesNotMatch(html, /<script>x<\/script>/);
  });

  test("renders an unordered list", () => {
    const html = mdToHtml("- 一つ目\n- 二つ目");
    assert.equal(html, "<ul>\n<li>一つ目</li>\n<li>二つ目</li>\n</ul>");
  });

  test("renders a blockquote, merging consecutive lines", () => {
    const html = mdToHtml("> 一行目\n> 二行目");
    assert.equal(html, "<blockquote>一行目<br>二行目</blockquote>");
  });

  test("renders a table with a header separator row", () => {
    const html = mdToHtml("| A | B |\n|---|---|\n| 1 | 2 |");
    assert.match(html, /<table>/);
    assert.match(html, /<th>A<\/th><th>B<\/th>/);
    assert.match(html, /<td>1<\/td><td>2<\/td>/);
  });

  test("renders a fenced code block without interpreting its contents as markdown", () => {
    const html = mdToHtml("```\n# not a heading\n```");
    assert.match(html, /<pre><code>/);
    assert.match(html, /# not a heading/);
  });

  test("renders a horizontal rule", () => {
    assert.equal(mdToHtml("---"), "<hr>");
  });
});
