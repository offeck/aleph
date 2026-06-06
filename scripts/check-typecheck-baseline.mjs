import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Two-tier typecheck gate:
// 1. STRICT paths (everything migrated through Phase 4) tolerate ZERO errors.
// 2. The remaining (pre-split, Phase 5 pending) entries are budgeted by the
//    committed baseline count, which may only ratchet downward.
// When Phase 5 lands typed, fold its paths into STRICT_PATHS and drive the
// baseline to 0; Phase 6 then replaces this script with raw `tsc --noEmit`.
const STRICT_PATHS = [/^src\/shared\//, /^src\/tracker\//, /^src\/content\//, /^tests\//];

const baseline = JSON.parse(readFileSync("tests/typecheck-baseline.json", "utf8"));
const expected = baseline.expectedErrorCount;

const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
const errorLines = output.split(/\r?\n/).filter((line) => /error TS/.test(line));

const strictErrors = errorLines.filter((line) => {
  const file = line.replace(/\\/g, "/").split("(")[0];
  return STRICT_PATHS.some((re) => re.test(file));
});

if (strictErrors.length > 0) {
  console.error(`Typecheck FAILED: ${strictErrors.length} error(s) in strictly-typed paths (zero tolerated):`);
  for (const line of strictErrors) console.error("  " + line);
  process.exit(1);
}

const count = errorLines.length;

if (count > expected) {
  console.error(`Typecheck error count grew: ${count} > ${expected}`);
  console.error("Fix the new errors, or lower tests/typecheck-baseline.json only when the count shrinks.");
  console.error(output);
  process.exit(1);
}

console.log(`Typecheck baseline OK: ${count}/${expected} errors (strict paths: 0)`);
if (count < expected) {
  console.log(`Typecheck error count shrank. Update tests/typecheck-baseline.json to ${count} in this commit.`);
}
