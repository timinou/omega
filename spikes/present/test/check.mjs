// node spikes/present/test/check.mjs [--corpus manifest] [file…]
// Runs pp.check (BL) on the compiled spike. Corpus paths, like file args, are relative to cwd.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const out = path.resolve(process.env.PP_OUT || new URL("../web/out", import.meta.url).pathname);
const C = await import(pathToFileURL(path.join(out, "pp.check.mjs")).href);
const Core = await import(pathToFileURL(path.join(out, "core.mjs")).href);
const R = await import(pathToFileURL(path.join(out, "rt.mjs")).href);
const show = (x) => Core.pr_str(x);
const files = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--corpus") {
    const manifest = process.argv[++i];
    if (!manifest) throw new Error("--corpus needs a manifest path");
    files.push(...fs.readFileSync(manifest, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#")));
  } else files.push(process.argv[i]);
}
if (!files.length) throw new Error("equivalence needs at least one document");
for (const f of files) {
  const r = C.d_equivalence(fs.readFileSync(f, "utf8"), f);
  console.log(f, show(r));
  if (r.get(R.kw("bad")).toArray().length) process.exitCode = 1;
}
if (process.env.PP_SHAPE) console.log("shape", show(C.d_omega_shape(fs.readFileSync(process.env.PP_SHAPE, "utf8"))));
