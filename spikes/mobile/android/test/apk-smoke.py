#!/usr/bin/env python3
"""Drive the installed release shell against the emulator's offline HTTPS proxy."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--serial", default="emulator-5580")
parser.add_argument("--origin", required=True)
args = parser.parse_args()
assert args.serial.startswith("emulator-"), "Use an isolated emulator"
adb = str(Path.home() / "Android/Sdk/platform-tools/adb")
proof = Path(__file__).resolve().parents[2] / "proof/android-standalone"
proof.mkdir(parents=True, exist_ok=True)


def device(*command):
    return subprocess.check_output([adb, "-s", args.serial, *command], timeout=45)


assert device("shell", "settings", "get", "global", "http_proxy").decode().strip() == "10.0.2.2:19892"
checks = []


def tree():
    for attempt in range(5):
        try:
            result = device("shell", "uiautomator", "dump", "/sdcard/omega-pocket-window.xml")
            if b"dumped to:" not in result:
                raise subprocess.CalledProcessError(1, "uiautomator dump", output=result)
            return ET.fromstring(device("exec-out", "cat", "/sdcard/omega-pocket-window.xml"))
        except (subprocess.SubprocessError, ET.ParseError):
            if attempt == 4:
                raise
            time.sleep(2)


def wait_text(text, seconds=180):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            root = tree()
            if any(text in n.get("text", "") or text in n.get("content-desc", "") for n in root.iter("node")):
                return root
        except (subprocess.SubprocessError, ET.ParseError):
            pass
        time.sleep(2)
    raise AssertionError(f"Did not see {text!r}")


def tap_node(node):
    left, top, right, bottom = map(int, re.findall(r"\d+", node.get("bounds")))
    device("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))


def tap_text(text):
    root = wait_text(text)
    tap_node(next(n for n in root.iter("node") if n.get("text") == text or n.get("content-desc") == text))


def fill_origin(text):
    root = tree()
    tap_node(next(n for n in root.iter("node") if n.get("class", "").endswith("EditText")))
    device("shell", "input", "keycombination", "113", "29")
    device("shell", "input", "text", text)
    device("shell", "input", "keyevent", "4")


def shot(name):
    (proof / f"android-{name}.png").write_bytes(device("exec-out", "screencap", "-p"))


def checked(message):
    checks.append(message)
    print("PASS", message, flush=True)
    (proof / "android-smoke.json").write_text(json.dumps(checks, indent=2) + "\n")


device("shell", "am", "start", "-n", "org.beamlisp.omega.pocket/.MainActivity")
wait_text("Connect to host")
shot("connection")
checked("Fresh release install starts its bundled runtime without android push")
fill_origin("http://invalid.example")
tap_text("Connect to host")
wait_text("Enter a private Tailscale HTTPS address")
shot("invalid-origin")
checked("Native connection screen rejects a non-private HTTPS origin")
fill_origin(args.origin)
tap_text("Connect to host")
wait_text("No tasks")
shot("pocket")
checked("Release WebView loads the real Pocket package through trusted HTTPS into the offline world")
tap_text("Reload")
wait_text("No tasks")
checked("Reload returns to the shared server view")
device("shell", "am", "force-stop", "org.beamlisp.omega.pocket")
device("shell", "am", "start", "-n", "org.beamlisp.omega.pocket/.MainActivity")
wait_text("No tasks")
shot("reopened")
checked("Saved server address reconnects after process termination")
tap_text("Server")
wait_text("Connect to host")
wait_text(args.origin)
checked("Server control returns to connection settings with the address retained")
tap_text("Connect to host")
wait_text("No tasks")
checked("Reconnecting from settings recreates the Pocket WebView")
