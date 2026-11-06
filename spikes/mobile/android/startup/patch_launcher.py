"""Insert only startup status hooks in the unchanged, signed-base launcher.

Run on Build. The native ABI and existing runtime entry remain unchanged.
"""
from pathlib import Path
import sys


def patch(text):
    assert 'StartupStatus;->' not in text, 'Launcher already has startup status hooks'
    attach = '    invoke-static {p0}, Lorg/beamlisp/omega/pocket/StartupStatus;->attach(Landroid/app/Activity;)V\n\n'
    before = '    invoke-direct {p0}, Lorg/beamlisp/omega/pocket/MainActivity;->extractPythonAssetsIfNeeded()V'
    assert text.count(before) == 1, 'Unexpected launcher: missing unique startup insertion point'
    text = text.replace(before, attach + before)
    before = '    invoke-virtual {p0}, Lorg/beamlisp/omega/pocket/MainActivity;->nativeStartBeam()V'
    assert text.count(before) == 1, 'Unexpected launcher: missing unique native runtime entry'
    phase = ('    const-string v0, "Starting Pocket virtual machine…"\n\n'
             '    invoke-static {v0}, Lorg/beamlisp/omega/pocket/StartupStatus;->phase(Ljava/lang/String;)V\n\n')
    return text.replace(before, phase + before)


if __name__ == '__main__':
    path = Path(sys.argv[1])
    path.write_text(patch(path.read_text()))
