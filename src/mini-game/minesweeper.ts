import type { GameCallbacks } from "./spawn";

// ── Board helpers (pure — exported for unit tests) ───────────────────

// All in-bounds neighbors of `id` on a width-wide grid with `cellCount`
// cells. Shared by flood-reveal and chording.
export function neighborIds(id: number, width: number, cellCount: number): number[] {
  const isLeft = id % width === 0;
  const isRight = id % width === width - 1;
  const ids: number[] = [];
  if (!isLeft) ids.push(id - 1);
  if (!isRight && id + 1 < cellCount) ids.push(id + 1);
  if (id >= width) {
    ids.push(id - width);
    if (!isLeft) ids.push(id - width - 1);
    if (!isRight) ids.push(id - width + 1);
  }
  if (id + width < cellCount) {
    ids.push(id + width);
    if (!isLeft) ids.push(id + width - 1);
    if (!isRight) ids.push(id + width + 1);
  }
  return ids;
}

export interface NeighborState {
  id: number;
  flagged: boolean;
  checked: boolean;
}

// Chording rule: clicking a revealed number whose adjacent flag count equals
// that number opens every unflagged, unrevealed neighbor (a misplaced flag
// makes this click hit a bomb — same as the real game). Returns the ids to
// open, or [] when the flag count doesn't match.
export function chordTargets(neighbors: NeighborState[], count: number): number[] {
  if (count <= 0) return [];
  const flagged = neighbors.filter((n) => n.flagged).length;
  if (flagged !== count) return [];
  return neighbors.filter((n) => !n.flagged && !n.checked).map((n) => n.id);
}

// ── Minesweeper ──────────────────────────────────────────────────────
export function startMinesweeper(container: HTMLElement, callbacks: GameCallbacks) {
  const width = 6;
  const bombAmount = 5;
  const cellSize = 28;
  const squares: HTMLDivElement[] = [];
  let flags = 0;
  let isGameOver = false;

  const gridEl = document.createElement("div");
  gridEl.style.cssText =
    "display:grid;grid-template-columns:repeat(" + width + "," + cellSize + "px);" +
    "gap:2px;padding:6px;justify-content:center;";

  const bombsArray = Array(bombAmount).fill("bomb");
  const emptyArray = Array(width * width - bombAmount).fill("valid");
  const shuffled = emptyArray.concat(bombsArray).sort(() => Math.random() - 0.5);

  for (let i = 0; i < width * width; i++) {
    const sq = document.createElement("div");
    sq.setAttribute("data-id", String(i));
    sq.setAttribute("data-type", shuffled[i]);
    sq.style.cssText =
      "width:" + cellSize + "px;height:" + cellSize + "px;" +
      "background:#2a2a4a;border-radius:3px;cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;" +
      "font-size:13px;font-weight:bold;color:#ccc;user-select:none;";

    sq.addEventListener("click", () => clickCell(sq));
    sq.addEventListener("contextmenu", (e) => { e.preventDefault(); addFlag(sq); });

    gridEl.appendChild(sq);
    squares.push(sq);
  }

  for (let i = 0; i < squares.length; i++) {
    if (squares[i].getAttribute("data-type") !== "valid") continue;
    let total = 0;
    const isLeft = i % width === 0;
    const isRight = i % width === width - 1;
    if (!isLeft && i > 0 && squares[i - 1].getAttribute("data-type") === "bomb") total++;
    if (!isRight && i > width - 1 && squares[i + 1 - width].getAttribute("data-type") === "bomb") total++;
    if (i >= width && squares[i - width].getAttribute("data-type") === "bomb") total++;
    if (!isLeft && i > width && squares[i - 1 - width].getAttribute("data-type") === "bomb") total++;
    if (!isRight && i < squares.length - 1 && squares[i + 1].getAttribute("data-type") === "bomb") total++;
    if (!isLeft && i + width < squares.length && squares[i - 1 + width]?.getAttribute("data-type") === "bomb") total++;
    if (!isRight && i + width + 1 < squares.length && squares[i + 1 + width]?.getAttribute("data-type") === "bomb") total++;
    if (i + width < squares.length && squares[i + width].getAttribute("data-type") === "bomb") total++;
    squares[i].setAttribute("data-count", String(total));
  }

  container.appendChild(gridEl);

  const COLORS: Record<number, string> = { 1: "#6ee7b7", 2: "#93c5fd", 3: "#fca5a5", 4: "#c4b5fd" };

  function clickCell(sq: HTMLDivElement) {
    if (isGameOver) return;
    if (sq.getAttribute("data-flag")) return;
    if (sq.getAttribute("data-checked")) {
      chordCell(sq);
      return;
    }
    if (sq.getAttribute("data-type") === "bomb") {
      isGameOver = true;
      console.log("[Aleph MiniGame] minesweeper: bomb hit!");
      squares.forEach((s) => {
        if (s.getAttribute("data-type") === "bomb") {
          s.textContent = "💣";
          s.style.background = "#4a1a1a";
        }
      });
      setTimeout(callbacks.onGameOver, 800);
      return;
    }
    const total = parseInt(sq.getAttribute("data-count") || "0");
    sq.setAttribute("data-checked", "true");
    sq.style.background = "#22224a";
    sq.style.cursor = "default";
    if (total > 0) {
      sq.textContent = String(total);
      sq.style.color = COLORS[total] || "#ccc";
    } else {
      revealNeighbors(parseInt(sq.getAttribute("data-id")!));
    }
    checkForWin();
  }

  function revealNeighbors(id: number) {
    const neighbors = neighborIds(id, width, squares.length);
    setTimeout(() => { neighbors.forEach((n) => clickCell(squares[n])); }, 10);
  }

  // Chord (clicked an already-revealed number): when its adjacent flag count
  // matches, open all unflagged unrevealed neighbors via clickCell — bombs
  // under wrong flags end the game and zeros flood-reveal, as in the real
  // game. No-op when the flags don't match the number.
  function chordCell(sq: HTMLDivElement) {
    const count = parseInt(sq.getAttribute("data-count") || "0");
    const neighbors = neighborIds(parseInt(sq.getAttribute("data-id")!), width, squares.length).map((n) => ({
      id: n,
      flagged: !!squares[n].getAttribute("data-flag"),
      checked: !!squares[n].getAttribute("data-checked"),
    }));
    chordTargets(neighbors, count).forEach((n) => clickCell(squares[n]));
  }

  function addFlag(sq: HTMLDivElement) {
    if (isGameOver || sq.getAttribute("data-checked")) return;
    if (!sq.getAttribute("data-flag") && flags < bombAmount) {
      sq.setAttribute("data-flag", "true");
      sq.textContent = "🚩";
      flags++;
      checkForWin();
    } else if (sq.getAttribute("data-flag")) {
      sq.removeAttribute("data-flag");
      sq.textContent = "";
      flags--;
    }
  }

  function checkForWin() {
    let matches = 0;
    for (let i = 0; i < squares.length; i++) {
      if (squares[i].getAttribute("data-flag") && squares[i].getAttribute("data-type") === "bomb") matches++;
    }
    if (matches === bombAmount) {
      isGameOver = true;
      console.log("[Aleph MiniGame] minesweeper: you won!");
      setTimeout(callbacks.onGameOver, 600);
    }
  }

  return function cleanup() {
    isGameOver = true;
  };
}
