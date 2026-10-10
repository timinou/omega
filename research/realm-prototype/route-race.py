import os,pathlib,subprocess,tempfile,time,threading,json
# This intentionally needs two OS VMs to prove cross-process admission.
# Run under one systemd memory/time ceiling; never against a live registry.
bl=os.environ.get('OMEGA_BL','/home/user/code/undefine/beam-lisp/bin/bl')
checkout=pathlib.Path(bl).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='omega-route-race-') as d:
 root=pathlib.Path(d);runtime=root/'runtime';runtime.mkdir(mode=0o700)
 env={**os.environ,'XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':str(root/'state')}
 processes=[];lines=[[],[]];readers=[]
 def read(i,p):
  for line in p.stdout:lines[i].append(line.rstrip())
 try:
  for i in range(2):
   script=root/f'claim-{i}.bl'
   script.write_text(f'''(ns route.race{i} (:require [vm.ports :as ports] [omega.artifacts :as artifacts]))
(File/write! "{root}/ready-{i}" "ready")
(loop [] (when-not (File/exists? "{root}/go") (timer/sleep 5) (recur)))
(let [claim (ports/claim "race-{i}" 0 {{:root "{root}/world-{i}" :hosts ["cross-process.localhost"] :service true}})]
 (println (str "RESULT " (if (:ok claim) "accepted" "refused")))
 (loop [] (when-not (File/exists? "{root}/release") (timer/sleep 5) (recur)))
 (when (:ok claim) (ports/release "race-{i}" {{:root "{root}/world-{i}" :generation (:generation claim)}})))
''')
   extra='''
(artifacts/coordinated "@ROOT@/.publisher.lock"
 (fn []
  (if (File/exists? "@ROOT@/published/.frontend")
   (println "ARTIFACT reused")
   (let [stage (artifacts/stage! "@ROOT@/published")]
    (File/write! (str stage "/.frontend") "one publication")
    (artifacts/publish! stage "@ROOT@/published" ".frontend")
    (println "ARTIFACT built")))))
(File/write! "@ROOT@/artifact-@INDEX@" "ready")
(loop [] (when-not (and (File/exists? "@ROOT@/artifact-0") (File/exists? "@ROOT@/artifact-1")) (timer/sleep 5) (recur)))
''' 
   if i==0:
    extra+='''
(artifacts/coordinated "@ROOT@/.publisher.lock"
 (fn [] (artifacts/stage! "@ROOT@/abandoned") (println "CRASH_READY") (receive :never nil)))
'''
   else:
    extra+='''
(loop [] (when-not (File/exists? "@ROOT@/recover") (timer/sleep 5) (recur)))
(artifacts/coordinated "@ROOT@/.publisher.lock"
 (fn [] (artifacts/clean-stages! "@ROOT@") (println "RECOVERED")))
'''
   script.write_text(script.read_text()+extra.replace('@ROOT@',str(root)).replace('@INDEX@',str(i)))
   p=subprocess.Popen([bl,'--cold','run','-p',str(pathlib.Path(__file__).resolve().parents[2]/'src'),str(script)],cwd=checkout,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
   processes.append(p)
   reader=threading.Thread(target=read,args=(i,p),daemon=True);readers.append(reader);reader.start()
  deadline=time.monotonic()+120
  while not all((root/f'ready-{i}').exists() for i in range(2)):
   if time.monotonic()>deadline or any(p.poll() is not None for p in processes):raise RuntimeError(lines)
   time.sleep(.02)
  (root/'go').write_text('go')
  while not all(any(x.startswith('RESULT ') for x in ls) for ls in lines):
   if time.monotonic()>deadline:raise RuntimeError(lines)
   time.sleep(.02)
  results=[next(x for x in ls if x.startswith('RESULT ')) for ls in lines]
  assert sorted(results)==['RESULT accepted','RESULT refused'],results
  (root/'release').write_text('release')
  deadline=time.monotonic()+120
  while not (any(x=='CRASH_READY' for x in lines[0]) and all(any(x.startswith('ARTIFACT ') for x in ls) for ls in lines)):
   if time.monotonic()>deadline:raise RuntimeError(lines)
   time.sleep(.02)
  artifacts=[next(x for x in ls if x.startswith('ARTIFACT ')) for ls in lines]
  assert sorted(artifacts)==['ARTIFACT built','ARTIFACT reused'],artifacts
  processes[0].kill();processes[0].wait(timeout=10)
  (root/'recover').write_text('recover')
  assert processes[1].wait(timeout=30)==0,lines
  readers[1].join(timeout=2)
  assert 'RECOVERED' in lines[1],lines
  assert not list(root.glob('abandoned.stage-*'))
  assert (root/'published/.frontend').read_text()=='one publication'
  print(json.dumps({'crossProcessHostnameAdmission':True,'results':results,'oneArtifactPublication':True,'artifactResults':artifacts,'deadPublisherRecovery':True}))
 finally:
  for p in processes:
   if p.poll() is None:p.terminate()
  for p in processes:
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:p.kill();p.wait()
