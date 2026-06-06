import { send } from "./send";
import { PLATFORM } from "./platform";

// ── Response timing (TTFT + thinking duration) ──────────
const THINKING_SEL = {
  claude: '[aria-label="Stop response"]',
  chatgpt: '[aria-label="Stop streaming"], [aria-label*="Stop" i]',
  gemini: '.send-button.stop',
};

let responseTimingActive = false;
let thinkingStartedAt = 0;
let msgCountAtSend = 0;
let userSentAt = 0;

const ASSISTANT_SEL = '[data-message-author-role="assistant"], .font-claude-response, .response-content';

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
  responseTimingActive = true;
  thinkingStartedAt = 0;
  msgCountAtSend = document.querySelectorAll(ASSISTANT_SEL).length;
}

function detectFirstToken() {
  const msgs = document.querySelectorAll(ASSISTANT_SEL);
  if (msgs.length <= msgCountAtSend) return false;
  const last = msgs[msgs.length - 1];
  if (!last) return false;

  if (PLATFORM === "chatgpt") {
    const markdowns = last.querySelectorAll('.markdown');
    const lastMd = markdowns.length ? markdowns[markdowns.length - 1] : null;
    const p = lastMd ? lastMd.querySelector('p') : null;
    return p ? p.textContent.trim().length > 20 : false;
  }

  const p = last.querySelector('p');
  const threshold = PLATFORM === "gemini" ? 10 : 5;
  return p ? p.textContent.trim().length > threshold : false;
}

export function startResponseTiming() {
  setInterval(() => {
    if (!userSentAt || !responseTimingActive) return;
    const elapsed = Date.now() - userSentAt;
    const sel = THINKING_SEL[PLATFORM];

    if (!thinkingStartedAt) {
      if (sel && document.querySelector(sel)) {
        thinkingStartedAt = Date.now();
        document.documentElement.setAttribute("data-aleph-thinking", "true");
        console.log("[Aleph] thinking started (stop button appeared)");
      }
    }

    if (thinkingStartedAt) {
      if (detectFirstToken()) {
        send({
          type: "insights-response-timing",
          platform: PLATFORM,
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
