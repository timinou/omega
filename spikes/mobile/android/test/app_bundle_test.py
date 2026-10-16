"""An app update must preserve the tested runtime and its user-facing ABI."""
import importlib.util
import io
from pathlib import Path
import zipfile

spec = importlib.util.spec_from_file_location('app_bundle', Path(__file__).resolve().parents[1] / 'app_bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)

fixture = io.BytesIO()
with zipfile.ZipFile(fixture, 'w') as out:
    out.writestr('otp/lib/beam_lisp-0.1.0/ebin/core.beam', b'tested-core')
    out.writestr('otp/lib/beam_lisp-0.1.0/priv/native/lazy_memo.so', b'tested-native')
    out.writestr('otp/omega_pocket/home.beam', b'old-validation')
result = bundle.overlay_app(fixture.getvalue(), {'home.beam': b'new-validation'})
with zipfile.ZipFile(io.BytesIO(result)) as out:
    assert out.read('otp/lib/beam_lisp-0.1.0/ebin/core.beam') == b'tested-core'
    assert out.read('otp/lib/beam_lisp-0.1.0/priv/native/lazy_memo.so') == b'tested-native'
    assert out.read('otp/omega_pocket/home.beam') == b'new-validation'
    assert len(out.namelist()) == 3
for modules in [{}, {'other.beam': b'changed-ABI'}, {'../home.beam': b'unsafe-path'}]:
    try:
        bundle.overlay_app(fixture.getvalue(), modules)
    except AssertionError:
        pass
    else:
        raise AssertionError('Empty, changed or unsafe module sets must fail')
print('PASS app replacement preserves runtime/native bytes; rejects incompatible module sets')
