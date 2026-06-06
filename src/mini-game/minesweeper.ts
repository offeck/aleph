import type { GameCallbacks } from "./spawn";

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
    if (sq.getAttribute("data-checked") || sq.getAttribute("data-flag")) return;
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
    const isLeft = id % width === 0;
    const isRight = id % width === width - 1;
    const neighbors: number[] = [];
    if (!isLeft && id > 0) neighbors.push(id - 1);
    if (!isRight && id < squares.length - 1) neighbors.push(id + 1);
    if (id >= width) neighbors.push(id - width);
    if (id + width < squares.length) neighbors.push(id + width);
    if (!isLeft && id > width) neighbors.push(id - width - 1);
    if (!isRight && id > width - 1) neighbors.push(id - width + 1);
    if (!isLeft && id + width < squares.length) neighbors.push(id + width - 1);
    if (!isRight && id + width + 1 < squares.length) neighbors.push(id + width + 1);
    setTimeout(() => { neighbors.forEach((n) => clickCell(squares[n])); }, 10);
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
