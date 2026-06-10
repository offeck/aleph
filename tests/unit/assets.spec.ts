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
      "https://daily-cloudcode-pa.googleapis.com/*",
      "https://cloudcode-pa.googleapis.com/*",
      "https://oauth2.googleapis.com/*",
      // Loopback OAuth callback capture for the Antigravity client (auth code read
      // from the failed-load localhost tab URL).
      "http://localhost/*",
    ]));
  });

  it("sets the antigravity/cli User-Agent on Cloud Code requests via declarativeNetRequest", () => {
    // fetchAvailableModels 403s without this exact User-Agent, which browser fetch
    // cannot set — so a static DNR modifyHeaders rule supplies it.
    const manifest = JSON.parse(readText("manifest.json"));
    // modifyHeaders via host permissions needs the WithHostAccess variant.
    expect(manifest.permissions).toContain("declarativeNetRequestWithHostAccess");
    const resources = manifest.declarative_net_request?.rule_resources || [];
    const rulePath = resources[0]?.path;
    expect(rulePath).toBe("rules/antigravity-ua.json");

    const rules = JSON.parse(readText(rulePath));
    const uaRule = rules[0];
    expect(uaRule.action.type).toBe("modifyHeaders");
    expect(uaRule.action.requestHeaders).toEqual([
      { header: "User-Agent", operation: "set", value: "antigravity/cli/1.0.7 windows/amd64" },
    ]);
    expect(uaRule.condition.requestDomains).toContain("daily-cloudcode-pa.googleapis.com");
  });

  it("keeps the chrome.identity oauth2 grant scoped to email only (sync token restore)", () => {
    // Antigravity auth uses a borrowed first-party client via launchWebAuthFlow-free
    // code capture — NOT chrome.identity — so the manifest oauth2 grant must stay
    // email-only. A cloud-platform scope here breaks getAuthToken({interactive:false})
    // for already-signed-in sync users (silent token restore in sync.ts).
    const manifest = JSON.parse(readText("manifest.json"));
    expect(manifest.oauth2.scopes).toEqual(["https://www.googleapis.com/auth/userinfo.email"]);
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
