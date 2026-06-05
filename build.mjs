// esbuild driver — one IIFE bundle per extension entry point, output to dist/.
// The repo root stays the unpacked-extension directory (manifest/HTML point
// into dist/); never edit dist/ by hand. See MIGRATION.md.
import * as esbuild from "esbuild";

const dev = process.argv.includes("--dev");
const watch = process.argv.includes("--watch");

const entries = {
  content: "src/content/index.ts",
  "insights-tracker": "src/tracker/index.ts",
  "mini-game": "src/mini-game/index.ts",
  background: "src/background/index.ts",
  popup: "src/popup/index.ts",
  settings: "src/settings/index.ts",
  insights: "src/insights/index.ts",
};

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: "iife",
  target: ["chrome120"],
  platform: "browser",
  legalComments: "none",
  logLevel: "info",
  sourcemap: dev ? "inline" : false,
  minify: false, // keep bundles readable (store review + debugging); size is irrelevant
};

const builds = Object.entries(entries).map(([name, entry]) => ({
  ...common,
  entryPoints: [entry],
  outfile: `dist/${name}.js`,
}));

if (watch) {
  const ctxs = await Promise.all(builds.map((opts) => esbuild.context(opts)));
  await Promise.all(ctxs.map((ctx) => ctx.watch()));
  console.log("[aleph] esbuild watching src/ -> dist/ ...");
} else {
  await Promise.all(builds.map((opts) => esbuild.build(opts)));
  console.log("[aleph] build complete");
}
