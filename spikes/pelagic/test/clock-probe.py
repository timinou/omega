#!/usr/bin/env python3
"""Measure native browser audio-clock progress independently of PELAGIC graphics."""
from pathlib import Path
import json,os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[3];target=root/'spikes/pelagic/proof/performance/clock-probe.json'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
 page=browser.new_page();page.goto('about:blank')
 result=page.evaluate('''async()=>{
 const specs=[{latencyHint:'interactive'},{latencyHint:'interactive',sampleRate:44100},{latencyHint:'interactive',sampleRate:48000},{latencyHint:'playback'}];
 const contexts=specs.map(options=>{const c=new AudioContext(options),o=c.createOscillator(),g=c.createGain();g.gain.value=.000001;o.connect(g).connect(c.destination);o.start();return c;});
 await Promise.all(contexts.map(c=>c.resume()));await new Promise(r=>setTimeout(r,1000));
 const starts=contexts.map(c=>({audio:c.currentTime,wall:performance.now()}));await new Promise(r=>setTimeout(r,15000));
 const results=contexts.map((c,i)=>{const wall=(performance.now()-starts[i].wall)/1000,audio=c.currentTime-starts[i].audio;return {options:specs[i],sampleRate:c.sampleRate,baseLatency:c.baseLatency,outputLatency:c.outputLatency,wallSeconds:wall,audioSeconds:audio,clockRate:audio/wall,outputTimestamp:c.getOutputTimestamp?.()};});
 await Promise.all(contexts.map(c=>c.close()));return {browser:navigator.userAgent,method:'15-second wall/audio differences after one-second warmup; four minimal native contexts; no graphics or PELAGIC DSP',results};
 }''')
 browser.close()
target.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
