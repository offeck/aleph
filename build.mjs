// esbuild driver: one IIFE bundle per extension entry point, plus built CSS/HTML
// assets, output to dist/. The repo root stays the unpacked-extension directory;
// never edit dist/ by hand. See CLAUDE.md (Architecture).
import * as esbuild from "esbuild";
import { watch as watchFile } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";

const dev = process.argv.includes("--dev");
const watch = process.argv.includes("--watch");
const buildStamp = new Date().toISOString();

// The Antigravity client secret is NOT a build input — it would land in the
// shipped bundle (a Google first-party credential in the Web Store ZIP is a
// review/policy risk). The user pastes it into Settings instead; it lives in
// local storage and the feature stays inert until then. See antigravityAuth.ts.

const jsEntries = {
  content: "src/content/index.ts",
  "insights-tracker": "src/tracker/index.ts",
  "mini-game": "src/mini-game/index.ts",
  background: "src/background/index.ts",
  popup: "src/popup/index.ts",
  settings: "src/settings/index.ts",
  insights: "src/insights/index.ts",
};

const cssEntries = {
  content: "src/content/content.css",
  popup: "src/popup/popup.css",
  settings: "src/settings/settings.css",
  insights: "src/insights/insights.css",
};

const htmlEntries = {
  popup: "src/popup/popup.html",
  settings: "src/settings/settings.html",
  insights: "src/insights/insights.html",
};

/** @type {import('esbuild').BuildOptions} */
const jsCommon = {
  bundle: true,
  format: "iife",
  target: ["chrome120"],
  platform: "browser",
  legalComments: "none",
  logLevel: "info",
  sourcemap: dev ? "inline" : false,
  minify: false, // keep bundles readable (store review + debugging); size is irrelevant
  define: {
    __ALEPH_BUILD__: JSON.stringify(buildStamp),
  },
};

/** @type {import('esbuild').BuildOptions} */
const cssCommon = {
  bundle: true,
  target: ["chrome120"],
  legalComments: "none",
  logLevel: "info",
  sourcemap: dev ? "inline" : false,
  minify: false,
};

const jsBuilds = Object.entries(jsEntries).map(([name, entry]) => ({
  ...jsCommon,
  entryPoints: [entry],
  outfile: `dist/${name}.js`,
}));

const cssBuilds = Object.entries(cssEntries).map(([name, entry]) => ({
  ...cssCommon,
  entryPoints: [entry],
  outfile: `dist/${name}.css`,
}));

const allBuilds = [...jsBuilds, ...cssBuilds];

async function resetDist() {
  await rm("dist", { recursive: true, force: true });
  await mkdir("dist", { recursive: true });
}

async function copyHtml() {
  await Promise.all(
    Object.entries(htmlEntries).map(([name, entry]) => copyFile(entry, `dist/${name}.html`))
  );
}

await resetDist();

if (watch) {
  const ctxs = await Promise.all(allBuilds.map((opts) => esbuild.context(opts)));
  await Promise.all(ctxs.map((ctx) => ctx.watch()));
  await copyHtml();
  for (const entry of Object.values(htmlEntries)) {
    watchFile(entry, { persistent: true }, () => {
      copyHtml().catch((err) => {
        console.error("[aleph] HTML copy failed", err);
        process.exitCode = 1;
      });
    });
  }
  console.log(`[aleph] esbuild watching src/ -> dist/ (build ${buildStamp}) ...`);
} else {
  await Promise.all(allBuilds.map((opts) => esbuild.build(opts)));
  await copyHtml();
  console.log(`[aleph] build complete (${buildStamp})`);
}
