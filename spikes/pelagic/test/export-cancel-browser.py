#!/usr/bin/env python3
"""Export cancellation and package unload, in an isolated real editor."""
import functools, http.server, json, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('PELAGIC_LOCAL_OUT', ROOT / 'dist/local'))
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'checks': [], 'errors': []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM', '/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'), args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        page = browser.new_page()
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('document.querySelector(".view-host .view-body")?.pelagic', timeout=90000)
        page.evaluate('document.querySelector(".view-host .view-body").pelagic.ready()')
        source = page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
        for point in ['before', 'first-chunk', 'suspension']:
            result = page.evaluate("""async point => {
                const host=document.querySelector('.view-host .view-body').pelagic, controller=new AbortController();
                if(point==='before')controller.abort();
                const started=performance.now();
                try { await host.renderAudio(undefined,{seconds:4,sampleRate:22050,signal:controller.signal,onProgress:p=>{
                    if((point==='first-chunk'&&p==='first-chunk')||(point==='suspension'&&typeof p==='number'))controller.abort();
                }});return {error:'unexpected success'}; }
                catch(e){return {error:e.name,ms:performance.now()-started};}
            }""", point)
            assert result['error'] == 'AbortError', result
            assert result['ms'] < 5000, result
            report['checks'].append({'point': point, **result})
        page.locator('#input-sink').focus()
        page.keyboard.press(':');page.keyboard.insert_text('(+ 1 2)');page.keyboard.press('Enter')
        page.wait_for_function('window.blRepl', timeout=90000)
        page.evaluate("""()=>{
            const host=document.querySelector('.view-host .view-body').pelagic;
            window.exportSettled=null;window.exportOwner=host;
            host.renderAudio(undefined,{seconds:60,sampleRate:22050,onProgress:p=>{
                if(p==='first-chunk'){
                    const {R,K,dispatch}=window.blEd;
                    dispatch(R.hashMap(K('type'),K('key'),K('key'),':'));
                    dispatch(R.hashMap(K('type'),K('text'),K('text'),'(ed/unuse "pelagic")'));
                    dispatch(R.hashMap(K('type'),K('key'),K('key'),'Enter'));
                }
            }}).then(()=>window.exportSettled='unexpected success',e=>window.exportSettled={name:e.name,message:e.message,stack:e.stack});
        }""")
        page.wait_for_function('window.exportSettled!==null', timeout=5000)
        assert page.evaluate('window.exportSettled.name') == 'AbortError', page.evaluate('window.exportSettled')
        assert page.evaluate('!document.querySelector(".view-host .view-body")?.pelagic')
        assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))') == source
        report['checks'].append({'point':'real-editor-unuse','error':'AbortError','sourcePreserved':True})
        page.wait_for_timeout(500)
        assert not report['errors'], report['errors']
        browser.close()
finally:
    server.shutdown();server.server_close()
print(json.dumps(report, indent=2))
