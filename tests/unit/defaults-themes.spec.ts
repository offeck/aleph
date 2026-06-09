import { describe, expect, it } from "vitest";
import { DEFAULTS, filterToDefaults } from "../../src/shared/defaults";
import { THEME_NAMES, THEMES } from "../../src/shared/themes";

const DEFAULT_KEYS = [
  "bidiEnabled",
  "enableClaude",
  "enableChatgpt",
  "enableGemini",
  "fontFamily",
  "fontSize",
  "lineHeight",
  "paragraphSpacing",
  "codeFontSize",
  "codeFontFamily",
  "chatWidth",
  "theme",
  "themeClaude",
  "themeChatgpt",
  "themeGemini",
  "focusMode",
  "focusHideUpgrade",
  "focusHideChips",
  "focusHidePromos",
  "latexFix",
  "streamSmooth",
  "streamAnimation",
  "messageSpacing",
  "miniGame",
] as const;

const THEME_FIELDS = [
  "bg",
  "bgSecondary",
  "bgTertiary",
  "text",
  "textMuted",
  "accent",
  "border",
  "codeBg",
  "codeBorder",
  "inputBg",
] as const;

describe("shared defaults", () => {
  it("keeps the canonical settings key list explicit", () => {
    expect(Object.keys(DEFAULTS)).toEqual(DEFAULT_KEYS);
    expect(DEFAULTS.miniGame).toBe(false);
  });

  it("filterToDefaults keeps known keys (even falsy) and drops unknown ones", () => {
    expect(filterToDefaults({ theme: "nord", fontSize: 0, injected: "x", __proto__junk: 1 }))
      .toEqual({ theme: "nord", fontSize: 0 });
    expect(filterToDefaults({})).toEqual({});
  });
});

describe("shared themes", () => {
  it("has a label for every theme key", () => {
    expect(Object.keys(THEME_NAMES)).toEqual(Object.keys(THEMES));
    expect(THEME_NAMES.none).toBe("Default");
  });

  it("keeps every concrete theme complete", () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      if (name === "none") {
        expect(theme).toBeNull();
        continue;
      }

      expect(theme).not.toBeNull();
      for (const field of THEME_FIELDS) {
        expect(theme?.[field], `${name}.${field}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
