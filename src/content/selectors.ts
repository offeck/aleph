import { SELECTORS, type SelectorSet } from "../shared/selectors";
import { PLATFORM } from "./platform";

// ── Platform-specific selectors ────────────────────────────────────────
// SEL is only dereferenced from boot-gated browser code (index.ts refuses to
// start without a platform). Under node imports (vitest) PLATFORM is null and
// SEL is undefined at runtime — the cast below localizes that contract to
// this single line instead of scattering non-null assertions through every
// consumer. Do NOT touch SEL from import-time/module-scope code.
export const SEL: SelectorSet = (PLATFORM ? SELECTORS[PLATFORM] : undefined) as SelectorSet;
