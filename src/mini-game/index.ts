import { detectPlatform } from "../shared/platform";

(function () {
  "use strict";

  const PLATFORM = detectPlatform(location.hostname);
  if (!PLATFORM) return;

  let miniGameEnabled = false;
  if (chrome?.storage?.sync) {
    chrome.storage.sync.get({ miniGame: false }, (s) => { miniGameEnabled = s.miniGame; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.miniGame) miniGameEnabled = changes.miniGame.newValue;
    });
  }

  // ── Constants ────────────────────────────────────────────────────────
  const DRAG_HOLD_MS      = 1500;

  const GAMES = {
    snake:       { width: 200, height: 200, start: startSnake },
    minesweeper: { width: 180, height: 210, start: startMinesweeper },
  };

  // ── Detection ────────────────────────────────────────────────────────
  const THINKING_SEL = {
    claude: '[aria-label="Stop response"]',
    chatgpt: '[aria-label="Stop streaming"], [aria-label*="Stop" i]',
    gemini: '.send-button.stop',
  };

  function isThinking() {
    const sel = THINKING_SEL[PLATFORM];
    return sel ? !!document.querySelector(sel) : false;
  }

  // ── Global state ─────────────────────────────────────────────────────
  let gameActive = false;
  let spawnPending = false;

  new MutationObserver(() => {
    if (!miniGameEnabled) return;
    if (gameActive) return;
    if (!isThinking()) return;
    if (spawnPending) return;
    spawnPending = true;
    console.log("[Aleph MiniGame] thinking detected!");
    setTimeout(() => {
      const stillThinking = isThinking();
      console.log("[Aleph MiniGame] after 500ms: stillThinking=" + stillThinking + " gameActive=" + gameActive);
      spawnPending = false;
      if (gameActive) return;
      if (!stillThinking) return;
      console.log("[Aleph MiniGame] spawning game!");
      spawnGame();
    }, 500);
  }).observe(document.body, { childList: true, subtree: true });

  // ── spawnGame ────────────────────────────────────────────────────────
  function spawnGame() {
    gameActive = true;

    const keys = Object.keys(GAMES);
    const gameName = keys[Math.floor(Math.random() * keys.length)];
    const gameDef = GAMES[gameName];

    const overlay = document.createElement("div");
    overlay.id = "aleph-mini-game";
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
    const callbacks = { onGameOver: dismiss };

    let container = overlay;
    if (gameName === "snake") {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      overlay.appendChild(canvas);
      container = canvas;
    }
    const cleanup = gameDef.start(container, callbacks);

    // ── ESC handler
    const escHandler = (e) => { if (e.key === "Escape") dismiss(); };
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
    let dragState = null;
    let holdTimer = null;
    let dragOffsetX, dragOffsetY;

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

    function dragMove(e) {
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

  // ── Snake ────────────────────────────────────────────────────────────
  function startSnake(canvas, callbacks) {
    const ctx = canvas.getContext("2d");
    const grid = 10;
    const cols = canvas.width / grid;
    const rows = canvas.height / grid;
    let count = 0;
    let dead = false;
    let started = false;

    const snake = { x: grid * 5, y: grid * 5, dx: 0, dy: 0, cells: [], maxCells: 4 };
    const apple = {
      x: Math.floor(Math.random() * cols) * grid,
      y: Math.floor(Math.random() * rows) * grid,
    };

    snake.cells = [{ x: snake.x, y: snake.y }];
    for (let i = 1; i < snake.maxCells; i++) {
      snake.cells.push({ x: snake.x - i * grid, y: snake.y });
    }
    drawFrame();

    function drawFrame() {
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#f87171";
      ctx.beginPath();
      ctx.arc(apple.x + grid / 2, apple.y + grid / 2, grid / 2 - 1, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < snake.cells.length; i++) {
        const cell = snake.cells[i];
        const brightness = 1 - i / (snake.cells.length + 2) * 0.5;
        ctx.fillStyle = "rgba(74,222,128," + brightness + ")";
        ctx.fillRect(cell.x + 1, cell.y + 1, grid - 2, grid - 2);
      }
    }

    function loop() {
      if (dead) return;
      requestAnimationFrame(loop);
      if (++count < 6) return;
      count = 0;

      snake.x += snake.dx;
      snake.y += snake.dy;

      if (snake.x < 0 || snake.x >= canvas.width || snake.y < 0 || snake.y >= canvas.height) {
        dead = true;
        document.removeEventListener("keydown", keyHandler);
        setTimeout(callbacks.onGameOver, 300);
        return;
      }

      snake.cells.unshift({ x: snake.x, y: snake.y });
      if (snake.cells.length > snake.maxCells) snake.cells.pop();

      drawFrame();

      if (snake.cells[0].x === apple.x && snake.cells[0].y === apple.y) {
        snake.maxCells++;
        apple.x = Math.floor(Math.random() * cols) * grid;
        apple.y = Math.floor(Math.random() * rows) * grid;
      }

      for (let j = 1; j < snake.cells.length; j++) {
        if (snake.cells[0].x === snake.cells[j].x && snake.cells[0].y === snake.cells[j].y) {
          dead = true;
          document.removeEventListener("keydown", keyHandler);
          setTimeout(callbacks.onGameOver, 300);
          return;
        }
      }
    }

    const keyHandler = (e) => {
      if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();

      if (!started) {
        started = true;
        if (e.key === "ArrowLeft")       { snake.dx = -grid; snake.dy = 0; }
        else if (e.key === "ArrowUp")    { snake.dx = 0; snake.dy = -grid; }
        else if (e.key === "ArrowRight") { snake.dx = grid; snake.dy = 0; }
        else if (e.key === "ArrowDown")  { snake.dx = 0; snake.dy = grid; }
        requestAnimationFrame(loop);
        return;
      }

      if (e.key === "ArrowLeft" && snake.dx === 0)       { snake.dx = -grid; snake.dy = 0; }
      else if (e.key === "ArrowUp" && snake.dy === 0)    { snake.dy = -grid; snake.dx = 0; }
      else if (e.key === "ArrowRight" && snake.dx === 0) { snake.dx = grid; snake.dy = 0; }
      else if (e.key === "ArrowDown" && snake.dy === 0)  { snake.dy = grid; snake.dx = 0; }
    };
    document.addEventListener("keydown", keyHandler);

    return function cleanup() {
      dead = true;
      document.removeEventListener("keydown", keyHandler);
    };
  }

  // ── Minesweeper ──────────────────────────────────────────────────────
  function startMinesweeper(container, callbacks) {
    const width = 6;
    const bombAmount = 5;
    const cellSize = 28;
    let squares = [];
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
      sq.setAttribute("data-id", i);
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
      squares[i].setAttribute("data-count", total);
    }

    container.appendChild(gridEl);

    const COLORS = { 1: "#6ee7b7", 2: "#93c5fd", 3: "#fca5a5", 4: "#c4b5fd" };

    function clickCell(sq) {
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
        sq.textContent = total;
        sq.style.color = COLORS[total] || "#ccc";
      } else {
        revealNeighbors(parseInt(sq.getAttribute("data-id")));
      }
      checkForWin();
    }

    function revealNeighbors(id) {
      const isLeft = id % width === 0;
      const isRight = id % width === width - 1;
      const neighbors = [];
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

    function addFlag(sq) {
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
})();
