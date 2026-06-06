import { SELECTORS } from "../shared/selectors";
import { PLATFORM } from "./platform";

// ── Platform-specific selectors ────────────────────────────────────────
// Import-time index is null-safe: in node PLATFORM is null so SEL is
// undefined, and nothing dereferences it outside browser-only code paths.
export const SEL = SELECTORS[PLATFORM];
