import { describe, expect, it, vi } from "vitest";
import { makeSpawnLatch } from "../../src/mini-game/latch";

// The latch counts USER messages (user bubbles render at send time and never
// mount mid-response), so a spent latch can only re-arm on a genuinely new
// send — not when the in-flight assistant node appears after spawn.
describe("makeSpawnLatch", () => {
  it("starts unspent and never queries the count while unlatched", () => {
    const latch = makeSpawnLatch();
    const getCount = vi.fn(() => 0);
    expect(latch.spent(getCount)).toBe(false);
    expect(getCount).not.toHaveBeenCalled();
  });

  it("stays spent while the user message count is unchanged (game ended mid-cycle)", () => {
    const latch = makeSpawnLatch();
    latch.spend(3);
    // Loss/win/ESC happened but the same response is still streaming:
    // no new send, so no new game may spawn.
    expect(latch.spent(() => 3)).toBe(true);
    expect(latch.spent(() => 3)).toBe(true);
  });

  it("re-arms when a new user message appears", () => {
    const latch = makeSpawnLatch();
    latch.spend(3);
    expect(latch.spent(() => 4)).toBe(false);
    expect(latch.spent(() => 4)).toBe(false);
  });

  it("adopts a lower baseline when the conversation was truncated", () => {
    const latch = makeSpawnLatch();
    latch.spend(5);
    // An edit removed messages — still spent for this cycle...
    expect(latch.spent(() => 2)).toBe(true);
    // ...but the next send re-arms from the lower baseline.
    expect(latch.spent(() => 3)).toBe(false);
  });

  it("can be spent again for the next cycle", () => {
    const latch = makeSpawnLatch();
    latch.spend(3);
    expect(latch.spent(() => 4)).toBe(false);
    latch.spend(4);
    expect(latch.spent(() => 4)).toBe(true);
  });
});
