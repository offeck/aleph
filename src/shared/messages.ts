// Message field lists describe what senders actually put on the wire today
// (tracker/content) and what the background router reads — they must never
// be used to change wire shapes (types describe, not change; see CLAUDE.md).

export interface InsightsMessagePayload {
  type: "insights-message";
  platform: string;
  role: string;
  estimatedTokens?: number;
  estimatedTextTokens?: number;
  estimatedImageTokens?: number;
  estimatedFileTokens?: number;
  /** Legacy field names the router still accepts. */
  textTokens?: number;
  imageTokens?: number;
  fileTokens?: number;
  imageCount?: number;
  fileCount?: number;
  estimateSource?: string;
  model?: string | null;
  timestamp?: number;
  isUpdate?: boolean;
  tokenDelta?: number;
  textTokenDelta?: number;
  imageTokenDelta?: number;
  fileTokenDelta?: number;
  imageCountDelta?: number;
  fileCountDelta?: number;
}

export type ContentToBackgroundMessage =
  | { type: "disabled" }
  | { type: "badge"; count: number }
  | { type: "insights-time"; platform: string; seconds: number; hour: number }
  | { type: "insights-send-analytics"; platform: string; lang?: string; length?: number; words?: number; timestamp?: number }
  | { type: "insights-response-timing"; platform: string; sendToThinking?: number; thinkingToFirstToken?: number; totalTTFT?: number; timestamp?: number }
  | InsightsMessagePayload
  | { type: "insights-subscription"; platform: string; plan?: string; price?: number; label?: string; model?: string | null }
  | { type: "insights-model-caps"; platform: string; caps?: Record<string, unknown> };

export type PageToBackgroundMessage =
  | { type: "insights-get-summary" }
  | { type: "insights-refresh-usage" }
  | { type: "aleph-sync-status" }
  | { type: "aleph-sync-signin" }
  | { type: "aleph-sync-signout" }
  | { type: "aleph-sync-now" }
  | { type: "aleph-antigravity-connect" }
  | { type: "aleph-antigravity-status" }
  | { type: "aleph-antigravity-set-secret"; secret: string }
  | { type: "aleph-antigravity-disconnect" };

export interface AntigravityStatusResponse {
  connected: boolean;
  // Whether the Connect CTA should show — a borrowed client secret is available
  // without a network fetch: either a user-pasted override (Settings, local-only)
  // or one fetched from Firestore and cached (primed once at boot). See
  // antigravityAuth.getAntigravityAuthStatus.
  configured: boolean;
  email?: string | null;
  connectedAt?: number | null;
}

export type UsageRefreshReason = "throttled" | "missing-auth" | "no-data" | "error";

export interface UsageRefreshResponse {
  refreshed: boolean;
  platforms?: Record<string, { refreshed: boolean; reason?: UsageRefreshReason }>;
}

export type BackgroundToContentMessage = { type: "toggle" };

export type ExternalMessage = { type: "aleph-reload" };

export type AlephMessage =
  | ContentToBackgroundMessage
  | PageToBackgroundMessage
  | BackgroundToContentMessage
  | ExternalMessage;

export interface StoredRemark {
  text: string;
  category: string;
  generatedAt: number;
}

// Response shape of the background `insights-get-summary` handler. The leaf
// values are raw storage JSON (usage_ docs, provider snapshots, stored
// subscriptions) — boundary `any` records read defensively by popup/insights.
export interface InsightsSummary {
  subs: Record<string, any>;
  today: Record<string, any>;
  remark: StoredRemark | null;
  weekData: Record<string, any>;
  prevWeekData: Record<string, any>;
  platformUsage: Record<string, any>;
  modelCaps: Record<string, any>;
}
