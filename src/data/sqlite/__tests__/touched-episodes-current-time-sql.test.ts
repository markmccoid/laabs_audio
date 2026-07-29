import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression: bare `current_time` in SELECT is SQLite's CURRENT_TIME keyword
 * (wall-clock HH:MM:SS text), which emptied podcast Continue Listening.
 */
describe("touched_episodes current_time SQL qualification", () => {
  const source = readFileSync(join(__dirname, "..", "touched-episodes.ts"), "utf8");

  it("qualifies current_time on every SELECT from touched_episodes", () => {
    expect(source).toContain(
      'TOUCHED_EPISODE_CURRENT_TIME_SQL = "touched_episodes.current_time"',
    );

    const selectBlocks = source.match(/`SELECT[\s\S]*?FROM touched_episodes[\s\S]*?`/g) ?? [];
    const positionSelects = selectBlocks.filter((block) => /current_time/.test(block));
    expect(positionSelects.length).toBeGreaterThanOrEqual(2);
    for (const block of positionSelects) {
      expect(block).toContain("${TOUCHED_EPISODE_CURRENT_TIME_SQL} AS current_time_seconds");
      expect(block).not.toMatch(/(?:SELECT|,)\s*current_time\s*(?:,|FROM|AS)/);
    }
  });
});
