import type { Platform } from "./platform";

// Platform-drift contract: the critical DOM anchors that plan/usage detection
// depends on. The tracker self-check (src/tracker/contract.ts) verifies the
// required anchors still resolve and publishes the verdict to
// <html data-aleph-contract*>; the `platform-contract` regression check
// (tests/checks.md) reads that attribute — no selector mirroring. When a platform
// reworks its DOM (as Gemini did), a missing anchor surfaces immediately by name
// instead of detection silently returning nothing.
//
// Each anchor has a ROLE, because "present" means different things per anchor:
//  - "required": must resolve whenever a signed-in user is on the app (the
//    account container plan detection reads). Its absence is drift.
//  - "witness": proves we're on the instrumented app at all (the composer). Never
//    required itself — settings/empty pages legitimately lack it — but if NO anchor
//    of any role resolves we treat the page as "not the app" and skip the verdict,
//    so a missing required anchor reads as real drift rather than an off-app page.
//  - "paidOnly": only renders for paying users (the Gemini tier badge), so it can't
//    be plain required (free users would false-fail) nor ignored (a moved badge
//    would slip through). It is treated as required ONLY when this platform's stored
//    plan is a paid tier — which persists across the break since detection returns
//    null, not "free", when the badge is unreadable (see detectGeminiSubscription).
export interface ContractAnchor {
  key: string;
  selectors: string[]; // one-of: the anchor is present if ANY selector resolves
  role: "required" | "witness" | "paidOnly";
}

export const PLATFORM_CONTRACT: Record<Platform, ContractAnchor[]> = {
  claude: [
    { key: "composer", selectors: [".ProseMirror", '[contenteditable="true"]'], role: "witness" },
    { key: "accountMenu", selectors: ['[data-testid="user-menu-button"]'], role: "required" },
  ],
  chatgpt: [
    { key: "composer", selectors: ["#prompt-textarea", ".ProseMirror"], role: "witness" },
    { key: "accountMenu", selectors: ['[data-testid="accounts-profile-button"]'], role: "required" },
  ],
  gemini: [
    { key: "composer", selectors: [".ql-editor", "rich-textarea"], role: "witness" },
    { key: "accountMenu", selectors: [".mavatar-user-info"], role: "required" },
    // The signal plan detection reads — required for paid accounts only.
    { key: "tierBadge", selectors: [".mavatar-tier-label"], role: "paidOnly" },
  ],
};
