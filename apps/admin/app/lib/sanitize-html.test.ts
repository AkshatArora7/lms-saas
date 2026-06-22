import { describe, expect, it } from "vitest";

import {
  sanitizeHtml,
  sanitizeHtmlString,
} from "./sanitize-html";

// These run under the Node (no-DOM) environment, so they exercise the
// SERVER-SIDE sanitizer (`sanitizeHtmlString`) and the isomorphic public entry
// `sanitizeHtml` (which delegates to the string path when `document` is
// undefined). This is the stored-XSS gate that runs in the BFF route handlers
// before any authored body reaches the content service (architect D3) — the
// last line of defense if a client bypasses the editor's DOM sanitizer.

describe("sanitize-html: allow-listed content is preserved", () => {
  it("keeps allow-listed structural tags", () => {
    const dirty =
      "<p>Hello</p><h2>Heading</h2><ul><li>one</li><li>two</li></ul><blockquote>q</blockquote>";
    const clean = sanitizeHtmlString(dirty);
    expect(clean).toContain("<p>");
    expect(clean).toContain("<h2>");
    expect(clean).toContain("<ul>");
    expect(clean).toContain("<li>one</li>");
    expect(clean).toContain("<blockquote>");
  });

  it("keeps inline formatting tags", () => {
    const clean = sanitizeHtmlString(
      "<strong>b</strong><em>i</em><u>u</u><b>b</b><i>i</i>",
    );
    expect(clean).toContain("<strong>");
    expect(clean).toContain("<em>");
    expect(clean).toContain("<u>");
  });

  it("preserves http(s) links with allowed attrs and a safe href", () => {
    const clean = sanitizeHtmlString(
      '<a href="https://example.com" title="Example">link</a>',
    );
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('title="Example"');
    expect(clean).toContain("link");
  });

  it("preserves img with src + alt (alt text is kept)", () => {
    const clean = sanitizeHtmlString(
      '<img src="https://blob.local/photo.png" alt="A descriptive photo" width="320">',
    );
    expect(clean).toContain('src="https://blob.local/photo.png"');
    expect(clean).toContain('alt="A descriptive photo"');
    expect(clean).toContain('width="320"');
  });

  it("preserves video with src + controls", () => {
    const clean = sanitizeHtmlString(
      '<video src="https://blob.local/clip.mp4" controls width="640"></video>',
    );
    expect(clean).toContain('src="https://blob.local/clip.mp4"');
    expect(clean).toContain('width="640"');
  });

  it("keeps relative and anchor URLs (safe)", () => {
    expect(sanitizeHtmlString('<a href="/courses/1">x</a>')).toContain(
      'href="/courses/1"',
    );
    expect(sanitizeHtmlString('<a href="#section">x</a>')).toContain(
      'href="#section"',
    );
  });
});

describe("sanitize-html: dangerous tags are dropped with their content", () => {
  it("strips <script> and its content entirely", () => {
    const clean = sanitizeHtmlString(
      '<p>safe</p><script>alert(document.cookie)</script>',
    );
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toContain("alert(document.cookie)");
    expect(clean).toContain("<p>safe</p>");
  });

  it("strips <style>, <iframe>, <object>, <embed>, <form>, <input>", () => {
    const clean = sanitizeHtmlString(
      '<style>body{display:none}</style>' +
        '<iframe src="https://evil.example"></iframe>' +
        '<object data="x"></object><embed src="x">' +
        '<form><input value="x"></form><p>kept</p>',
    );
    expect(clean).not.toMatch(/<style/i);
    expect(clean).not.toMatch(/<iframe/i);
    expect(clean).not.toMatch(/<object/i);
    expect(clean).not.toMatch(/<embed/i);
    expect(clean).not.toMatch(/<form/i);
    expect(clean).not.toMatch(/<input/i);
    expect(clean).toContain("<p>kept</p>");
  });

  it("strips an unclosed/self-closing dangerous tag", () => {
    const clean = sanitizeHtmlString('<p>a</p><script src="https://evil.example">');
    expect(clean).not.toMatch(/<script/i);
    expect(clean).toContain("<p>a</p>");
  });
});

describe("sanitize-html: event-handler attributes are stripped", () => {
  it("removes onerror from an img but keeps the safe src", () => {
    const clean = sanitizeHtmlString(
      '<img src="https://blob.local/x.png" onerror="alert(1)">',
    );
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).not.toContain("alert(1)");
    expect(clean).toContain('src="https://blob.local/x.png"');
  });

  it("removes onclick from a paragraph", () => {
    const clean = sanitizeHtmlString('<p onclick="steal()">click</p>');
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toContain("steal()");
    expect(clean).toContain("click");
  });

  it("removes onload and onmouseover handlers", () => {
    const clean = sanitizeHtmlString(
      '<img src="https://blob.local/x.png" onload="x()"><p onmouseover="y()">t</p>',
    );
    expect(clean).not.toMatch(/onload/i);
    expect(clean).not.toMatch(/onmouseover/i);
  });
});

describe("sanitize-html: dangerous URLs are neutralized", () => {
  it("drops a javascript: href", () => {
    const clean = sanitizeHtmlString('<a href="javascript:alert(1)">x</a>');
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toContain("alert(1)");
    // the tag survives, but without the dangerous href
    expect(clean).toContain("x");
  });

  it("drops a javascript: img src", () => {
    const clean = sanitizeHtmlString('<img src="javascript:alert(1)">');
    expect(clean).not.toMatch(/javascript:/i);
  });

  it("drops vbscript: and data: URLs", () => {
    expect(sanitizeHtmlString('<a href="vbscript:msgbox(1)">x</a>')).not.toMatch(
      /vbscript:/i,
    );
    expect(
      sanitizeHtmlString('<img src="data:text/html;base64,PHNjcmlwdD4=">'),
    ).not.toMatch(/data:/i);
  });
});

describe("sanitize-html: other attributes and tags", () => {
  it("strips style attributes", () => {
    const clean = sanitizeHtmlString(
      '<p style="position:fixed;background:url(javascript:x)">t</p>',
    );
    expect(clean).not.toMatch(/style\s*=/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).toContain("t");
  });

  it("unwraps a non-allow-listed tag but keeps its text", () => {
    const clean = sanitizeHtmlString("<div><span>keep me</span></div>");
    expect(clean).not.toMatch(/<div/i);
    expect(clean).not.toMatch(/<span/i);
    expect(clean).toContain("keep me");
  });

  it("drops disallowed attributes (id/class/data-*) on allowed tags", () => {
    const clean = sanitizeHtmlString(
      '<p id="x" class="y" data-evil="z">text</p>',
    );
    expect(clean).not.toMatch(/\bid=/i);
    expect(clean).not.toMatch(/\bclass=/i);
    expect(clean).not.toMatch(/data-evil/i);
    expect(clean).toContain("text");
  });
});

describe("sanitize-html: public isomorphic entry point", () => {
  it("returns empty string for empty/falsey input", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("delegates to the server path under Node and neutralizes script", () => {
    const clean = sanitizeHtml('<p>ok</p><script>evil()</script>');
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toContain("evil()");
    expect(clean).toContain("<p>ok</p>");
  });
});
