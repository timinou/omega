"""Build an app-only runtime update over a previously tested standalone image.

The native and language runtime stay byte-identical; fresh AOT app modules replace
their prior versions. Zip serialization requires a private mutable byte buffer.
"""
import hashlib
import io
from pathlib import Path
import sys
import zipfile


def overlay_app(base_runtime, modules):
    assert modules and all('/' not in name and name.endswith('.beam') for name in modules)
    replacements = {'otp/omega_pocket/' + name: data for name, data in modules.items()}
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base_runtime)) as base, zipfile.ZipFile(output, 'w') as target:
        existing = {n for n in base.namelist() if n.startswith('otp/omega_pocket/') and n.endswith('.beam')}
        assert existing == set(replacements), 'App module set changed; require a full runtime build'
        for entry in base.infolist():
            target.writestr(entry, replacements.get(entry.filename, base.read(entry.filename)))
    return output.getvalue()


def main():
    base_apk, compiled_dir, assets = map(Path, sys.argv[1:])
    modules = {p.name: p.read_bytes() for p in compiled_dir.glob('*.beam')}
    with zipfile.ZipFile(base_apk) as base:
        runtime = overlay_app(base.read('assets/bl-runtime.zip'), modules)
    digest = hashlib.sha256(runtime).hexdigest()
    (assets / 'bl-runtime.zip').write_bytes(runtime)
    (assets / 'bl-runtime.sha256').write_text(digest)
    print(f'App-only runtime: {len(modules)} fresh modules; SHA-256 {digest}')


if __name__ == '__main__':
    main()
