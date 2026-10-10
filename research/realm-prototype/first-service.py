#!/usr/bin/env python3
"""Check first-command service lifetime under the real default shared policy."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
BUILD = "04805c33"
launcher = Path.home() / ".local/bin/bl"
owned = set()
with tempfile.TemporaryDirectory(prefix="omega-first-service-") as scratch:
    root = Path(scratch)
    (root / "runtime").mkdir(mode=0o700)
    (root / "src/studio").mkdir(parents=True)
    (root / "env.bl").write_text(
        '{:name "first-service-probe" :vm "shared" :paths ["src"] '
        ':tasks {"host" {:run "host.bl"}}}')
    (root / "host.bl").write_text(
        '(ns user (:require [studio.service :as s] [bl.json :as json])) '
        '(println (str "PROBE " (json/encode (s/start!))))')
    (root / "src/studio/service.bl").write_text('''
(ns studio.service (:require [vm.manager :as m] [vm.realm :as realm]))
(defn start! []
 (m/start)
 (let [vm (realm/open (BeamLisp/cwd)) parent (erlang/self)
       pid (m/serve (:id vm) :prototype-host
             (fn [] (erlang/send parent [:ready (erlang/self)])
                    (receive :stop nil)))]
  (receive [:ready child] {:os (System/pid) :member (str child)}
   (after 10000 (throw (ex-info "readiness timeout" {}))))))
''')
    env = {**os.environ, "BL_USE": f"build:{BUILD}",
           "XDG_RUNTIME_DIR": str(root / "runtime"), "XDG_STATE_HOME": str(root / "state")}

    def invoke():
        start = time.perf_counter()
        r = subprocess.run([str(launcher), "host"], cwd=root, env=env,
                           text=True, capture_output=True, timeout=180)
        if r.returncode:
            raise RuntimeError({"code": r.returncode, "out": r.stdout, "err": r.stderr})
        value = json.loads(next(line[6:] for line in r.stdout.splitlines() if line.startswith("PROBE ")))
        owned.add(int(value["os"]))
        return {"value": value, "ms": (time.perf_counter() - start) * 1000,
                "out": r.stdout, "err": r.stderr}

    try:
        first = invoke()
        time.sleep(0.2)
        first_alive = Path(f'/proc/{first["value"]["os"]}').exists()
        deadline = time.monotonic() + 180
        while not list((root / "runtime").glob("beam_lisp/warm-*.sock")):
            if time.monotonic() > deadline:
                raise TimeoutError("background VM did not start")
            time.sleep(0.1)
        second = invoke()
        report = {"build": BUILD, "first": first, "second": second,
                  "first_vm_alive_after_command_return": first_alive,
                  "same_os_vm": first["value"]["os"] == second["value"]["os"]}
        (HERE / "proof/first-service.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report), flush=True)
        assert not first_alive and not report["same_os_vm"], "default policy changed; revisit plan"
    finally:
        for path in (root / "state").rglob("*.log"):
            (HERE / "proof/first-service-daemon.log").write_text(path.read_text())
        for pid in owned:
            try:
                # Only signal a process whose environment proves this private run.
                if str(root / "runtime").encode() in Path(f"/proc/{pid}/environ").read_bytes():
                    os.kill(pid, signal.SIGTERM)
            except (FileNotFoundError, ProcessLookupError):
                pass
