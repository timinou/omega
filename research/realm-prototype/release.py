#!/usr/bin/env python3
"""Real release launcher -> shared VM -> project tasks, private OS endpoints."""
import concurrent.futures
import json
import os
from pathlib import Path
import signal
import statistics
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
BUILD = "04805c33"  # BUILD_INFO.bl: clean upstream 48db743504ad40b56cd1458c03b7554c9383203a
LAUNCHER = Path.home() / ".local/bin/bl"
proof = HERE / "proof"
proof.mkdir(exist_ok=True)
checks = []

def check(label, condition):
    checks.append({"check": label, "pass": bool(condition)})
    print(("PASS " if condition else "FAIL ") + label, flush=True)
    if not condition:
        raise AssertionError(label)

with tempfile.TemporaryDirectory(prefix="omega-real-release-") as scratch:
    base = Path(scratch)
    runtime = base / "runtime"
    runtime.mkdir(mode=0o700)
    env = {**os.environ, "BL_USE": f"build:{BUILD}",
           "XDG_RUNTIME_DIR": str(runtime), "XDG_STATE_HOME": str(base / "state")}
    projects = []
    for marker in ("alpha", "beta"):
        root = base / marker
        (root / "src/studio").mkdir(parents=True)
        (root / "env.bl").write_text(
            '{:name "release-' + marker + '" :vm "shared" :warm "attach" '
            ':paths ["src"] :env {"PROJECT_MARKER" "' + marker + '"} '
            ':tasks {"probe" {:run "probe.bl"}}}')
        (root / "src/studio/fixture.bl").write_text(
            '(ns studio.fixture) (def counter (atom 0)) '
            '(defn snapshot [] {:marker "' + marker + '" :counter (swap! counter inc) '
            ':project-env (System/get_env "PROJECT_MARKER") '
            ':client-env (System/get_env "CLIENT_MARKER") '
            ':os (System/pid) :cwd (BeamLisp/cwd)})')
        (root / "probe.bl").write_text(
            '(ns user (:require [studio.fixture :as f] [bl.json :as json])) '
            '(println (str "PROBE " (json/encode (f/snapshot))))')
        projects.append(root)

    def invoke(root, args, client="normal"):
        start = time.perf_counter()
        r = subprocess.run([str(LAUNCHER), *args], cwd=root,
                           env={**env, "CLIENT_MARKER": client},
                           text=True, capture_output=True, timeout=180)
        result = {"ms": (time.perf_counter() - start) * 1000,
                  "code": r.returncode, "out": r.stdout, "err": r.stderr}
        if args == ["probe"]:
            if r.returncode:
                raise RuntimeError(result)
            result["value"] = json.loads(next(line[6:] for line in r.stdout.splitlines()
                                               if line.startswith("PROBE ")))
        return result

    with (proof / "release-daemon.log").open("w") as log:
        daemon = subprocess.Popen(
            [str(LAUNCHER), "--share-vm", "--cold", "realm", "start", "--foreground"],
            cwd=projects[0], env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            deadline = time.monotonic() + 180
            while not list(runtime.glob("beam_lisp/warm-*.sock")):
                if daemon.poll() is not None:
                    raise RuntimeError((proof / "release-daemon.log").read_text())
                if time.monotonic() > deadline:
                    raise TimeoutError("release daemon readiness")
                time.sleep(0.1)
            first_a = invoke(projects[0], ["probe"])
            first_b = invoke(projects[1], ["probe"])
            a, b = first_a["value"], first_b["value"]
            check("release clients attach to the explicitly owned VM",
                  a["os"] == b["os"] == str(daemon.pid))
            check("same namespace retains different project implementations",
                  [a["marker"], b["marker"]] == ["alpha", "beta"])
            check("project :env is read through standard System/get_env",
                  [a["project-env"], b["project-env"]] == ["alpha", "beta"])
            warm = [invoke(projects[0], ["probe"]) for _ in range(30)]
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                parallel = list(pool.map(
                    lambda i: invoke(projects[i % 2], ["probe"], f"client-{i}"), range(8)))
            check("concurrent clients keep their own standard environment view",
                  all(r["value"]["client-env"] == f"client-{i}" for i, r in enumerate(parallel)))
            check("all concurrent requests stay in the same VM",
                  all(r["value"]["os"] == a["os"] for r in parallel))
            check("warm task namespace state persists", warm[-1]["value"]["counter"] == 31)
            closed = invoke(projects[0], ["realm", "stop"])
            check("realm stop succeeds", closed["code"] == 0)
            remaining_b = invoke(projects[1], ["probe"])
            reopened_a = invoke(projects[0], ["probe"])
            check("stopping A leaves B's code and state intact",
                  remaining_b["value"]["marker"] == "beta" and remaining_b["value"]["counter"] == 6)
            check("A reopens with fresh state in the same VM",
                  reopened_a["value"]["counter"] == 1 and reopened_a["value"]["os"] == a["os"])
            times = sorted(r["ms"] for r in warm)
            report = {"build": BUILD, "upstream": "48db743504ad40b56cd1458c03b7554c9383203a",
                      "checks": checks, "first_a": first_a, "first_b": first_b,
                      "warm": warm, "warm_median_ms": statistics.median(times),
                      "warm_p95_ms": times[int(0.95 * (len(times) - 1))],
                      "parallel": parallel, "closed": closed,
                      "remaining_b": remaining_b, "reopened_a": reopened_a}
            (proof / "release.json").write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps({k: report[k] for k in ("warm_median_ms", "warm_p95_ms")}), flush=True)
        finally:
            if daemon.poll() is None:
                for root in projects:
                    try:
                        invoke(root, ["realm", "stop"])
                    except Exception:
                        pass
                os.killpg(daemon.pid, signal.SIGTERM)
                try:
                    daemon.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(daemon.pid, signal.SIGKILL)
                    daemon.wait(timeout=5)
