#!/usr/bin/env python3
"""Sign an app-only Pocket update over a previously released, tested APK.

No Gradle and no native rebuild: the Android shell, native libraries and language
runtime stay byte-identical to the base release. Fresh AOT app modules (pocket.*)
replace or join the base's app modules inside assets/bl-runtime.zip; the manifest's
version code and name are patched in place; the APK is zipaligned and signed with
the existing Pocket identity, so it installs over the base with settings retained.
An optional --shell-dir overlays the remotely built startup-status DEX; its base
launcher hash must match. Other DEX and all native libraries remain unchanged.

  bl build src --out BEAMS --force          # app modules, any machine
  python3 app_update.py BASE.apk BEAMS 0.1.2 2026103101

The signing key never enters the Nix store or the repository: it is read from
~/.local/share/omega-pocket/signing (0700) by apksigner on this machine.
ANDROID_BUILD_TOOLS names a build-tools directory (zipalign, apksigner).
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import zipfile
from manifest_notifications import enable as enable_notifications

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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base_apk')
    parser.add_argument('beams', type=Path)
    parser.add_argument('name')
    parser.add_argument('code', type=int)
    parser.add_argument('--base-version', default='0.1.1')
    parser.add_argument('--base-code', type=int, default=2026101601)
    parser.add_argument('--variant', choices=['harness'])
    parser.add_argument('--shell-dir', type=Path, help='Remotely built startup status DEX, bound to this base launcher')
    args = parser.parse_args()
    base_apk, beams, name, code = args.base_apk, args.beams, args.name, args.code
    old_name, old_code = args.base_version, args.base_code
    assert code > old_code, 'An update must increase versionCode'
    tools = Path(os.environ['ANDROID_BUILD_TOOLS'])
    modules = {p.name: p.read_bytes() for p in beams.glob('Elixir.BeamLisp.Ns.*.beam')}
    release = HERE / 'release'
    release.mkdir(exist_ok=True)
    unsigned, aligned = release / 'unsigned.apk', release / 'aligned.apk'
    with zipfile.ZipFile(base_apk) as base, zipfile.ZipFile(unsigned, 'w') as out:
        runtime, added = overlay(base.read('assets/bl-runtime.zip'), modules)
        digest = hashlib.sha256(runtime).hexdigest()
        xml = manifest(base.read('AndroidManifest.xml'), old_code, code, old_name, name)
        if args.variant == 'harness':
            xml = enable_notifications(xml)
        replace = {'assets/bl-runtime.zip': runtime, 'assets/bl-runtime.sha256': digest.encode(),
                   'AndroidManifest.xml': xml}
        if args.shell_dir:
            expected = (args.shell_dir / 'base-classes3.sha256').read_text().strip()
            assert hashlib.sha256(base.read('classes3.dex')).hexdigest() == expected, 'Startup shell does not match base launcher'
            assert 'classes4.dex' not in base.namelist(), 'Base already owns the additional DEX entry'
            replace['classes3.dex'] = (args.shell_dir / 'classes3.dex').read_bytes()
        for entry in base.infolist():
            if entry.filename.startswith('META-INF/') and entry.filename.rsplit('.', 1)[-1] in {'SF', 'RSA', 'EC', 'DSA', 'MF'}:
                continue  # any v1 signature belongs to the base
            out.writestr(entry, replace.get(entry.filename, base.read(entry.filename)))
        if args.shell_dir:
            out.writestr('classes4.dex', (args.shell_dir / 'classes4.dex').read_bytes())
    abi = 'arm64-v8a'
    variant = f'-{args.variant}' if args.variant else ''
    output = release / f'omega-pocket{variant}-{name}-{abi}.apk'
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
