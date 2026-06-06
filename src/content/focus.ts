import { PLATFORM } from "./platform";
import { SEL } from "./selectors";
import { getSettings } from "./settingsStore";

// ── Focus Mode ─────────────────────────────────────────────────────────
export function applyFocusMode() {
  const settings = getSettings();
  const cats = SEL.focusHide;
  const selectors = [];
  if (settings.focusHideUpgrade && cats.upgrade) selectors.push(...cats.upgrade);
  if (settings.focusHideChips && cats.chips) selectors.push(...cats.chips);
  if (settings.focusHidePromos && cats.promos) selectors.push(...cats.promos);

  selectors.forEach((sel) => {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        if (!el.hasAttribute("data-aleph-hidden")) {
          el.setAttribute("data-aleph-hidden", "true");
        }
      });
    } catch (e) {}
  });

  if (PLATFORM === "chatgpt" && settings.focusHideUpgrade) {
    document.querySelectorAll("button, a, [role='menuitem'], .trailing").forEach((el) => {
      const txt = el.textContent.trim();
      if (txt === "Upgrade" || txt === "Upgrade plan" || txt === "Get Plus") {
        const target = el.closest(".group, .trailing, header .pointer-events-none") || el;
        if (!target.hasAttribute("data-aleph-hidden")) {
          target.setAttribute("data-aleph-hidden", "true");
        }
      }
    });
  }
}
