#!/usr/bin/env python3
"""Finish the self-contained BL build as a signed Pocket APK for sideloading."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
PROJECT = HERE / "_build/android/android"
MAIN = PROJECT / "app/src/main"
ANDROID = "{http://schemas.android.com/apk/res/android}"
VERSION = "0.1.1"
VERSION_CODE = 2026101601


def release_versions(gradle, version, code):
    """Set release identity in a generated or previously configured project."""
    def replace(pattern, value, source):
        result, count = re.subn(pattern, lambda match: match[1] + value, source)
        if count != 1:
            raise ValueError('Expected exactly one Android release version field')
        return result
    named = replace(r'(\bversionName\s+)"[^"\n]*"', '"' + version + '"', gradle)
    return replace(r'(\bversionCode\s+)\d+', str(code), named)


def replace_once(path, before, after):
    text = path.read_text()
    if after in text:
        return
    if before not in text:
        raise RuntimeError(f"Expected template text missing in {path}: {before[:80]}")
    path.write_text(text.replace(before, after, 1))


def configure():
    # Pocket displays a remote web application; native capture/accessibility
    # services are unnecessary. Keep the network permissions of this host.
    ET.register_namespace("android", ANDROID[1:-1])
    manifest = MAIN / "AndroidManifest.xml"
    tree = ET.parse(manifest)
    root = tree.getroot()
    keep = {"android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE"}
    for entry in list(root):
        if entry.tag == "uses-permission" and entry.get(ANDROID + "name") not in keep:
            root.remove(entry)
    application = root.find("application")
    for entry in list(application):
        if entry.tag in {"receiver", "service"}:
            application.remove(entry)
    application.set(ANDROID + "usesCleartextTraffic", "false")
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
    (MAIN / "res/xml/network_security_config.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<network-security-config><base-config cleartextTrafficPermitted="false"/>'
        '</network-security-config>\n'
    )
    activity = MAIN / "java/org/beamlisp/omega/pocket/MainActivity.kt"
    replace_once(activity, "        nativeSetActivity(this)\n",
                 '        android.system.Os.setenv("MOB_RELEASE", "1", true)\n'
                 "        nativeSetActivity(this)\n")
    bridge = MAIN / "java/org/beamlisp/omega/pocket/MobBridge.kt"
    text = bridge.read_text()
    start = text.find("                    addJavascriptInterface(object : Any() {")
    end = text.find('                    }, "MobNative")', start)
    if start >= 0:
        if end < 0:
            raise RuntimeError("WebView bridge template changed")
        text = text[:start] + text[end + len('                    }, "MobNative")\n'):]
    text = text.replace("                            view.evaluateJavascript(MOB_JS_SHIM, null)",
                        "                            // Remote Pocket uses its own browser transport.")
    bridge.write_text(text)
    gradle = PROJECT / "app/build.gradle"
    gradle.write_text(release_versions(gradle.read_text(), VERSION, VERSION_CODE))


def run(*args, env=None):
    subprocess.run(args, cwd=PROJECT, env=env, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sign-only", action="store_true", help="Sign an already assembled release APK")
    args = parser.parse_args()
    env = os.environ.copy()
    env["JAVA_HOME"] = env.get("BL_ANDROID_JAVA_HOME", "/usr/lib/jvm/java-21-openjdk")
    if not args.sign_only:
        configure()
        run(str(PROJECT / "gradlew"), "assembleRelease", "--no-daemon", "--max-workers=2", "-q", env=env)
    sdk = Path(env.get("ANDROID_HOME", str(Path.home() / "Android/Sdk")))
    tools = sdk / "build-tools/35.0.0"
    signing = Path.home() / ".local/share/omega-pocket/signing"
    signing.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = signing / "release.jks"
    passwords = signing / "password.json"
    if not passwords.exists():
        if key.exists():
            raise RuntimeError("Signing key exists without its password file")
        with open(passwords, "x", opener=lambda p, f: os.open(p, f, 0o600)) as out:
            json.dump({"password": secrets.token_urlsafe(48)}, out)
    env["OMEGA_APK_STOREPASS"] = json.loads(passwords.read_text())["password"]
    if not key.exists():
        run(str(Path(env["JAVA_HOME"]) / "bin/keytool"), "-genkeypair", "-keystore", str(key),
            "-storepass:env", "OMEGA_APK_STOREPASS", "-keypass:env", "OMEGA_APK_STOREPASS",
            "-alias", "omega-pocket", "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
            "-dname", "CN=Omega Pocket", env=env)
        key.chmod(0o600)
    release = HERE / "release"
    release.mkdir(exist_ok=True)
    unsigned = PROJECT / "app/build/outputs/apk/release/app-release-unsigned.apk"
    aligned = release / "aligned.apk"
    # Read the compiled ABI instead of assuming the emulator and phone match.
    import zipfile
    with zipfile.ZipFile(unsigned) as apk:
        abis = {p.split("/")[1] for p in apk.namelist() if p.startswith("lib/")}
    if len(abis) != 1:
        raise RuntimeError(f"Expected one ABI, got {abis}")
    abi = abis.pop()
    output = release / f"omega-pocket-{VERSION}-{abi}.apk"
    run(str(tools / "zipalign"), "-P", "16", "-f", "4", str(unsigned), str(aligned))
    run(str(tools / "apksigner"), "sign", "--ks", str(key), "--ks-key-alias", "omega-pocket",
        "--ks-pass", "env:OMEGA_APK_STOREPASS", "--key-pass", "env:OMEGA_APK_STOREPASS",
        "--out", str(output), str(aligned), env=env)
    run(str(tools / "apksigner"), "verify", "--verbose", "--print-certs", str(output), env=env)
    aligned.unlink()
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".apk.sha256").write_text(f"{digest}  {output.name}\n")
    print(f"\nSigned APK: {output}\nSHA-256: {digest}\nSigning key retained privately: {key}")


if __name__ == "__main__":
    main()
