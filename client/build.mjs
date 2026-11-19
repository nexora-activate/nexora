// Client bundle for NEXORA — plain Bun build.
//
// Bundles `client/index.html` to `client/dist/` in production mode
// (React dev paths tree-shaken out), with Tailwind compiled by
// bun-plugin-tailwind. Run from the app root: `bun ./client/build.mjs`
// (or `bun run build`).
//
// Deux contextes de construction, un seul code source :
//   - construit par la plateforme historique (variable
//     HATCH_SPACES_BUILD_DRIVER présente) : le module
//     client/src/query-client.ts est utilisé tel quel — l'instance
//     TanStack Query partagée de la plateforme.
//   - construit en autonome (Render, machine de dev) : un plugin
//     remplace ce module par standalone/query-client.ts, une instance
//     locale aux mêmes réglages, pour que le bundle ne dépende
//     d'aucun paquet de la plateforme.

import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";

const ENTRY = "./client/index.html";
const OUTDIR = "./client/dist";
const PLATFORM_BUILD = process.env.HATCH_SPACES_BUILD_DRIVER === "1";

const plugins = [tailwindPlugin];
if (!PLATFORM_BUILD) {
  plugins.push({
    name: "nexora-standalone-query-client",
    setup(build) {
      build.onResolve({ filter: /(^|\/)query-client$/ }, (args) => {
        if (args.importer.endsWith("main.tsx")) {
          return { path: join(process.cwd(), "standalone", "query-client.ts") };
        }
        return undefined;
      });
    },
  });
}

await rm(OUTDIR, { force: true, recursive: true });

const result = await Bun.build({
  entrypoints: [ENTRY],
  outdir: OUTDIR,
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  naming: {
    asset: "assets/[name]-[hash].[ext]",
    chunk: "assets/[name]-[hash].[ext]",
    entry: "[name].[ext]",
  },
  plugins,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  throw new Error("client build failed; see logged diagnostics");
}

// Bun writes imported assets to `naming.asset` (`assets/<name>-<hash>.<ext>`)
// but emits the JS/CSS import URL as a bare `./<name>-<hash>.<ext>` — without
// the `assets/` directory prefix. Re-prefix only the bare imported-asset
// URLs to `./assets/...` so the static server finds them. This is
// idempotent (`./assets/<f>` does not contain `./<f>`) and never rewrites
// chunk refs.
const assetFiles = result.outputs
  .filter((output) => output.kind === "asset")
  .map((output) => basename(output.path));

for (const output of result.outputs) {
  if (!/\.(js|css|html)$/.test(output.path)) {
    continue;
  }
  let text = await output.text();
  let changed = false;
  for (const name of assetFiles) {
    const bare = `./${name}`;
    if (text.includes(bare)) {
      text = text.split(bare).join(`./assets/${name}`);
      changed = true;
    }
  }
  if (changed) {
    await Bun.write(output.path, text);
  }
}
