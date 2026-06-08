import { send } from "./send";
import type { ResponseTimingConfig } from "./platformAdapters";

// ── Response timing (TTFT + thinking duration) ──────────
let responseTimingActive = false;
let thinkingStartedAt = 0;
let msgCountAtSend = 0;
let userSentAt = 0;
let timingConfig: ResponseTimingConfig | null = null;

// userSentAt is owned here (timing is its primary consumer); messages.ts
// records sends via markUserSent() and reads via getUserSentAt().
export function markUserSent() {
  userSentAt = Date.now();
  return userSentAt;
}

export function getUserSentAt() {
  return userSentAt;
}

export function beginResponseTiming() {
  if (!timingConfig) return;
  responseTimingActive = true;
  thinkingStartedAt = 0;
  msgCountAtSend = document.querySelectorAll(timingConfig.assistantSelector).length;
}

function detectFirstToken(config: ResponseTimingConfig) {
  const msgs = document.querySelectorAll(config.assistantSelector);
  if (msgs.length <= msgCountAtSend) return false;
  const last = msgs[msgs.length - 1];
  return last ? config.hasFirstToken(last) : false;
}

export function startResponseTiming(config: ResponseTimingConfig) {
  timingConfig = config;
  setInterval(() => {
    if (!userSentAt || !responseTimingActive || !timingConfig) return;
    const elapsed = Date.now() - userSentAt;

    if (!thinkingStartedAt) {
      if (document.querySelector(timingConfig.thinkingSelector)) {
        thinkingStartedAt = Date.now();
        document.documentElement.setAttribute("data-aleph-thinking", "true");
        console.log("[Aleph] thinking started (stop button appeared)");
      }
    }

    if (thinkingStartedAt) {
      if (detectFirstToken(timingConfig)) {
        send({
          type: "insights-response-timing",
          platform: timingConfig.platform,
          sendToThinking: thinkingStartedAt - userSentAt,
          thinkingToFirstToken: Date.now() - thinkingStartedAt,
          totalTTFT: Date.now() - userSentAt,
          timestamp: Date.now(),
        });
        console.log("[Aleph] TTFT: " + (Date.now() - userSentAt) + "ms (thinking: " + (Date.now() - thinkingStartedAt) + "ms)");
        responseTimingActive = false;
        thinkingStartedAt = 0;
        document.documentElement.removeAttribute("data-aleph-thinking");
      }
    }

    if (elapsed > 120000) {
      console.log("[Aleph] response timing timed out after 120s");
      responseTimingActive = false;
      thinkingStartedAt = 0;
      document.documentElement.removeAttribute("data-aleph-thinking");
    }
  }, 500);
}
