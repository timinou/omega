#!/usr/bin/env python3
"""Render actual private-browser evidence into a portable interactive review."""
import html,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
proof=root/'proof'
report=json.loads((proof/'browser.json').read_text())
scenes=[('Standalone inspector','inspector-used.png'),('Standalone unloaded','inspector-unused.png'),('Omega runtime','used.png'),('Omega unloaded','unused.png'),('Pelagic companion','pelagic-companion.png'),('Pocket companion','pocket-companion.png'),('Pocket narrow','pocket-narrow.png')]
items=''.join(f'<option value="{html.escape(file)}">{html.escape(label)}</option>' for label,file in scenes if (proof/file).exists())
checks=''.join('<li>'+html.escape(str(check))+'</li>' for check in report['checks'])
payload=html.escape(json.dumps(report,indent=2))
page='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Inspector extraction evidence</title><style>body{margin:2rem auto;max-width:1000px;padding:0 1rem;background:#111820;color:#e5edf6;font:16px/1.55 system-ui}h1{font-size:2rem}select{font:inherit;padding:.5rem;background:#253747;color:inherit}img{display:block;width:100%;margin-top:1rem;border:1px solid #526578}pre{overflow:auto}li{margin:.5rem 0}a{color:#8cdaeb}</style><h1>One inspector, domain contributions</h1><p>Recorded actions in a private offline memory world. These images show the real editor. No physical audio/video latency claim.</p><label>Recorded view <select id="scene">'''+items+'''</select></label><img id="shot" alt="Recorded editor view"><h2>Verified actions</h2><ol>'''+checks+'''</ol><details><summary>Raw browser result</summary><pre>'''+payload+'''</pre></details><p><a href="../inspector.bl.org">Source walkthrough</a></p><script>const s=document.querySelector('#scene'),i=document.querySelector('#shot');function show(){i.src=s.value;i.alt=s.selectedOptions[0].textContent} s.addEventListener('change',show);show();</script>'''
(proof/'inspector-report.html').write_text(page)
