import { detectPlatform, type Platform } from "../shared/platform";

// Guarded so vitest (node) can import content modules transitively; in the
// browser the manifest only matches supported hosts, and index.ts gates boot
// on a truthy PLATFORM, so the cast is safe everywhere code actually runs.
export const PLATFORM = (typeof location !== "undefined" ? detectPlatform(location.hostname) : null) as Platform;
