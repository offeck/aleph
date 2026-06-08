import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE_NAMES = ["popup", "settings", "insights"] as const;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

describe("extension asset paths", () => {
  it("loads generated page and content assets from dist in the manifest", () => {
    const manifest = JSON.parse(readText("manifest.json"));

    expect(manifest.action.default_popup).toBe("dist/popup.html");
    expect(manifest.content_scripts[0].css).toEqual(["dist/content.css"]);
  });

  it("allows background provider usage refreshes without an open chat tab", () => {
    const manifest = JSON.parse(readText("manifest.json"));

    expect(manifest.permissions).toContain("cookies");
    expect(manifest.permissions).toContain("alarms");
    expect(manifest.host_permissions).toEqual(expect.arrayContaining([
      "https://claude.ai/*",
      "https://chatgpt.com/*",
      "https://chat.openai.com/*",
      "https://gemini.google.com/*",
    ]));
  });

  it("keeps source page HTML references relative to generated dist siblings", () => {
    for (const page of PAGE_NAMES) {
      const html = readText(`src/${page}/${page}.html`);

      expect(html).toContain(`href="${page}.css"`);
      expect(html).toContain(`src="${page}.js"`);
      expect(html).not.toContain('src="dist/');
    }

    expect(readText("src/settings/settings.html")).toContain('href="popup.html"');
  });

  it("imports shared page UI before page-specific CSS", () => {
    for (const page of PAGE_NAMES) {
      const css = readText(`src/${page}/${page}.css`);
      expect(css.startsWith('@import "../shared/ui.css";')).toBe(true);
    }
  });

  it("imports content style sections in the original rule order (rule 11)", () => {
    const css = readText("src/content/content.css");
    const imports = [...css.matchAll(/@import "\.\/styles\/([a-z-]+)\.css";/g)].map((m) => m[1]);
    expect(imports).toEqual(["bidi", "streaming", "focus", "theme-transitions", "platform-fixes"]);
  });
});
