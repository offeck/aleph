import { detectPlatform, type Platform } from "../shared/platform";

// Honest nullable type: null under node (vitest) and on unmatched hosts.
// index.ts gates all boot work on a truthy PLATFORM; platform-dependent
// helpers either narrow locally or take the documented SEL boundary.
export const PLATFORM: Platform | null = typeof location !== "undefined" ? detectPlatform(location.hostname) : null;
