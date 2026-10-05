// Cold-process gate: warm unit suites can hide missing regex/prelude requires.
// node --test vendor/bl-ed/test/serve-cold.test.mjs (from omega root)
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("a cold packaged server resolves virtual paths and serves changing task documents", { timeout: 90000 }, async (t) => {
  const port = await freePort();
  const child = spawn(path.join(root, "bin/bl"), ["--cold", "run", "-p", path.join(root, "src"), "-p", path.join(root, "vendor/bl-ed/src"),
    path.join(root, "spikes/present/test/experience-world.bl"), "--", String(port)], { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "", spawnError = null;
  child.on("error", (error) => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { logs = (logs + chunk).slice(-12000); });
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 600; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`fixture exited ${child.exitCode}: ${logs}`);
    try { if ((await fetch(base + "/", { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch { /* not listening yet */ }
    await sleep(100);
  }
  assert.ok(ready, "cold fixture did not start: " + logs);
  // This is the FIRST virtual-path request: don't retry and accidentally warm the missing dependency.
  const overview = await fetch(base + "/api/doc?path=omega%3Aoverview");
  assert.equal(overview.status, 200, logs);
  const doc = await overview.json();
  assert.equal(doc.ok, true);
  assert.match(doc.text, /2 tasks/);
  const readTask = async () => (await fetch(base + "/api/doc?path=task%3At-1")).json();
  const before = await readTask();
  assert.equal(before.ok, true);
  const append = await fetch(base + "/api/intent", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "proof/append", args: { id: "t-1", text: "COLD HTTP UPDATE PROOF" } }) });
  assert.equal((await append.json()).ok, true);
  const after = await readTask();
  assert.equal(after.ok, true);
  assert.notEqual(after.rev, before.rev);
  assert.match(after.text, /COLD HTTP UPDATE PROOF/);
});
