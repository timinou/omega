#!/usr/bin/env python3
"""Summarize retained live evidence without converting failed gates into passes."""
from pathlib import Path
import json, re, hashlib

root = Path(__file__).resolve().parents[3]
proof = root / 'spikes/pelagic/proof/performance/set'
report = json.loads((proof / 'report.json').read_text())
actions = json.loads((proof / 'actions.json').read_text())
accepted = [a for a in actions if a.get('result', {}).get('ok')]
sources = [a['command'].get('source', '') for a in accepted]
requests = [a['command'].get('request', {}) for a in accepted]
gestures = {}
for source in sources:
    for name in re.findall(r'\(av/gesture\s+:([\w-]+)', source):
        gestures[name] = gestures.get(name, 0) + 1
counts = {
    'acceptedPatternEdits': sum(len(re.findall(r'\(av/pattern\s', s)) for s in sources),
    'acceptedVisualLaunches': sum(len(re.findall(r'\(av/launch\s', s)) for s in sources),
    'gestures': gestures,
    'undo': sum(r.get('kind') == 'undo' for r in requests),
    'redo': sum(r.get('kind') == 'redo' for r in requests),
    'snapshotRecalls': sum(r.get('kind') == 'recall' for r in requests),
    'importedDeckFiles': sum(a['command']['op'] == 'import' for a in accepted),
    'rejectedLiveEdits': sum(a['command']['op'] == 'edit' and not a.get('result', {}).get('ok') for a in actions),
}
assets = {}
for path in sorted((proof.parent / 'assets').glob('*.wav')):
    assets[path.name] = {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
value = {
    'sourceCommit': report['sourceCommit'],
    'operator': 'agent-operated real editor; source changes evaluated with Control+Enter; no prerecorded musical action script',
    'counts': counts,
    'countMethod': 'Accepted edit requests, not a claim that every rapid/coalesced request produced a separate audible revision. The initial demo evaluation is excluded.',
    'status': report['status'], 'gates': report['gates'], 'metrics': report['metrics'],
    'heapGrowthPercent': report['heapGrowthPercent'], 'assets': assets,
    'capture': report['take'],
    'ending': 'Release gesture and ambient ending are in the original. An attempted manual fader fade arrived after the capture cutoff and is not part of the recording. Listening copies and highlight have explicitly labelled editorial fades.',
    'loudness': {
        'method': 'ffmpeg ebur128 true-peak analysis; native WebM and pre-encode listening master',
        'native': {'integratedLUFS': -21.1, 'rangeLU': 10.9, 'truePeakDBFS': -4.7},
        'listeningMaster': {'integratedLUFS': -18.1, 'rangeLU': 10.9, 'truePeakDBFS': -1.6},
    },
    'limits': 'Sample probes are separate silent graphs, not audible-voice loopback. AV submission does not measure display latency. Physical MIDI, mobile sustained playback and absence of device underruns are unproven. Twenty-minute evidence predates final UI/error/recovery fixes, which have shorter regression coverage.',
}
(proof / 'summary.json').write_text(json.dumps(value, indent=2) + '\n')
print(json.dumps(counts, indent=2))
