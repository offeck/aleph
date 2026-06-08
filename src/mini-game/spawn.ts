import { MINI_GAME_OVERLAY_ID } from "../shared/domIds";
import { startSnake } from "./snake";
import { startMinesweeper } from "./minesweeper";

const HEADER_HEIGHT = 28;

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
  minesweeper: { width: 190, height: 210, start: startMinesweeper },
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
    "top:" + Math.round((window.innerHeight - h - HEADER_HEIGHT) / 2) + "px;" +
    "width:" + w + "px;height:" + (h + HEADER_HEIGHT) + "px;" +
    "border:2px solid #7c83ff;border-radius:12px;" +
    "box-shadow:0 8px 32px rgba(0,0,0,0.6);" +
    "background:#1a1a2e;overflow:hidden;" +
    "opacity:0;transition:opacity 0.3s;";

  const header = document.createElement("div");
  header.style.cssText =
    "height:" + HEADER_HEIGHT + "px;display:flex;align-items:center;justify-content:space-between;" +
    "padding:3px 4px 3px 8px;box-sizing:border-box;background:#202044;" +
    "border-bottom:1px solid rgba(124,131,255,0.35);" +
    "cursor:grab;user-select:none;";

  const title = document.createElement("div");
  title.textContent = gameName.charAt(0).toUpperCase() + gameName.slice(1);
  title.style.cssText =
    "font-size:11px;font-weight:600;letter-spacing:0.4px;" +
    "color:#8b93c9;user-select:none;";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close mini-game");
  closeButton.textContent = "×";
  closeButton.style.cssText =
    "width:22px;height:22px;border:0;border-radius:6px;padding:0;" +
    "display:flex;align-items:center;justify-content:center;" +
    "background:transparent;color:#c7d2fe;font-size:18px;line-height:1;" +
    "cursor:pointer;transition:background 0.15s,color 0.15s;";
  closeButton.addEventListener("mouseenter", () => {
    closeButton.style.background = "rgba(124,131,255,0.3)";
    closeButton.style.color = "#fff";
  });
  closeButton.addEventListener("mouseleave", () => {
    closeButton.style.background = "transparent";
    closeButton.style.color = "#c7d2fe";
  });
  closeButton.addEventListener("mousedown", (e) => e.stopPropagation());
  closeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });

  const gameArea = document.createElement("div");
  gameArea.style.cssText =
    "width:" + w + "px;height:" + h + "px;position:relative;" +
    "display:flex;align-items:center;justify-content:center;overflow:hidden;";

  header.appendChild(title);
  header.appendChild(closeButton);
  overlay.appendChild(header);
  overlay.appendChild(gameArea);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = "1"; });

  // Start game via standardized interface
  const callbacks: GameCallbacks = { onGameOver: dismiss };

  let container: HTMLElement = gameArea;
  if (gameName === "snake") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    gameArea.appendChild(canvas);
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

  // ── Drag to reposition — the header is the handle, like a window title bar.
  // It starts immediately (the header isn't part of gameplay, so there's
  // nothing to trigger accidentally) and the game area below never initiates a
  // drag, so cell clicks/chords stay fully responsive.
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener("mousedown", (e) => {
    // The close button stops propagation, so reaching here is a header grab.
    e.preventDefault();
    dragging = true;
    const rect = overlay.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    header.style.cursor = "grabbing";
    document.body.style.cursor = "grabbing";
  });

  function dragMove(e: MouseEvent) {
    if (!dragging) return;
    e.preventDefault();
    const maxLeft = window.innerWidth - overlay.offsetWidth;
    const maxTop = window.innerHeight - overlay.offsetHeight;
    overlay.style.left = Math.max(0, Math.min(e.clientX - dragOffsetX, maxLeft)) + "px";
    overlay.style.top = Math.max(0, Math.min(e.clientY - dragOffsetY, maxTop)) + "px";
  }

  function dragEnd() {
    if (!dragging) return;
    dragging = false;
    header.style.cursor = "grab";
    document.body.style.cursor = "";
  }

  document.addEventListener("mousemove", dragMove);
  document.addEventListener("mouseup", dragEnd);

  // ── Dismiss
  function dismiss() {
    if (!gameActive) return;
    console.log("[Aleph MiniGame] dismiss");
    gameActive = false;
    document.body.style.cursor = "";
    document.removeEventListener("keydown", escHandler);
    document.removeEventListener("mousemove", dragMove);
    document.removeEventListener("mouseup", dragEnd);
    if (cleanup) cleanup();
    overlay.style.transition = "opacity 0.3s";
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 300);
  }
}
