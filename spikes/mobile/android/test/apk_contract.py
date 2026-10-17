"""Inspect the shipped runtime, rather than trusting checkout code or APK age."""
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import zipfile
import zlib


def beam_literals(beam):
    chunks = []
    offset = 12
    while offset + 8 <= len(beam):
        tag = beam[offset:offset + 4]
        size = struct.unpack('>I', beam[offset + 4:offset + 8])[0]
        data = beam[offset + 8:offset + 8 + size]
        if tag == b'LitT':
            # OTP supports both compressed and uncompressed literal tables.
            try:
                chunks.append(zlib.decompress(data[4:]))
            except zlib.error:
                chunks.append(data[4:])
        offset += 8 + ((size + 3) // 4) * 4
    return b''.join(chunks)


def inspect(apk_bytes, compiled):
    with zipfile.ZipFile(io.BytesIO(apk_bytes)) as apk:
        runtime_bytes = apk.read('assets/bl-runtime.zip')
        expected = apk.read('assets/bl-runtime.sha256').decode().strip()
        assert hashlib.sha256(runtime_bytes).hexdigest() == expected, 'Runtime digest mismatch'
        assert {n.split('/')[1] for n in apk.namelist() if n.startswith('lib/')} == {'arm64-v8a'}
        with zipfile.ZipFile(io.BytesIO(runtime_bytes)) as runtime:
            app = {Path(n).name: runtime.read(n) for n in runtime.namelist()
                   if n.startswith('otp/omega_pocket/') and n.endswith('.beam')}
    assert app and all(app.get(name) == content for name, content in compiled.items()), 'APK contains stale app modules'
    home = app['Elixir.BeamLisp.Ns.Pocket.Home.beam']
    literals = beam_literals(home)
    assert b'Enter a private Tailscale HTTPS address, with port 8443 if needed.' not in literals, 'Old port restriction shipped'
    assert b'https://work.tailnet.ts.net:18001' in literals, 'Current connection validation missing'
    return {'sha256': hashlib.sha256(apk_bytes).hexdigest(), 'bytes': len(apk_bytes),
            'runtimeSHA256': expected, 'appModulesMatchCompiledTree': len(compiled),
            'oldPortMessageAbsent': True, 'currentPortMessagePresent': True}


def main():
    apk = Path(sys.argv[1])
    compiled_dir = Path(sys.argv[2])
    compiled = {p.name: p.read_bytes() for p in compiled_dir.glob('*.beam')}
    assert compiled, 'Supply the freshly compiled app directory'
    print(json.dumps(inspect(apk.read_bytes(), compiled), indent=2))


if __name__ == '__main__':
    main()
