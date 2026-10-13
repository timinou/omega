#!/usr/bin/env python3
"""Isolate native module-Worker startup from the application and task engine."""
import functools,http.server,json,os,re,signal,subprocess,tempfile,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];PROOF=ROOT/'spikes/home/proof';FRONT=Path(os.environ['HOME_FRONTEND'])
PAGE='''<!doctype html><h1>Native Worker diagnostic</h1><script>
window.result={events:[],errors:[],started:performance.now()};
function record(name,value){result.events.push({name,value,ms:performance.now()-result.started});}
for(const [name,url] of [['echo','/probe-echo.mjs'],['live','/probe-live.mjs']]){
 const w=new Worker(url,{type:'module'});w.onmessage=e=>{record(name,e.data);if(e.data.type==='booted'||e.data.type==='loaded')w.postMessage({id:2,value:null});};w.onerror=e=>result.errors.push({name,message:e.message});w.postMessage({id:1,value:null});
}
</script><script type="module">
import {d_client} from '/out/js.worker.mjs';
import '/out/pelagic.browser.mjs';
import {requireNamespace} from '/out/interop.mjs';
for(const [name,make] of [['compiled',d_client],['bridge',requireNamespace('pelagic.browser').evaluator]]){
 try{const c=make(new URL('/pkg/pelagic/live-worker.mjs',location.href));c.request(null).then(value=>record(name+'-done',{value}),e=>record(name+'-done',{error:String(e)}));}catch(e){record(name+'-done',{error:String(e),stack:e.stack});}
}
import {createStage} from '/pkg/pelagic/render-stage.mjs';
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;document.body.append(canvas);
const stage=await createStage(canvas,{error:e=>record('graphics-error',{error:String(e)})});
Promise.resolve(stage.ready).then(()=>record('graphics-done',stage.resources()),e=>record('graphics-done',{error:String(e)}));
</script>'''
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  values={'/probe':PAGE,'/probe-echo.mjs':"self.addEventListener('message',e=>postMessage({type:'echo',data:e.data}));postMessage({type:'booted'});",'/probe-live.mjs':"postMessage({type:'start'});import('/pkg/pelagic/live-worker.mjs').then(()=>postMessage({type:'loaded'}),e=>postMessage({type:'failed',error:String(e),stack:e.stack}));"}
  if self.path in values:
   self.send_response(200);self.send_header('Content-Type','text/html' if self.path=='/probe' else 'text/javascript');self.end_headers();self.wfile.write(values[self.path].encode());return
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(FRONT)));threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with tempfile.TemporaryDirectory(prefix='omega-native-worker-') as temp:
  temp=Path(temp);runtime=temp/'runtime';runtime.mkdir(mode=0o700);cfg=temp/'sway.cfg';cfg.write_text('output HEADLESS-1 resolution 1200x800 position 0 0\ndefault_border none\nswaybg_command -\n')
  env={**os.environ,'XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':str(temp/'state'),'BL_GATEWAY':'off','WLR_BACKENDS':'headless','WLR_LIBINPUT_NO_DEVICES':'1','WLR_RENDERER':'pixman','WAYLAND_DISPLAY':'','LIBGL_ALWAYS_SOFTWARE':'1'}
  with (temp/'sway.log').open('w') as log:
   sway=subprocess.Popen(['sway','-d','-c',str(cfg)],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   try:
    deadline=time.monotonic()+30
    while True:
     m=re.search("Running compositor on wayland display '([^']+)'",(temp/'sway.log').read_text())
     if m:break
     assert time.monotonic()<deadline;time.sleep(.1)
    env.update({'WAYLAND_DISPLAY':m[1],'GDK_BACKEND':'wayland','OMEGA_PROBE_DISPLAY':m[1],'OMEGA_PROBE_WIDTH':'1200','OMEGA_PROBE_HEIGHT':'800','HOME_WORKER_URL':f'http://127.0.0.1:{server.server_port}/probe','HOME_TEST_PROOF':str(PROOF)})
    r=subprocess.run([str(ROOT/'bin/bl'),'--cold','run',str(ROOT/'spikes/home/test/worker-native.bl')],cwd=ROOT,env=env,capture_output=True,text=True,timeout=150);print(r.stdout+r.stderr,flush=True);assert r.returncode==0
   finally:
    if sway.poll() is None:os.killpg(sway.pid,signal.SIGTERM);sway.wait(timeout=15)
finally:server.shutdown();server.server_close()
