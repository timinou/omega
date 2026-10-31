#!/usr/bin/env python3
"""Sign an app-only Pocket update over a previously released, tested APK.

No Gradle and no native rebuild: the Android shell, native libraries and language
runtime stay byte-identical to the base release. Fresh AOT app modules (pocket.*)
replace or join the base's app modules inside assets/bl-runtime.zip; the manifest's
version code and name are patched in place; the APK is zipaligned and signed with
the existing Pocket identity, so it installs over the base with settings retained.

  bl build src --out BEAMS --force          # app modules, any machine
  python3 app_update.py BASE.apk BEAMS 0.1.2 2026103101

The signing key never enters the Nix store or the repository: it is read from
~/.local/share/omega-pocket/signing (0700) by apksigner on this machine.
ANDROID_BUILD_TOOLS names a build-tools directory (zipalign, apksigner).
"""
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import zipfile

HERE = Path(__file__).resolve().parent
APP = 'otp/omega_pocket/'


def overlay(runtime, modules):
    """The base runtime with app modules replaced or added. Nothing else changes."""
    assert modules and all('/' not in n and n.startswith('Elixir.BeamLisp.Ns.') and n.endswith('.beam') for n in modules)
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(runtime)) as base, zipfile.ZipFile(out, 'w') as target:
        old = {n[len(APP):] for n in base.namelist() if n.startswith(APP + 'Elixir.BeamLisp.Ns.') and n.endswith('.beam')}
        missing = old - set(modules)
        assert not missing, f'Fresh build lacks base app modules: {sorted(missing)}'
        for entry in base.infolist():
            name = entry.filename[len(APP):] if entry.filename.startswith(APP) else None
            target.writestr(entry, modules[name] if name in modules else base.read(entry.filename))
        template = base.getinfo(APP + sorted(old)[0])
        for name in sorted(set(modules) - old):
            info = zipfile.ZipInfo(APP + name, template.date_time)
            info.compress_type, info.external_attr = template.compress_type, template.external_attr
            target.writestr(info, modules[name])
    return out.getvalue(), sorted(set(modules) - old)


def manifest(xml, old_code, code, old_name, name):
    """Patch versionCode (one int) and versionName (one UTF-16 pool string, same length)."""
    assert len(old_name) == len(name), 'versionName must keep its length for an in-place patch'
    for before, after in [(struct.pack('<I', old_code), struct.pack('<I', code)),
                          (old_name.encode('utf-16-le'), name.encode('utf-16-le'))]:
        assert xml.count(before) == 1, f'expected exactly one {before!r} in the manifest'
        xml = xml.replace(before, after)
    return xml


def main():
    base_apk, beams, name, code = sys.argv[1], Path(sys.argv[2]), sys.argv[3], int(sys.argv[4])
    old_name, old_code = '0.1.1', 2026101601
    tools = Path(os.environ['ANDROID_BUILD_TOOLS'])
    modules = {p.name: p.read_bytes() for p in beams.glob('Elixir.BeamLisp.Ns.*.beam')}
    release = HERE / 'release'
    release.mkdir(exist_ok=True)
    unsigned, aligned = release / 'unsigned.apk', release / 'aligned.apk'
    with zipfile.ZipFile(base_apk) as base, zipfile.ZipFile(unsigned, 'w') as out:
        runtime, added = overlay(base.read('assets/bl-runtime.zip'), modules)
        digest = hashlib.sha256(runtime).hexdigest()
        replace = {'assets/bl-runtime.zip': runtime, 'assets/bl-runtime.sha256': digest.encode(),
                   'AndroidManifest.xml': manifest(base.read('AndroidManifest.xml'), old_code, code, old_name, name)}
        for entry in base.infolist():
            if entry.filename.startswith('META-INF/') and entry.filename.rsplit('.', 1)[-1] in {'SF', 'RSA', 'EC', 'DSA', 'MF'}:
                continue  # any v1 signature belongs to the base
            out.writestr(entry, replace.get(entry.filename, base.read(entry.filename)))
    abi = 'arm64-v8a'
    output = release / f'omega-pocket-{name}-{abi}.apk'
    subprocess.run([tools / 'zipalign', '-P', '16', '-f', '4', unsigned, aligned], check=True)
    signing = Path.home() / '.local/share/omega-pocket/signing'
    assert (signing.stat().st_mode & 0o077) == 0, f'{signing} must be private (0700)'
    env = {**os.environ, 'OMEGA_APK_STOREPASS': json.loads((signing / 'password.json').read_text())['password']}
    subprocess.run([tools / 'apksigner', 'sign', '--ks', signing / 'release.jks', '--ks-key-alias', 'omega-pocket',
                    '--ks-pass', 'env:OMEGA_APK_STOREPASS', '--key-pass', 'env:OMEGA_APK_STOREPASS',
                    '--out', output, aligned], env=env, check=True)
    subprocess.run([tools / 'apksigner', 'verify', '--print-certs', output], check=True)
    unsigned.unlink(); aligned.unlink()
    sha = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.apk.sha256').write_text(f'{sha}  {output.name}\n')
    print(f'\nApp-only update {name} ({code}) over {Path(base_apk).name}: {len(modules)} app modules, added {added}')
    print(f'Runtime SHA-256 {digest}\nSigned APK: {output}\nSHA-256: {sha}')


if __name__ == '__main__':
    main()
