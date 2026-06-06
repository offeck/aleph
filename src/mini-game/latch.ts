// ── Per-cycle spawn latch ────────────────────────────────────────────────
// "This thinking cycle's one allowed spawn is used" — distinct from
// spawn.ts's gameActive ("a game is on screen right now"). Ending a game
// (loss, win, ESC) must NOT re-open spawning while the same response is
// still streaming, so dismiss() never touches this latch.
//
// Re-arms only when the USER message count grows past the snapshot taken
// at spawn time — i.e. a genuinely new send (count-snapshot pattern,
// claude-general-002). User bubbles render at send time and never mount
// mid-response, so neither stop-button flicker (tool-use gaps) nor the
// in-flight assistant node appearing after spawn can re-arm the latch.
// If the count DROPS below the snapshot (an edit truncated the
// conversation), adopt the lower count as the new baseline so the next
// send still re-arms.

export interface SpawnLatch {
  /** True while this cycle's spawn is spent. getCount is only invoked while latched. */
  spent(getCount: () => number): boolean;
  /** Close the latch, snapshotting the user message count at spawn. */
  spend(count: number): void;
}

export function makeSpawnLatch(): SpawnLatch {
  let latched = false;
  let countAtSpawn = 0;
  return {
    spent(getCount) {
      if (!latched) return false;
      const count = getCount();
      if (count > countAtSpawn) latched = false;
      else if (count < countAtSpawn) countAtSpawn = count;
      return latched;
    },
    spend(count) {
      latched = true;
      countAtSpawn = count;
    },
  };
}
