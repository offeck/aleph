import { PLATFORM } from "./platform";
import { startTimeTracking } from "./time";
import { markExistingMessages, setGraceUntil, startEditorCapture, startMessageObserver, startNavRemark } from "./messages";
import { startResponseTiming } from "./timing";
import { detectClaudeViaApi, detectChatgptViaApi, detectSubscription } from "./plans";
import { pollModelCapabilities } from "./modelCaps";
import { pollClaudeUsage } from "./usageClaude";
import { pollChatgptUsage } from "./usageChatgpt";
import { pollGeminiUsage } from "./usageGemini";

// ── Boot ─────────────────────────────────────────────────
// Modules only define; everything observable starts here, gated on a
// supported platform (manifest matches keep this always-true in practice).
if (PLATFORM) {
  startTimeTracking();
  startEditorCapture();
  startResponseTiming();
  startNavRemark();

  if (PLATFORM === "claude") detectClaudeViaApi();
  if (PLATFORM === "chatgpt") detectChatgptViaApi();

  setTimeout(() => {
    detectSubscription();
    markExistingMessages();
    setGraceUntil(Date.now() + 5000);
    startMessageObserver();
    setTimeout(markExistingMessages, 5000);
    pollModelCapabilities();
    if (PLATFORM === "claude") pollClaudeUsage();
    if (PLATFORM === "chatgpt") pollChatgptUsage();
    if (PLATFORM === "gemini") pollGeminiUsage();
  }, 3000);

  setInterval(detectSubscription, 60000);
  if (PLATFORM === "claude") setInterval(pollClaudeUsage, 60000);
  if (PLATFORM === "chatgpt") setInterval(pollChatgptUsage, 60000);
  if (PLATFORM === "gemini") setInterval(pollGeminiUsage, 60000);
}
