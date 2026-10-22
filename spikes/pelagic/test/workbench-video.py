#!/usr/bin/env python3
"""Record the real offline workbench and its browser-produced music."""
import json, os, re, subprocess, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / 'proof/workbench'
RAW = Path('/tmp/pelagic-workbench-video')
RAW.mkdir(exist_ok=True)
URL = 'http://127.0.0.1:8792/?use=pelagic&layout=pelagic-gen&file=composer.bl.org'
Q = "document.querySelector('[data-pelagic-workbench]').pelagicWorkspace"
S = "window.blEd.state().get(window.blEd.K('pkg-state')).get('pelagic').get(window.blEd.K('workbench'))"
report = {'url': URL, 'errors': [], 'captions': [], 'audio': 'Actual browser AudioContext output, with +9 dB export gain; no added soundtrack or narration.'}

# Tap the existing speaker output into a second destination. The application's
# graph, scheduler and normal speaker connection are retained.
TAP = """(() => {
 const connect = AudioNode.prototype.connect, taps = new WeakMap();
 AudioNode.prototype.connect = function(destination, ...args) {
   const result = connect.call(this, destination, ...args);
   const ctx = this.context;
   if (destination === ctx.destination && ctx instanceof AudioContext) {
     let tap = taps.get(ctx);
     if (!tap) {tap = {ctx, dest: ctx.createMediaStreamDestination()}; taps.set(ctx, tap);}
     connect.call(this, tap.dest, args[0] || 0, 0);
     window.videoAudioTap = tap;
   }
   return result;
 };
})();"""

def stamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'

def main():
    for _ in range(180):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8792/pelagic-build.json', timeout=2) as response:
                report['frontend'] = json.load(response)['inputs']
            break
        except OSError:
            time.sleep(1)
    else:
        raise RuntimeError('Offline recording host did not become ready')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=os.environ.get('CHROMIUM', '/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),
            headless=True, args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        context = browser.new_context(viewport={'width': 1440, 'height': 1000},
            record_video_dir=str(RAW), record_video_size={'width': 1440, 'height': 1000}, accept_downloads=True)
        context.add_init_script(TAP)
        video_start = time.monotonic()
        page = context.new_page()
        page.set_default_timeout(60000)
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.goto(URL)
        page.wait_for_function('window.blEd && document.querySelector("[data-pelagic-workbench]")', timeout=180000)
        page.evaluate(Q + '.compilerReady()')
        page.get_by_role('button', name='Play the current document', exact=True).click()
        page.wait_for_function(Q + ".stats().phase==='ACTIVE' && " + Q + ".stats().patterns.includes('bass')", timeout=90000)
        page.wait_for_timeout(4000)
        page.wait_for_function('window.videoAudioTap && window.videoAudioTap.ctx.state === "running"')
        audio_start = time.monotonic()
        page.evaluate("""() => {
          const tap = window.videoAudioTap;
          tap.chunks = [];
          tap.recorder = new MediaRecorder(tap.dest.stream, {mimeType:'audio/webm;codecs=opus', audioBitsPerSecond:192000});
          tap.recorder.ondataavailable = event => tap.chunks.push(event.data);
          tap.recorder.start(500);
        }""")
        def caption(text):
            report['captions'].append({'at': round(time.monotonic() - audio_start, 3), 'text': text})
            print(text, flush=True)
        def keys(sequence):
            page.locator('#input-sink').focus()
            for key in sequence.split():
                page.keyboard.press(key)
                page.wait_for_timeout(140)
        def ready():
            page.wait_for_function("!['generating','checking'].includes(" + S + ".get(window.blEd.K('phase')))", timeout=150000)
            error = page.evaluate(S + ".get(window.blEd.K('error'))")
            assert not error, str(error)
        def write(locator, text):
            locator.fill(text)
            page.wait_for_timeout(1400)
        caption('PELAGIC  /  Three live voices. The sound comes from this code.')
        page.wait_for_timeout(4000)
        caption('Select kick + bass together.  Shift-click adds a second target.')
        page.get_by_role('button', name='Select kick-pattern', exact=True).click()
        page.wait_for_timeout(800)
        page.get_by_role('button', name='Select bass-pattern', exact=True).click(modifiers=['Shift'])
        page.wait_for_timeout(1800)
        caption('g a  /  Ask about the selected code while the music keeps playing.')
        keys('g a')
        local = page.locator('.view-prompt')
        local.get_by_role('combobox', name='Request provider').select_option('gen')
        local.get_by_role('button', name='Ask about code', exact=True).click()
        write(local.get_by_role('textbox', name='Local request'), 'Explain how this kick and bass interlock in two short sentences.')
        local.get_by_role('textbox', name='Local request').press('Enter')
        ready()
        caption('Gen explains the selection. Ask leaves the code and playing revision unchanged.')
        page.wait_for_timeout(5000)
        keys('g q')
        session = page.locator('.workbench.view-session')
        caption('g q  /  Session keeps questions, answers and follow-ups with their source targets.')
        page.wait_for_timeout(4000)
        page.get_by_role('button', name='Close Session', exact=True).click()
        caption('Change the same selection: make both patterns sparser.')
        local.get_by_role('button', name='Change code', exact=True).click()
        write(local.get_by_role('textbox', name='Local request'), 'Keep only the first event in each pattern. Preserve function signatures and event values.')
        local.get_by_role('textbox', name='Local request').press('Enter')
        ready()
        status = page.evaluate(S + ".get(window.blEd.K('entries')).toArray().at(-1).get(window.blEd.K('status'))")
        assert status == 'changed', status
        caption('The two generated replacements update the draft together, as one undoable edit.')
        page.wait_for_timeout(3000)
        before = page.evaluate(Q + '.stats().revision')
        keys('Escape Control+Enter')
        page.wait_for_function(Q + '.stats().revision > ' + str(before), timeout=30000)
        caption('Ctrl+Enter  /  Publish the edit at a musical boundary. Hear the extra space.')
        page.wait_for_timeout(7000)
        keys('g v')
        caption('g v  /  Components move into their source positions: one working column.')
        page.wait_for_timeout(4000)
        page.get_by_role('button', name='Select bass-pattern', exact=True).click()
        page.get_by_role('button', name='Peek bass-pattern source', exact=True).click()
        caption('g c  /  Peek inside a component to edit its actual source.')
        page.wait_for_timeout(4000)
        page.get_by_role('button', name='Peek bass-pattern source', exact=True).click()
        keys('g v g q')
        caption('One document, two presentations, and the conversation kept beside your music.')
        page.screenshot(path=str(PROOF / 'video-poster.png'))
        page.wait_for_timeout(5000)
        report['final_revision'] = page.evaluate(Q + '.stats().revision')
        report['content_seconds'] = round(time.monotonic() - audio_start, 3)
        with page.expect_download() as download:
            page.evaluate("""async () => {
              const tap = window.videoAudioTap;
              await new Promise(resolve => {tap.recorder.onstop = resolve; tap.recorder.stop();});
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob(tap.chunks, {type:'audio/webm'}));
              a.download = 'pelagic-browser-audio.webm'; a.click();
            }""")
        download.value.save_as(str(RAW / 'audio.webm'))
        video = page.video
        video_end = time.monotonic()
        context.close()
        video.save_as(str(RAW / 'browser.webm'))
        browser.close()
    assert not report['errors'], report['errors']
    def probe(path):
        return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)], text=True))
    raw = probe(RAW / 'browser.webm')
    # Native Playwright capture may begin slightly after page creation. Correct
    # that initial delay using the completed recording's observed duration.
    correction = float(raw['format']['duration']) - (video_end - video_start)
    offset = max(0, audio_start - video_start + correction)
    report['video_trim_seconds'] = round(offset, 3)
    captions = report['captions']
    def ass_stamp(seconds):
        cs = round(seconds * 100)
        return f'{cs // 360000:01}:{cs // 6000 % 60:02}:{cs // 100 % 60:02}.{cs % 100:02}'
    ass = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 1064
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,22,&H003F3026,&H003F3026,&H00F1EBE3,&H00F1EBE3,0,0,0,0,100,100,0,0,1,0,0,2,24,24,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    for i, c in enumerate(captions):
        end = captions[i+1]['at'] if i+1 < len(captions) else report['content_seconds']
        ass += f"Dialogue: 0,{ass_stamp(c['at'])},{ass_stamp(end)},Default,,0,0,0,,{c['text']}\n"
    (RAW / 'captions.ass').write_text(ass)
    output = PROOF / 'pelagic-walkthrough.mp4'
    filters = f"pad=iw:ih+64:0:0:color=0xf1ebe3,ass={RAW}/captions.ass"
    subprocess.run(['ffmpeg', '-y', '-ss', str(offset), '-i', str(RAW/'browser.webm'), '-i', str(RAW/'audio.webm'),
        '-map', '0:v:0', '-map', '1:a:0', '-vf', filters, '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-af', 'aresample=async=1:first_pts=0,volume=9dB,afade=t=in:d=0.15', '-shortest',
        '-movflags', '+faststart', str(output)], check=True, stdout=subprocess.DEVNULL, stderr=(RAW/'encode.log').open('w'))
    report['output'] = str(output.relative_to(ROOT))
    report['media'] = probe(output)
    levels = subprocess.run(['ffmpeg', '-i', str(output), '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    peak = re.search(r'max_volume: (-?[0-9.]+) dB', levels.stderr)
    assert peak and float(peak.group(1)) > -60, 'Captured audio is silent'
    report['audio_peak_db'] = float(peak.group(1))
    assert any(s['codec_type'] == 'audio' for s in report['media']['streams'])
    print(f"Saved {output} ({report['media']['format']['duration']} seconds, peak {peak.group(1)} dB)", flush=True)

try:
    main()
finally:
    (PROOF / 'video.json').write_text(json.dumps(report, indent=2) + '\n')
