import { describe, expect, it } from "vitest";
import { chordTargets, neighborIds, type NeighborState } from "../../src/mini-game/minesweeper";

// Game grid is 6×6 (width 6, 36 cells).
const W = 6;
const N = 36;

describe("neighborIds", () => {
  it("center cell has all 8 neighbors", () => {
    expect(neighborIds(14, W, N).sort((a, b) => a - b)).toEqual([7, 8, 9, 13, 15, 19, 20, 21]);
  });

  it("corners have 3 neighbors", () => {
    expect(neighborIds(0, W, N).sort((a, b) => a - b)).toEqual([1, 6, 7]);
    expect(neighborIds(5, W, N).sort((a, b) => a - b)).toEqual([4, 10, 11]);
    expect(neighborIds(30, W, N).sort((a, b) => a - b)).toEqual([24, 25, 31]);
    expect(neighborIds(35, W, N).sort((a, b) => a - b)).toEqual([28, 29, 34]);
  });

  it("edge cells have 5 neighbors", () => {
    expect(neighborIds(3, W, N).sort((a, b) => a - b)).toEqual([2, 4, 8, 9, 10]); // top edge
    expect(neighborIds(12, W, N).sort((a, b) => a - b)).toEqual([6, 7, 13, 18, 19]); // left edge
    expect(neighborIds(17, W, N).sort((a, b) => a - b)).toEqual([10, 11, 16, 22, 23]); // right edge
    expect(neighborIds(33, W, N).sort((a, b) => a - b)).toEqual([26, 27, 28, 32, 34]); // bottom edge
  });

  it("never returns out-of-bounds or wrapped ids", () => {
    for (let id = 0; id < N; id++) {
      for (const n of neighborIds(id, W, N)) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(N);
        expect(Math.abs((n % W) - (id % W))).toBeLessThanOrEqual(1); // no row wrap
      }
    }
  });
});

describe("chordTargets", () => {
  const state = (id: number, flagged = false, checked = false): NeighborState => ({ id, flagged, checked });

  it("opens all unflagged unrevealed neighbors when flags match the count", () => {
    const neighbors = [state(1, true), state(2), state(3, false, true), state(4)];
    expect(chordTargets(neighbors, 1)).toEqual([2, 4]);
  });

  it("does nothing when fewer flags than the count", () => {
    const neighbors = [state(1, true), state(2), state(3)];
    expect(chordTargets(neighbors, 2)).toEqual([]);
  });

  it("does nothing when more flags than the count", () => {
    const neighbors = [state(1, true), state(2, true), state(3)];
    expect(chordTargets(neighbors, 1)).toEqual([]);
  });

  it("does nothing on a zero/blank cell", () => {
    expect(chordTargets([state(1)], 0)).toEqual([]);
  });

  it("includes unrevealed bombs when a flag is misplaced (real-game loss path)", () => {
    // Flag on 2 (not the bomb), bomb actually under 4: count matches, so 4 opens.
    const neighbors = [state(2, true), state(4)];
    expect(chordTargets(neighbors, 1)).toEqual([4]);
  });

  it("returns nothing when everything around is already revealed or flagged", () => {
    const neighbors = [state(1, true), state(2, false, true), state(3, false, true)];
    expect(chordTargets(neighbors, 1)).toEqual([]);
  });
});
