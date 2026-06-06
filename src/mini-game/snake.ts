import type { GameCallbacks } from "./spawn";

// ── Snake ────────────────────────────────────────────────────────────
// spawnGame always hands snake a <canvas> (see the container swap there).
export function startSnake(container: HTMLElement, callbacks: GameCallbacks) {
  const canvas = container as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const grid = 10;
  const cols = canvas.width / grid;
  const rows = canvas.height / grid;
  let count = 0;
  let dead = false;
  let started = false;

  const snake: { x: number; y: number; dx: number; dy: number; cells: { x: number; y: number }[]; maxCells: number } =
    { x: grid * 5, y: grid * 5, dx: 0, dy: 0, cells: [], maxCells: 4 };
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

  const keyHandler = (e: KeyboardEvent) => {
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
