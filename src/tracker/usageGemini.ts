import { send } from "./send";

// ── Gemini real usage polling ───────────────────────────
// Fetches qpEbW RPC which returns the quota table.
// WIZ_global_data lives in page context (MAIN world), but content scripts
// run in ISOLATED world — so we extract the values from <script> tags in the DOM.
function getGeminiSessionData() {
  const scripts = document.querySelectorAll("script");
  let sid = "", at = "", bl = "";
  bl = getGeminiBuildLabel();
  for (const s of scripts) {
    const text = s.textContent || "";
    if (!text.includes("WIZ_global_data")) continue;
    const sidMatch = text.match(/FdrFJe["']?\s*[:=]\s*["']([^"']+)["']/);
    const atMatch = text.match(/SNlM0e["']?\s*[:=]\s*["']([^"']+)["']/);
    const blMatch = text.match(/boq_assistant-bard-web-server_[^"'\\\s&]+/);
    if (sidMatch) sid = sidMatch[1];
    if (atMatch) at = atMatch[1];
    if (!bl && blMatch) bl = blMatch[0];
    break;
  }
  return { sid, at, bl };
}

function getGeminiBuildLabel() {
  const re = /boq_assistant-bard-web-server_[^"'\\\s&]+/;
  try {
    const entries = performance.getEntriesByType("resource") || [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i].name || "";
      const m = name.match(re);
      if (m) return decodeURIComponent(m[0]);
    }
  } catch (e) {}
  for (const s of document.querySelectorAll("script[src]")) {
    const m = (s.src || "").match(re);
    if (m) return decodeURIComponent(m[0]);
  }
  return "";
}

// qpEbW row schema (verified 2026-06 by replaying the app's own calls):
// [featureDescriptor, poolType, ?, [resetSec, resetNanos], limit, remaining]
// Current accounts report ONE account-wide daily credit pool — with our "[]"
// payload its featureDescriptor is empty. Premium usage drains the pool
// (measured: Pro message ≈ 19 credits, Flash-Lite message 0); per-feature
// rows ([null, featureId]) are a legacy shape kept as a fallback.
const GEMINI_FEATURE_NAMES = {
  4: "Pro 3.1", 15: "Thinking", 25: "Chat", 7: "Flash",
  13: "Extended", 16: "Agent", 9: "Images", 21: "Image Edit",
  17: "Music 30s", 24: "Screen", 26: "Audio", 14: "Slides",
  19: "Music Full", 8: "Notebook", 11: "Live",
  3: "Video Pro", 18: "Video", 5: "Video Lite", 12: "Ultra Only",
};

// Pure parse of the decoded qpEbW payload — exported for unit tests.
export function parseGeminiQuotas(quotas: any) {
  const features = [];
  let credits = null;
  if (!Array.isArray(quotas) || !Array.isArray(quotas[0])) return { credits, features };
  for (const q of quotas[0]) {
    if (!Array.isArray(q) || q.length < 6) continue;
    const featureId = q[0]?.[1];
    const resetTs = q[3]?.[0];
    const limit = q[4];
    const remaining = q[5];
    if (typeof limit !== "number" || typeof remaining !== "number") continue;
    if (limit === 0) continue;
    const resetsAt = resetTs ? new Date(resetTs * 1000).toISOString() : null;
    if (featureId == null) {
      credits = { limit, remaining, used: Math.max(0, limit - remaining), resetsAt };
      continue;
    }
    features.push({
      id: featureId,
      name: GEMINI_FEATURE_NAMES[featureId] || "Feature " + featureId,
      limit, remaining,
      resetsAt,
    });
  }
  features.sort((a, b) => b.limit - a.limit);
  return { credits, features };
}

export function pollGeminiUsage() {
  const { sid, at, bl } = getGeminiSessionData();
  if (!sid) return;
  const body = new URLSearchParams();
  body.append("f.req", JSON.stringify([[["qpEbW", "[]", null, "generic"]]]));
  body.append("at", at);
  let url = "/_/BardChatUi/data/batchexecute?rpcids=qpEbW&source-path=" + encodeURIComponent(location.pathname || "/app");
  if (bl) url += "&bl=" + encodeURIComponent(bl);
  url += "&f.sid=" + encodeURIComponent(sid) + "&hl=" + encodeURIComponent(document.documentElement.lang || "en") + "&_reqid=" + Math.floor(Math.random() * 9999999) + "&rt=c";
  fetch(url, {
    method: "POST", credentials: "same-origin", body,
  })
    .then((r) => r.text())
    .then((raw) => {
      const lines = raw.split("\n").filter((l) => l.trim());
      let parsed = null;
      for (const line of lines) {
        try { const j = JSON.parse(line); if (Array.isArray(j)) { parsed = j; break; } } catch (e) {}
      }
      if (!parsed) return;
      const dataStr = parsed[0]?.[2];
      if (!dataStr) return;
      let quotas;
      try { quotas = JSON.parse(dataStr); } catch (e) { return; }
      if (!Array.isArray(quotas) || !Array.isArray(quotas[0])) return;

      const { credits, features } = parseGeminiQuotas(quotas);
      send({
        type: "insights-usage", platform: "gemini",
        usage: {
          source: "provider",
          credits,
          features,
          mainChat: features[0] || null,
          activeModel: document.querySelector(".input-area-switch")?.textContent?.trim() || null,
          buildLabel: bl || null,
        },
      });
    })
    .catch(() => {});
}
