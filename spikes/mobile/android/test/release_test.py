"""Android upgrades require a new version even when reusing a generated tree."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('pocket_release', Path(__file__).resolve().parents[1] / 'release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

for old_name, old_code in [('1.0', 1), ('0.1.0', 2026101401)]:
    original = f'defaultConfig {{\n versionName "{old_name}"\n versionCode {old_code}\n minSdkVersion 28\n}}'
    result = release.release_versions(original, release.VERSION, release.VERSION_CODE)
    assert f'versionName "{release.VERSION}"' in result
    assert f'versionCode {release.VERSION_CODE}' in result
    assert 'minSdkVersion 28' in result
    assert release.release_versions(result, release.VERSION, release.VERSION_CODE) == result
assert release.VERSION_CODE > 2026101401
for invalid in ['', 'versionName "1.0"', 'versionName "1.0"\nversionCode 1\nversionCode 2']:
    try:
        release.release_versions(invalid, release.VERSION, release.VERSION_CODE)
    except ValueError:
        pass
    else:
        raise AssertionError('Missing or duplicate release fields must fail')
print('PASS upgrade identity, template/reused project, idempotence and malformed-field rejection')
