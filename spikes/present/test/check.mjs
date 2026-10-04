// node spikes/present/test/check.mjs [file…] — runs pp.check (BL) on the compiled spike.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const out = path.resolve(process.env.PP_OUT || new URL("../web/out", import.meta.url).pathname);
const C = await import(pathToFileURL(path.join(out, "pp.check.mjs")).href);
const Core = await import(pathToFileURL(path.join(out, "core.mjs")).href);
const show = (x) => Core.pr_str(x);
const files = process.argv.slice(2);
for (const f of files) {
  const r = C.d_equivalence(fs.readFileSync(f, "utf8"), f);
  console.log(f, show(r));
}
if (process.env.PP_SHAPE) console.log("shape", show(C.d_omega_shape(fs.readFileSync(process.env.PP_SHAPE, "utf8"))));
