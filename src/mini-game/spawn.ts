import { MINI_GAME_OVERLAY_ID } from "../shared/domIds";
import { startSnake } from "./snake";
import { startMinesweeper } from "./minesweeper";

const DRAG_HOLD_MS = 1500;

export interface GameCallbacks {
  onGameOver: () => void;
}

export interface GameDef {
  width: number;
  height: number;
  start: (container: HTMLElement, callbacks: GameCallbacks) => () => void;
}

const GAMES: Record<string, GameDef> = {
  snake:       { width: 200, height: 200, start: startSnake },
  minesweeper: { width: 180, height: 210, start: startMinesweeper },
};

// Single owner of the game-active flag; the spawn trigger in index.ts reads
// it through isGameActive().
let gameActive = false;

export function isGameActive() {
  return gameActive;
}

export function spawnGame() {
  gameActive = true;

  const keys = Object.keys(GAMES);
  const gameName = keys[Math.floor(Math.random() * keys.length)];
  const gameDef = GAMES[gameName];

  const overlay = document.createElement("div");
  overlay.id = MINI_GAME_OVERLAY_ID;
  const w = gameDef.width;
  const h = gameDef.height;
  overlay.style.cssText =
    "position:fixed;z-index:999999;" +
    "left:" + Math.round((window.innerWidth - w) / 2) + "px;" +
    "top:" + Math.round((window.innerHeight - h) / 2) + "px;" +
    "width:" + w + "px;height:" + h + "px;" +
    "border:2px solid #7c83ff;border-radius:12px;" +
    "box-shadow:0 8px 32px rgba(0,0,0,0.6);" +
    "background:#1a1a2e;overflow:hidden;" +
    "opacity:0;transition:opacity 0.3s;";
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = "1"; });

  // Start game via standardized interface
  const callbacks: GameCallbacks = { onGameOver: dismiss };

  let container: HTMLElement = overlay;
  if (gameName === "snake") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    overlay.appendChild(canvas);
    container = canvas;
  }
  const cleanup = gameDef.start(container, callbacks);

  // ── ESC handler
  const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
  document.addEventListener("keydown", escHandler);

  // ── Mouse enter/leave
  let mouseEntered = false;
  overlay.addEventListener("mouseenter", () => {
    console.log("[Aleph MiniGame] mouse enter");
    mouseEntered = true;
  });
  overlay.addEventListener("mouseleave", () => {
    if (!mouseEntered) return;
    console.log("[Aleph MiniGame] mouse exit");
  });

  // ── Drag to reposition
  let dragState: "holding" | "dragging" | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  overlay.addEventListener("mousedown", (e) => {
    dragState = "holding";
    const startX = e.clientX;
    const startY = e.clientY;
    holdTimer = setTimeout(() => {
      if (dragState !== "holding") return;
      dragState = "dragging";
      overlay.style.cursor = "grabbing";
      const rect = overlay.getBoundingClientRect();
      dragOffsetX = startX - rect.left;
      dragOffsetY = startY - rect.top;
      console.log("[Aleph MiniGame] drag mode activated");
    }, DRAG_HOLD_MS);
  });

  function dragMove(e: MouseEvent) {
    if (dragState !== "dragging") return;
    e.preventDefault();
    const maxLeft = window.innerWidth - overlay.offsetWidth;
    const maxTop = window.innerHeight - overlay.offsetHeight;
    overlay.style.left = Math.max(0, Math.min(e.clientX - dragOffsetX, maxLeft)) + "px";
    overlay.style.top = Math.max(0, Math.min(e.clientY - dragOffsetY, maxTop)) + "px";
  }

  function dragEnd() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (dragState === "dragging") {
      overlay.style.cursor = "";
      console.log("[Aleph MiniGame] drag ended");
    }
    dragState = null;
  }

  document.addEventListener("mousemove", dragMove);
  document.addEventListener("mouseup", dragEnd);

  // ── Dismiss
  function dismiss() {
    if (!gameActive) return;
    console.log("[Aleph MiniGame] dismiss");
    gameActive = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    document.removeEventListener("keydown", escHandler);
    document.removeEventListener("mousemove", dragMove);
    document.removeEventListener("mouseup", dragEnd);
    if (cleanup) cleanup();
    overlay.style.transition = "opacity 0.3s";
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 300);
  }
}
