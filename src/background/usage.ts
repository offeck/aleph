import { todayKey } from "../shared/dates";
import { alephSync } from "./sync";

// ── Usage day storage ────────────────────────────────────
export interface Sends {
  total: number;
  rtl: number;
  totalWords: number;
  totalChars: number;
}

export interface Timing {
  count: number;
  totalTTFT: number;
  totalThinking: number;
  totalSendToThinking: number;
  approximate?: boolean;
}

export interface PlatformDay {
  totalSeconds: number;
  messageCount: number;
  hours: Record<string, number>;
  tokensIn: number;
  tokensOut: number;
  textTokensIn: number;
  textTokensOut: number;
  imageTokensIn: number;
  imageTokensOut: number;
  fileTokensIn: number;
  fileTokensOut: number;
  imageCountIn: number;
  imageCountOut: number;
  fileCountIn: number;
  fileCountOut: number;
  estimateSource: string;
  sends?: Sends;
  timing?: Timing;
  // Sync merges may carry additional counter fields; tolerate them.
  [extra: string]: unknown;
}

export type UsageDay = Record<string, PlatformDay>;

export function emptyPlatformDay(): PlatformDay {
  return {
    totalSeconds: 0,
    messageCount: 0,
    hours: {},
    tokensIn: 0,
    tokensOut: 0,
    textTokensIn: 0,
    textTokensOut: 0,
    imageTokensIn: 0,
    imageTokensOut: 0,
    fileTokensIn: 0,
    fileTokensOut: 0,
    imageCountIn: 0,
    imageCountOut: 0,
    fileCountIn: 0,
    fileCountOut: 0,
    estimateSource: "local",
  };
}

export function normalizeSends(sends: Partial<Sends> & { hebrew?: number } | undefined): Sends {
  const s = sends || {};
  return {
    total: s.total || 0,
    rtl: s.rtl ?? s.hebrew ?? 0,
    totalWords: s.totalWords || 0,
    totalChars: s.totalChars || 0,
  };
}

export async function readLocal<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get({ [key]: fallback });
  return result[key] as T;
}

export async function writeLocal(key: string, value: unknown) {
  await chrome.storage.local.set({ [key]: value });
  if (key.startsWith("usage_") || key === "insights_subscriptions") {
    try { alephSync.maybePush(key, value); } catch (e) {}
  }
}

export function ensurePlatformDay(usage: UsageDay, platform: string): PlatformDay {
  if (!usage[platform]) usage[platform] = emptyPlatformDay();
  const day = usage[platform];
  const defaults = emptyPlatformDay();
  for (const [key, value] of Object.entries(defaults)) {
    if (day[key] == null) day[key] = Array.isArray(value) ? [] : (typeof value === "object" && value !== null ? Object.assign({}, value) : value);
  }
  return day;
}

export function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function addNonNegative(target: Record<string, unknown>, key: string, delta: unknown) {
  target[key] = Math.max(0, numberOrZero(target[key]) + numberOrZero(delta));
}

// Serializes all daily-usage read-modify-write cycles so concurrent platform
// tabs cannot lose increments.
let usageUpdateQueue: Promise<unknown> = Promise.resolve();

export function updateUsageDay(updater: (usage: UsageDay) => void | Promise<void>): Promise<{ key: string; usage: UsageDay }> {
  const run = usageUpdateQueue.catch(() => {}).then(async () => {
    const key = todayKey();
    const usage = await readLocal<UsageDay>(key, {});
    await updater(usage);
    await writeLocal(key, usage);
    return { key, usage };
  });
  usageUpdateQueue = run.catch(() => {});
  return run;
}
