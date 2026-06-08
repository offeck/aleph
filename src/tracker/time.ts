import { send } from "./send";
import type { Platform } from "../shared/platform";

// ── Time tracking ────────────────────────────────────────
let isActive = false;
let lastTickTime: number | null = null;
let pendingSeconds = 0;
let activePlatform: Platform | null = null;
const FLUSH_INTERVAL = 30000;

function activate() {
  if (isActive) return;
  isActive = true;
  lastTickTime = Date.now();
}

function deactivate() {
  if (!isActive) return;
  tick();
  flush();
  isActive = false;
  lastTickTime = null;
}

function tick() {
  if (!isActive || !lastTickTime) return;
  const now = Date.now();
  const delta = Math.min((now - lastTickTime) / 1000, 5);
  if (delta > 0) pendingSeconds += delta;
  lastTickTime = now;
}

function flush() {
  if (pendingSeconds < 1) return;
  const seconds = Math.round(pendingSeconds);
  pendingSeconds = 0;
  if (!activePlatform) return;
  send({
    type: "insights-time",
    platform: activePlatform,
    seconds,
    hour: new Date().getHours(),
  });
}

export function startTimeTracking(platform: Platform) {
  activePlatform = platform;
  isActive = document.visibilityState === "visible" && document.hasFocus();
  lastTickTime = isActive ? Date.now() : null;

  document.addEventListener("visibilitychange", () => {
    document.visibilityState === "visible" ? activate() : deactivate();
  });
  window.addEventListener("focus", activate);
  window.addEventListener("blur", deactivate);
  window.addEventListener("beforeunload", () => { tick(); flush(); });

  setInterval(tick, 1000);
  setInterval(flush, FLUSH_INTERVAL);
}
