import { describe, expect, it, vi } from "vitest";
import { THEMES } from "../../src/shared/themes";

// Pin the platform so the per-platform theme override key resolves like in
// the browser (PLATFORM is null under node, and platformThemeKey(null) throws).
vi.mock("../../src/content/platform", () => ({ PLATFORM: "claude" }));

const { applySettingsChange } = await import("../../src/content/settingsStore");
const { getActiveThemeName, isLightTheme } = await import("../../src/content/theme");
const { buildThemeSelector } = await import("../../src/content/styles");

describe("getActiveThemeName", () => {
  it("resolves platform override, then global theme, then none", () => {
    applySettingsChange("themeClaude", "nord");
    applySettingsChange("theme", "warmDark");
    expect(getActiveThemeName()).toBe("nord");

    applySettingsChange("themeClaude", "");
    expect(getActiveThemeName()).toBe("warmDark");

    applySettingsChange("theme", "");
    expect(getActiveThemeName()).toBe("none");
  });
});

describe("isLightTheme", () => {
  it("classifies known themes by background luminance", () => {
    expect(isLightTheme(THEMES.paperLight)).toBe(true);
    expect(isLightTheme(THEMES.warmDark)).toBe(false);
    expect(isLightTheme(THEMES.midnight)).toBe(false);
  });

  it("returns null for missing themes", () => {
    expect(isLightTheme(null)).toBe(null);
    expect(isLightTheme(THEMES.none)).toBe(null);
  });
});

describe("buildThemeSelector", () => {
  it("scopes every selector under [data-aleph-theme]", () => {
    expect(buildThemeSelector("", ["body", " main"])).toBe(
      "[data-aleph-theme] body,\n[data-aleph-theme] main"
    );
  });
});
