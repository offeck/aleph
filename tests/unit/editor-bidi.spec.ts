import { describe, expect, it } from "vitest";
import { blockDir, buildEditorBidiCss, SCOPE_ATTR } from "../../src/content/editorBidi";

describe("blockDir", () => {
  it("classifies Hebrew as rtl", () => {
    expect(blockDir("שלום עולם")).toBe("rtl");
  });

  it("classifies Arabic as rtl", () => {
    expect(blockDir("مرحبا بالعالم")).toBe("rtl");
  });

  it("classifies English as ltr", () => {
    expect(blockDir("hello world")).toBe("ltr");
  });

  it("treats non-RTL-script Unicode letters as strong LTR (dir=auto parity)", () => {
    expect(blockDir("Σ שלום")).toBe("ltr"); // Greek
    expect(blockDir("Привет שלום")).toBe("ltr"); // Cyrillic
    expect(blockDir("śōl")).toBe("ltr"); // Latin-extended
  });

  it("skips weak characters and uses the first strong letter (digits before Hebrew)", () => {
    expect(blockDir("123 שלום")).toBe("rtl");
  });

  it("skips weak characters and uses the first strong letter (digits before Latin)", () => {
    expect(blockDir("123 abc")).toBe("ltr");
  });

  it("first strong letter wins in mixed text", () => {
    expect(blockDir("שלום hello")).toBe("rtl");
    expect(blockDir("hello שלום")).toBe("ltr");
  });

  it("returns null when no strong letter exists", () => {
    expect(blockDir("")).toBe(null);
    expect(blockDir(null)).toBe(null);
    expect(blockDir(undefined)).toBe(null);
    expect(blockDir("123 ?! .,")).toBe(null);
  });
});

describe("buildEditorBidiCss", () => {
  it("emits a scoped nth-child rule per RTL block with !important", () => {
    const css = buildEditorBidiCss([{ id: "e1", rtlPaths: [[2]] }]);
    expect(css).toContain(`[${SCOPE_ATTR}="e1"] [contenteditable="true"] > :is(p, div, li):nth-child(2)`);
    expect(css).toContain("direction: rtl !important;");
    expect(css).toContain("text-align: right !important;");
  });

  it("emits a structural path for nested blocks (ul > li)", () => {
    const css = buildEditorBidiCss([{ id: "e1", rtlPaths: [[2, 3]] }]);
    expect(css).toContain(
      `[${SCOPE_ATTR}="e1"] [contenteditable="true"] > :nth-child(2) > :is(p, div, li):nth-child(3)`
    );
  });

  it("handles deep nesting paths", () => {
    const css = buildEditorBidiCss([{ id: "e1", rtlPaths: [[1, 2, 3]] }]);
    expect(css).toContain(
      `> :nth-child(1) > :nth-child(2) > :is(p, div, li):nth-child(3)`
    );
  });

  it("returns an empty string for no scopes, no RTL blocks, or empty paths", () => {
    expect(buildEditorBidiCss([])).toBe("");
    expect(buildEditorBidiCss([{ id: "e1", rtlPaths: [] }])).toBe("");
    expect(buildEditorBidiCss([{ id: "e1", rtlPaths: [[]] }])).toBe("");
  });

  it("is deterministic for the string-compare write guard", () => {
    const scopes = [
      { id: "e1", rtlPaths: [[1], [2, 3]] },
      { id: "e2", rtlPaths: [[2]] },
    ];
    expect(buildEditorBidiCss(scopes)).toBe(buildEditorBidiCss(scopes));
  });

  it("emits one rule per path across multiple scopes", () => {
    const css = buildEditorBidiCss([
      { id: "e1", rtlPaths: [[1], [3]] },
      { id: "e2", rtlPaths: [[2]] },
    ]);
    const matches = css.match(/nth-child\((\d+)\)/g);
    expect(matches).toEqual(["nth-child(1)", "nth-child(3)", "nth-child(2)"]);
    expect(css).toContain(`[${SCOPE_ATTR}="e2"]`);
  });
});
