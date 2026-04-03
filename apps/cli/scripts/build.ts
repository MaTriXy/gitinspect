import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = import.meta.dir;
const entry = join(root, "../src/index.ts");
const outdir = join(root, "../dist");
const outfile = join(outdir, "index.js");

mkdirSync(dirname(outfile), { recursive: true });

const result = await Bun.build({
  banner: "#!/usr/bin/env node",
  entrypoints: [entry],
  format: "esm",
  outdir,
  packages: "external",
  sourcemap: "external",
  target: "node",
});

if (!result.success) {
  throw new AggregateError(result.logs, "CLI build failed");
}

chmodSync(outfile, 0o755);
