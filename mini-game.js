(function () {
  "use strict";

  const host = location.hostname;
  const PLATFORM =
    host.includes("claude.ai") ? "claude" :
    host.includes("chatgpt.com") || host.includes("chat.openai.com") ? "chatgpt" :
    host.includes("gemini.google.com") ? "gemini" :
    null;
  if (!PLATFORM) return;

  let miniGameEnabled = false;
  if (chrome?.storage?.sync) {
    chrome.storage.sync.get({ miniGame: false }, (s) => { miniGameEnabled = s.miniGame; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.miniGame) miniGameEnabled = changes.miniGame.newValue;
    });
  }

  // Detect when the model starts thinking (before any text streams)
  const THINKING_SEL = {
    claude: '[aria-label="Stop response"]',
    chatgpt: '[aria-label="Stop streaming"], [aria-label*="Stop" i]',
    gemini: '.send-button.stop',
  };

  const ASSISTANT_SEL = '[data-message-author-role="assistant"], .font-claude-response, .response-content';

  function hasVisibleResponse() {
    const msgs = document.querySelectorAll(ASSISTANT_SEL);

    if (PLATFORM === "claude") {
      const streaming = document.querySelector('.progressive-markdown p');
      return streaming ? streaming.textContent.trim().length > 5 : false;
    }

    if (msgs.length <= gameSpawnMsgCount) return false;
    const last = msgs[msgs.length - 1];
    if (!last) return false;

    if (PLATFORM === "chatgpt") {
      const markdowns = last.querySelectorAll('.markdown');
      const lastMd = markdowns.length ? markdowns[markdowns.length - 1] : null;
      const p = lastMd ? lastMd.querySelector('p') : null;
      return p ? p.textContent.trim().length > 30 : false;
    }

    const p = last.querySelector('p');
    return p ? p.textContent.trim().length > 10 : false;
  }

  function isThinking() {
    const sel = THINKING_SEL[PLATFORM];
    return sel ? !!document.querySelector(sel) : false;
  }

  let gameActive = false;
  let thinkingDetected = false;
  let lastMouseX = window.innerWidth / 2;
  let lastMouseY = window.innerHeight / 2;

  document.addEventListener("mousemove", (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }, { passive: true });

  // Reset thinkingDetected when stop button disappears (response finished)
  // so the game can trigger again on the next send in the same conversation.
  // Also reset when game was dismissed (streaming started) — allows re-triggering.
  let wasThinking = false;
  setInterval(() => {
    const thinking = isThinking();
    if (wasThinking && !thinking) {
      thinkingDetected = false;
    }
    wasThinking = thinking;
  }, 300);

  // Watch for thinking indicators appearing in the DOM
  new MutationObserver(() => {
    if (!miniGameEnabled) return;
    if (gameActive) return;
    if (!isThinking()) return;
    if (thinkingDetected) return;
    thinkingDetected = true;
    console.log("[Aleph MiniGame] thinking detected!");
    setTimeout(() => {
      const stillThinking = isThinking();
      const nowVisible = hasVisibleResponse();
      console.log("[Aleph MiniGame] after 500ms: stillThinking=" + stillThinking + " visResp=" + nowVisible + " gameActive=" + gameActive);
      if (gameActive || nowVisible) return;
      if (!stillThinking) return;
      console.log("[Aleph MiniGame] spawning game!");
      spawnGame();
    }, 500);
  }).observe(document.body, {
    childList: true, subtree: true,
  });

  let gameSpawnMsgCount = 0;

  function spawnGame() {
    gameActive = true;
    gameSpawnMsgCount = document.querySelectorAll(ASSISTANT_SEL).length;
    const game = Math.random() < 0.5 ? "snake" : "minesweeper";

    const overlay = document.createElement("div");
    overlay.id = "aleph-mini-game";
    const w = game === "snake" ? 200 : 180;
    const h = game === "snake" ? 200 : 210;
    const left = Math.round((window.innerWidth - w) / 2);
    const top = Math.round((window.innerHeight - h) / 2);
    overlay.style.cssText =
      "position:fixed;z-index:999999;" +
      "left:" + left + "px;top:" + top + "px;" +
      "width:" + w + "px;height:" + h + "px;" +
      "border:2px solid #7c83ff;border-radius:12px;" +
      "box-shadow:0 8px 32px rgba(0,0,0,0.6);" +
      "background:#1a1a2e;overflow:hidden;" +
      "opacity:0;transition:opacity 0.3s;";

    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = "1"; });

    let paused = false;
    if (game === "snake") {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      overlay.appendChild(canvas);
      startSnake(canvas, dismiss, () => paused);
    } else {
      startMinesweeper(overlay, dismiss);
    }

    const escHandler = (e) => { if (e.key === "Escape") dismiss(); };
    document.addEventListener("keydown", escHandler);
    const streamPoll = setInterval(() => {
      if (hasVisibleResponse()) {
        console.log("[Aleph MiniGame] response streaming — dismissing");
        dismiss();
      }
    }, 500);

    let mouseEntered = false;
    overlay.addEventListener("mouseenter", () => {
      console.log("[Aleph MiniGame] mouse enter");
      mouseEntered = true;
      paused = false;
    });
    overlay.addEventListener("mouseleave", () => {
      if (!mouseEntered) return;
      console.log("[Aleph MiniGame] mouse exit");
      if (game === "snake") { paused = true; }
      else { dismiss(); }
    });

    function dismiss() {
      if (!gameActive) return;
      console.log("[Aleph MiniGame] dismiss called");
      gameActive = false;
      clearInterval(streamPoll);
      document.removeEventListener("keydown", escHandler);
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 200);
    }
  }

  // ── Snake (adapted from straker's gist, CC0 1.0) ─────────────────────
  function startSnake(canvas, onGameOver, isPaused) {
    const ctx = canvas.getContext("2d");
    const grid = 10;
    const cols = canvas.width / grid;
    const rows = canvas.height / grid;
    let count = 0;
    let dead = false;

    const snake = { x: grid * 5, y: grid * 5, dx: grid, dy: 0, cells: [], maxCells: 4 };
    const apple = {
      x: Math.floor(Math.random() * cols) * grid,
      y: Math.floor(Math.random() * rows) * grid,
    };

    function loop() {
      if (dead) return;
      requestAnimationFrame(loop);
      if (isPaused()) return;
      if (++count < 6) return;
      count = 0;

      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      snake.x += snake.dx;
      snake.y += snake.dy;

      if (snake.x < 0) snake.x = canvas.width - grid;
      else if (snake.x >= canvas.width) snake.x = 0;
      if (snake.y < 0) snake.y = canvas.height - grid;
      else if (snake.y >= canvas.height) snake.y = 0;

      snake.cells.unshift({ x: snake.x, y: snake.y });
      if (snake.cells.length > snake.maxCells) snake.cells.pop();

      ctx.fillStyle = "#f87171";
      ctx.beginPath();
      ctx.arc(apple.x + grid / 2, apple.y + grid / 2, grid / 2 - 1, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < snake.cells.length; i++) {
        const cell = snake.cells[i];
        const brightness = 1 - i / (snake.cells.length + 2) * 0.5;
        ctx.fillStyle = "rgba(74,222,128," + brightness + ")";
        ctx.fillRect(cell.x + 1, cell.y + 1, grid - 2, grid - 2);

        if (cell.x === apple.x && cell.y === apple.y) {
          snake.maxCells++;
          apple.x = Math.floor(Math.random() * cols) * grid;
          apple.y = Math.floor(Math.random() * rows) * grid;
        }

        for (let j = i + 1; j < snake.cells.length; j++) {
          if (cell.x === snake.cells[j].x && cell.y === snake.cells[j].y) {
            dead = true;
            document.removeEventListener("keydown", keyHandler);
            setTimeout(onGameOver, 300);
            return;
          }
        }
      }
    }

    const keyHandler = (e) => {
      if (e.key === "ArrowLeft" && snake.dx === 0) { snake.dx = -grid; snake.dy = 0; e.preventDefault(); }
      else if (e.key === "ArrowUp" && snake.dy === 0) { snake.dy = -grid; snake.dx = 0; e.preventDefault(); }
      else if (e.key === "ArrowRight" && snake.dx === 0) { snake.dx = grid; snake.dy = 0; e.preventDefault(); }
      else if (e.key === "ArrowDown" && snake.dy === 0) { snake.dy = grid; snake.dx = 0; e.preventDefault(); }
    };
    document.addEventListener("keydown", keyHandler);

    requestAnimationFrame(loop);
  }

  // ── Minesweeper (adapted from kubowania/minesweeper, MIT) ─────────────
  function startMinesweeper(container, onGameOver) {
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
        setTimeout(onGameOver, 800);
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
        setTimeout(onGameOver, 600);
      }
    }
  }
})();
