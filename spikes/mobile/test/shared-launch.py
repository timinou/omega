#!/usr/bin/env python3
"""Pocket uses the actual root BL task in a private runtime and disposable store."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
from urllib.request import urlopen, Request

ROOT = Path(__file__).resolve().parents[3]
PROOF = ROOT / 'spikes/mobile/proof/shared-world'
PROOF.mkdir(parents=True, exist_ok=True)
(PROOF/'launch.log').write_text('')
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
assert port != 8790
with tempfile.TemporaryDirectory(prefix='omega-pocket-proof-') as temp:
    work = Path(temp) / 'work'
    work.mkdir()
    (work / 'long.bl.org').write_text('#+TITLE: Long document\n\n* Section 1\nSelected words for the model.\n\n' + ''.join(f'\n* Section {i}\n' + ''.join(f'Paragraph {j}: a document for reading across devices.\n' for j in range(16)) for i in range(2, 25)) + '\nThe needle is here.\n[[work:test/linked.bl.org][Follow reference]]\n')
    (work / 'linked.bl.org').write_text('#+TITLE: Linked document\n\nReturn to the retained reading position.\n')
    (work / 'review.bl.org').write_text('First line\nOriginal detail\nLast line\n')
    (work / 'shared.bl.org').write_text('Original shared text\n')
    runtime = Path(temp) / 'runtime'
    runtime.mkdir(mode=0o700)
    env = {**os.environ, 'XDG_RUNTIME_DIR': str(runtime), 'XDG_STATE_HOME': str(Path(temp) / 'state'), 'BL_GATEWAY': 'off'}
    db = str(Path(temp) / 'world/db')
    base = f'http://127.0.0.1:{port}'
    def run(name, *args, good=True):
        result = subprocess.run([str(ROOT/'bin/bl'), name, '--', *args], cwd=ROOT, env=env, text=True, capture_output=True, timeout=1800)
        with (PROOF/'launch.log').open('a') as output:
            output.write(result.stdout + result.stderr)
        assert (result.returncode == 0) == good, (name, result.returncode, result.stdout, result.stderr)
        return result
    def doc(address):
        with urlopen(base+'/api/doc?path='+address, timeout=10) as response:
            return json.load(response)
    def owners():
        found = []
        for p in Path('/proc').iterdir():
            if p.name.isdigit():
                try:
                    if f'XDG_RUNTIME_DIR={runtime}'.encode()+b'\0' in (p/'environ').read_bytes() and b'BeamLisp' in (p/'cmdline').read_bytes():
                        found.append(int(p.name))
                except (FileNotFoundError, PermissionError, ProcessLookupError):
                    pass
        return found
    try:
        run('pocket', '--port', str(port), '--db', db)
        initial = owners()
        assert len(initial) == 1, initial
        identity = doc('launch:identity')['text']
        for name in ['pocket', 'omega.dev', 'pelagic.dev']:
            run(name, '--port', str(port), '--db', db)
            assert owners() == initial
            assert doc('launch:identity')['text'] == identity
        subprocess.run([str(ROOT/'bin/omega-ui'), '--demo', '--port', str(port), '--db', db, '--root', str(work)], cwd=ROOT, env=env, check=True, capture_output=True, text=True, timeout=120)
        assert owners() == initial and doc('launch:identity')['text'] == identity
        # Mode/store disagreements are refused before any mutation.
        run('pocket', '--port', str(port), '--db', db, '--live', good=False)
        assert doc('launch:identity')['text'] == identity
        mismatch = subprocess.run([str(ROOT/'bin/omega'), '--no-start', '--url', base, 'list'], env=env, capture_output=True, text=True)
        assert mismatch.returncode == 2 and 'scripted' in mismatch.stderr
        with (PROOF/'browser.log').open('w') as output:
            subprocess.run(['node', str(ROOT/'spikes/mobile/test/shared-browser.mjs')], cwd=ROOT, env={**env, 'POCKET_TEST_URL': base, 'POCKET_TEST_ROOT': str(work)}, check=True, timeout=300, stdout=output, stderr=subprocess.STDOUT)
        with (PROOF/'touch-browser.log').open('w') as output:
            subprocess.run(['node', str(ROOT/'spikes/mobile/test/touch-browser.mjs')], cwd=ROOT, env={**env, 'POCKET_TEST_URL': base, 'POCKET_TEST_ROOT': str(work)}, check=True, timeout=300, stdout=output, stderr=subprocess.STDOUT)
        cli = subprocess.run([str(ROOT/'bin/omega'), '--no-start', '--offline', '--url', base, '--root', str(work), '--json', 'Shell work'], cwd=work, env=env, check=True, capture_output=True, text=True)
        opened = json.loads(cli.stdout)
        task_doc = doc(opened['path'])
        assert task_doc['data']['cwd'] == str(work)
        saved = doc('workspace:all')
        assert 'Shell work' in saved['text'] and 'Phone work' in saved['text']
        saved_tasks = {o['key'] for o in saved['objects'] if o['type']=='omega/task'}
        assert task_doc['data']['task-title'] == 'Shell work'
        def persistence(name):
            with urlopen(Request(base+'/api/intent', data=json.dumps({'intent':'world/eval','args':{'code':'{:env (select-keys (:env world) [:path :world]) :tasks (count (omega.task/all world))}'}}).encode(), headers={'Content-Type':'application/json'}), timeout=30) as response:
                machine=json.load(response)
            (PROOF/name).write_text(json.dumps({'workspace':doc('workspace:all'),'identity':doc('launch:identity'),'machine':machine,'files':[(str(p.relative_to(db)),p.stat().st_size) for p in Path(db).rglob('*') if p.is_file()]},indent=2)+'\n')
        persistence('persistence-before.json')
        run('omega.stop')
        with socket.socket() as sock:
            assert sock.connect_ex(('127.0.0.1', port)) != 0
        assert owners() == initial
        run('pocket', '--port', str(port), '--db', db)
        restored = doc('workspace:all')
        persistence('persistence-after.json')
        assert {o['key'] for o in restored['objects'] if o['type']=='omega/task'} == saved_tasks
        assert doc(opened['path'])['data']['task-title'] == 'Shell work'
        assert doc('work:test/shared.bl.org')['text'] == 'Phone overlapping draft\n'
        assert doc('changes:work:test/shared.bl.org')['objects']
        assert owners() == initial
        run('omega.stop')
        summary = {'oneSharedVm': True, 'presetsReuseWorld': True, 'modeMismatchRefused': True, 'shellCwdPreserved': True, 'durableTasksPlacesAndBufferHistory': True, 'listenerCloses': True, 'liveWorldUntouched': True}
        (PROOF/'launch.json').write_text(json.dumps(summary, indent=2)+'\n')
        print(json.dumps(summary))
    finally:
        for pid in owners():
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline=time.monotonic()+5
        while owners() and time.monotonic()<deadline:
            time.sleep(.05)
        for pid in owners():
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
