import { USER_MESSAGE_SEL } from "../shared/messageMarkers";
import { detectPlatform } from "../shared/platform";
import { makeSpawnLatch } from "./latch";
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

  // Cycle boundary = USER message count (shared markers in
  // src/shared/messageMarkers.ts). User bubbles render synchronously at send
  // and never mount mid-response — unlike assistant nodes, which can appear
  // after the game already spawned (e.g. ChatGPT thinking models) and would
  // falsely re-arm the latch during the same cycle.
  const userMessageCount = () =>
    document.querySelectorAll(USER_MESSAGE_SEL).length;

  // ── Spawn trigger ────────────────────────────────────────────────────
  // One game per message sent: spawnLatch is spent at spawn and re-arms
  // only when a new user message appears (see latch.ts) — so losing,
  // winning, or ESC-dismissing a game mid-response never respawns one.
  let spawnPending = false;
  const spawnLatch = makeSpawnLatch();
  let lastSpawnCheck = 0;
  let recheckQueued = false;

  function trySpawn() {
    if (!miniGameEnabled) return;
    if (isGameActive()) return;
    if (spawnPending) return;
    lastSpawnCheck = Date.now();
    if (!isThinking()) return;
    if (spawnLatch.spent(userMessageCount)) return;
    spawnPending = true;
    console.log("[Aleph MiniGame] thinking detected!");
    setTimeout(() => {
      const stillThinking = isThinking();
      console.log("[Aleph MiniGame] after 500ms: stillThinking=" + stillThinking + " gameActive=" + isGameActive());
      spawnPending = false;
      if (isGameActive()) return;
      if (!stillThinking) return;
      console.log("[Aleph MiniGame] spawning game!");
      spawnLatch.spend(userMessageCount());
      spawnGame();
    }, 500);
  }

  new MutationObserver(() => {
    if (!miniGameEnabled) return;
    if (isGameActive()) return;
    if (spawnPending) return;
    // Mutation batches arrive continuously while streaming — throttle the
    // querySelector work to at most twice per second. A throttled signal is
    // never dropped: one trailing re-check runs after the window, so a stop
    // button that appears right after an unrelated mutation (and a thinking
    // period with no further DOM churn) still spawns.
    const now = Date.now();
    if (now - lastSpawnCheck < 500) {
      if (!recheckQueued) {
        recheckQueued = true;
        setTimeout(() => { recheckQueued = false; trySpawn(); }, 500);
      }
      return;
    }
    trySpawn();
  }).observe(document.body, { childList: true, subtree: true });
})();
