import { detectPlatform } from "../shared/platform";
import { isGameActive, spawnGame } from "./spawn";

(function () {
  const PLATFORM = detectPlatform(location.hostname);
  if (!PLATFORM) return;

  let miniGameEnabled = false;
  if (chrome?.storage?.sync) {
    chrome.storage.sync.get({ miniGame: false }, (s) => { miniGameEnabled = s.miniGame; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.miniGame) miniGameEnabled = changes.miniGame.newValue;
    });
  }

  // ── Detection ────────────────────────────────────────────────────────
  const THINKING_SEL: Record<string, string> = {
    claude: '[aria-label="Stop response"]',
    chatgpt: '[aria-label="Stop streaming"], [aria-label*="Stop" i]',
    gemini: '.send-button.stop',
  };

  function isThinking() {
    // PLATFORM is non-null past the boot guard, but narrowing doesn't reach
    // into this closure — same guard pattern as the tracker modules.
    const sel = PLATFORM ? THINKING_SEL[PLATFORM] : undefined;
    return sel ? !!document.querySelector(sel) : false;
  }

  // ── Spawn trigger ────────────────────────────────────────────────────
  let spawnPending = false;

  new MutationObserver(() => {
    if (!miniGameEnabled) return;
    if (isGameActive()) return;
    if (!isThinking()) return;
    if (spawnPending) return;
    spawnPending = true;
    console.log("[Aleph MiniGame] thinking detected!");
    setTimeout(() => {
      const stillThinking = isThinking();
      console.log("[Aleph MiniGame] after 500ms: stillThinking=" + stillThinking + " gameActive=" + isGameActive());
      spawnPending = false;
      if (isGameActive()) return;
      if (!stillThinking) return;
      console.log("[Aleph MiniGame] spawning game!");
      spawnGame();
    }, 500);
  }).observe(document.body, { childList: true, subtree: true });
})();
