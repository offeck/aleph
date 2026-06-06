import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseline = JSON.parse(readFileSync("tests/typecheck-baseline.json", "utf8"));
const expected = baseline.expectedErrorCount;

const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
const count = (output.match(/error TS/g) || []).length;

if (count > expected) {
  console.error(`Typecheck error count grew: ${count} > ${expected}`);
  console.error("Fix the new errors, or lower tests/typecheck-baseline.json only when the count shrinks.");
  console.error(output);
  process.exit(1);
}

console.log(`Typecheck baseline OK: ${count}/${expected} errors`);
if (count < expected) {
  console.log(`Typecheck error count shrank. Update tests/typecheck-baseline.json to ${count} in this commit.`);
}
