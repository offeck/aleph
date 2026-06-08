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

export function minesweeperCellCursor(checked: boolean, count: number, gameOver: boolean): "pointer" | "default" {
  if (gameOver) return "default";
  if (!checked) return "pointer";
  return count > 0 ? "pointer" : "default";
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

    // Chording is an explicit user gesture, so it dispatches HERE — never
    // inside clickCell, which is also invoked programmatically by the
    // deferred flood-reveal and by chord opens themselves. Routing chords
    // through clickCell would make every flood pass over an already-revealed
    // number auto-chord it (detonating bombs next to misplaced flags with no
    // user action).
    sq.addEventListener("click", () => {
      if (sq.getAttribute("data-checked")) chordCell(sq);
      else clickCell(sq);
    });
    sq.addEventListener("contextmenu", (e) => { e.preventDefault(); addFlag(sq); });

    gridEl.appendChild(sq);
    squares.push(sq);
  }

  // Counts use the same neighborIds as flood-reveal and chording — chording
  // trusts data-count, so adjacency must have a single source of truth.
  for (let i = 0; i < squares.length; i++) {
    if (squares[i].getAttribute("data-type") !== "valid") continue;
    let total = 0;
    for (const n of neighborIds(i, width, squares.length)) {
      if (squares[n].getAttribute("data-type") === "bomb") total++;
    }
    squares[i].setAttribute("data-count", String(total));
  }

  container.appendChild(gridEl);

  const COLORS: Record<number, string> = { 1: "#6ee7b7", 2: "#93c5fd", 3: "#fca5a5", 4: "#c4b5fd" };

  function clickCell(sq: HTMLDivElement) {
    if (isGameOver) return;
    // Hard no-op on revealed/flagged cells: revealNeighbors' deferred clicks
    // and chord opens depend on this (see the click listener for why chord
    // dispatch must not happen here).
    if (sq.getAttribute("data-checked") || sq.getAttribute("data-flag")) return;
    if (sq.getAttribute("data-type") === "bomb") {
      isGameOver = true;
      console.log("[Aleph MiniGame] minesweeper: bomb hit!");
      squares.forEach((s) => {
        if (s.getAttribute("data-type") === "bomb") {
          s.textContent = "💣";
          s.style.background = "#4a1a1a";
        }
        updateCellCursor(s);
      });
      setTimeout(callbacks.onGameOver, 800);
      return;
    }
    const total = parseInt(sq.getAttribute("data-count") || "0");
    sq.setAttribute("data-checked", "true");
    sq.style.background = "#22224a";
    updateCellCursor(sq);
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
    if (isGameOver) return;
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
    let revealed = 0;
    for (let i = 0; i < squares.length; i++) {
      if (squares[i].getAttribute("data-flag") && squares[i].getAttribute("data-type") === "bomb") matches++;
      if (squares[i].getAttribute("data-checked")) revealed++;
    }
    // Win by flagging every bomb, or — like the real game — by revealing
    // every safe cell. Without the reveal win, chording a board clean would
    // dead-end with nothing left to do but ESC.
    if (matches === bombAmount || revealed === squares.length - bombAmount) {
      isGameOver = true;
      squares.forEach(updateCellCursor);
      console.log("[Aleph MiniGame] minesweeper: you won!");
      setTimeout(callbacks.onGameOver, 600);
    }
  }

  function updateCellCursor(sq: HTMLDivElement) {
    const checked = !!sq.getAttribute("data-checked");
    const count = parseInt(sq.getAttribute("data-count") || "0");
    sq.style.cursor = minesweeperCellCursor(checked, count, isGameOver);
  }

  return function cleanup() {
    isGameOver = true;
  };
}
