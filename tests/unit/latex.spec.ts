import { describe, expect, it } from "vitest";
import {
  cleanMathText,
  expandBackward,
  extractLatexExpression,
  findBareLatexRegions,
  findEqRegions,
  shouldIsolateMathText,
} from "../../src/content/latex";

describe("cleanMathText", () => {
  it("converts unicode math symbols to LaTeX commands", () => {
    expect(cleanMathText("a → b")).toBe("a \\to  b");
    expect(cleanMathText("x ≤ y ≥ z")).toBe("x \\leq  y \\geq  z");
    expect(cleanMathText("a ∈ B ∪ C")).toBe("a \\in  B \\cup  C");
    expect(cleanMathText("√x · ∞")).toBe("\\sqrt x \\cdot  \\infty ");
  });

  it("normalizes differential spacing", () => {
    expect(cleanMathText("f(x), dx")).toBe("f(x)\\,dx");
    expect(cleanMathText("dx, dy")).toBe("dx\\,dy");
  });

  it("leaves plain text untouched", () => {
    expect(cleanMathText("hello world")).toBe("hello world");
  });
});

describe("extractLatexExpression", () => {
  it("consumes a command with a braced argument", () => {
    const text = "\\frac{a}{b} rest";
    // starts at 0, should cover \frac{a}{b} and stop before the prose word
    expect(text.slice(0, extractLatexExpression(text, 0))).toBe("\\frac{a}{b}");
  });

  it("consumes subscripts and superscripts", () => {
    const text = "\\sum_{i=1}^{n} done";
    expect(text.slice(0, extractLatexExpression(text, 0))).toContain("\\sum_{i=1}^{n}");
  });

  it("stops before long prose words", () => {
    const text = "\\alpha therefore";
    const end = extractLatexExpression(text, 0);
    expect(text.slice(0, end)).not.toContain("therefore");
  });
});

describe("expandBackward", () => {
  it("pulls leading numbers/operators into the region", () => {
    const text = "x = 2\\pi";
    // \pi starts at index 5; expansion should reach back over "x = 2"
    expect(expandBackward(text, 5)).toBe(0);
  });

  it("does not cross unrelated prose", () => {
    const text = "see \\pi";
    expect(expandBackward(text, 4)).toBe(4);
  });
});

describe("findBareLatexRegions", () => {
  it("finds an undelimited command region", () => {
    const regions = findBareLatexRegions("the value \\frac{1}{2} here");
    expect(regions).toHaveLength(1);
    expect(regions[0].latex).toContain("\\frac{1}{2}");
  });

  it("does not match commands glued to an underscore (\\b boundary)", () => {
    // \int_0^1: the word-boundary in the command regex fails before "_",
    // so bare (undelimited) sub/superscripted commands are not detected.
    expect(findBareLatexRegions("the integral \\int_0^1 x dx converges")).toEqual([]);
  });

  it("merges nearby regions", () => {
    const regions = findBareLatexRegions("\\alpha + \\beta");
    expect(regions).toHaveLength(1);
  });

  it("returns nothing for plain prose", () => {
    expect(findBareLatexRegions("no math here at all")).toEqual([]);
  });
});

describe("findEqRegions", () => {
  it("finds equation-like runs containing = and letters", () => {
    const regions = findEqRegions("f(x) = 2x + 1");
    expect(regions).toHaveLength(1);
    expect(regions[0].text).toBe("f(x) = 2x + 1");
  });

  it("trims trailing punctuation", () => {
    const regions = findEqRegions("x = 1.");
    expect(regions[0].text).toBe("x = 1");
  });

  it("ignores runs without an equals sign", () => {
    expect(findEqRegions("just words")).toEqual([]);
  });

  it("splits around RTL-script text", () => {
    const regions = findEqRegions("נניח ש x = 5 אז");
    expect(regions).toHaveLength(1);
    expect(regions[0].text).toBe("x = 5");
  });
});

describe("shouldIsolateMathText", () => {
  it("accepts math-bearing parentheses and pipes", () => {
    expect(shouldIsolateMathText("ערך של (x + 1 = 2) כאן")).toBe(true);
    expect(shouldIsolateMathText("האורך |xy| גדול")).toBe(true);
  });

  it("rejects plain prose", () => {
    expect(shouldIsolateMathText("sentence without any math")).toBe(false);
    expect(shouldIsolateMathText("טקסט בעברית בלבד")).toBe(false);
  });
});
