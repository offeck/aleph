import { SEL } from "./selectors";

// ── Streaming Smoothing ────────────────────────────────────────────────
export function applyStreamSmooth() {
  SEL.streaming.forEach((sel) => {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        if (!el.hasAttribute("data-aleph-stream")) {
          el.setAttribute("data-aleph-stream", "true");
        }
      });
    } catch (e) {}
  });
}
