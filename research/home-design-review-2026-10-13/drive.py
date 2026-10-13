import json,os,socket,subprocess,tempfile,time,signal
from pathlib import Path
from urllib.request import Request,urlopen
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent;OUT.mkdir(exist_ok=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
assert port!=8790
results={'port':port,'privateWorld':True,'physicalPhone':False,'captures':{},'observations':[],'errors':[]}
(OUT/'launch.log').write_text('')
with tempfile.TemporaryDirectory(prefix='omega-home-design-') as temp:
 runtime=Path(temp)/'runtime';runtime.mkdir(mode=0o700)
 env={**os.environ,'XDG_STATE_HOME':temp+'/state','XDG_RUNTIME_DIR':str(runtime),'BL_GATEWAY':'off'};started=False
 def run(*args):
  r=subprocess.run([str(ROOT/'bin/bl'),*args],cwd=ROOT,env=env,capture_output=True,text=True,timeout=600)
  with (OUT/'launch.log').open('a') as f:f.write(r.stdout+r.stderr)
  assert r.returncode==0,(args,r.returncode,r.stdout,r.stderr)
  return r
 base=f'http://127.0.0.1:{port}'
 def intent(name,args):
  with urlopen(Request(base+'/api/intent',data=json.dumps({'intent':name,'args':args}).encode(),headers={'Content-Type':'application/json'}),timeout=30) as r:return json.load(r)
 try:
  run('omega','--','--browser','--demo','--port',str(port),'--db',temp+'/db');started=True
  for title in ['Review the live namespace','Finish the Pelagic performance','Read the architecture notes','Compare the two exports']:
   assert intent('task/open',{'goal':title,'title':title})['ok']
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox'])
   context=browser.new_context(viewport={'width':1400,'height':900},is_mobile=False)
   page=context.new_page();page.on('pageerror',lambda e:results['errors'].append(str(e)))
   def capture(name,selector):
    page.screenshot(path=str(OUT/(name+'.png')))
    results['captures'][name]=page.locator(selector).evaluate('''e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,font:s.font,color:s.color,background:s.backgroundColor,bodyWidth:document.body.scrollWidth,viewportWidth:innerWidth}}''')
   home=base+'/?use=home&layout=home&file=workspace:all'
   page.goto(home);page.locator('.omega-home h1').wait_for(timeout=90000)
   if 'unavailable' in page.locator('[data-status]').inner_text():page.get_by_role('button',name='Refresh work').click()
   page.get_by_role('button',name='Review the live namespace',exact=False).first.wait_for(timeout=60000)
   capture('01-home-desktop','.omega-home main')
   results['homeChrome']=page.evaluate('''()=>Object.fromEntries(['#titlebar','body>footer'].map(k=>[k,getComputedStyle(document.querySelector(k)).display]))''')
   results['homeHeadings']=page.locator('.omega-home h1').evaluate('e=>({font:getComputedStyle(e).font,marginBottom:getComputedStyle(e.parentElement).marginBottom})')
   page.set_viewport_size({'width':390,'height':844});capture('02-home-phone','.omega-home main')
   results['phoneRail']=page.locator('.omega-home nav').evaluate('e=>({width:e.getBoundingClientRect().width,labels:e.innerText})')
   results['homeButtons']=page.locator('.omega-home button').evaluate_all('es=>es.map(e=>({label:e.innerText,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))')
   page.locator('.omega-home nav [data-activity=work]').click()
   work=page.frame_locator('[data-pane=work] iframe');work.locator('.mobile-app').wait_for(timeout=90000)
   page.wait_for_timeout(1200);capture('03-home-work-phone','[data-pane=work] iframe')
   results['nestedWork']=work.locator('.mobile-app').evaluate('e=>({width:e.getBoundingClientRect().width,font:getComputedStyle(e).font,bottomNavigation:!!e.querySelector(".bottom-nav"),commands:!!e.querySelector("[data-act=commands]")})')
   page.locator('.omega-home nav [data-activity=home]').click();page.set_viewport_size({'width':320,'height':740});capture('04-home-small-phone','.omega-home main')
   from urllib.parse import quote
   page.set_viewport_size({'width':390,'height':844});page.goto(base+'/?use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile&file=workspace:all')
   page.locator('.mobile-app').wait_for(timeout=90000);page.locator('[data-act=new]').wait_for(timeout=60000);capture('05-pocket-work-phone','.mobile-app')
   results['pocketFonts']=page.locator('.mobile-app').evaluate('e=>({font:getComputedStyle(e).font,heading:getComputedStyle(e.querySelector("h1")).font,ink:getComputedStyle(e).color,background:getComputedStyle(document.body).backgroundColor})')
   page.locator('[data-act=commands]').first.click();page.locator('[role=dialog]').wait_for();capture('06-pocket-commands-phone','[role=dialog]')
   results['commands']=page.locator('[role=dialog]').inner_text()
   page.locator('[data-act=dismiss]').first.click()
   page.locator('[data-act=open-task]').first.click();page.locator('[data-field=reply]').wait_for(timeout=60000);page.locator('[data-field=reply]').fill('An unfinished thought about the live system');capture('07-pocket-task-phone','.mobile-app')
   page.set_viewport_size({'width':390,'height':500});capture('08-pocket-task-short','.mobile-app')
   page.set_viewport_size({'width':1400,'height':900});page.goto(base+'/?use=present,dwim,workspace,places,references,buffers,workbench&layout=inbox&file=workspace:all')
   page.locator('#panes [data-pane]').first.wait_for(timeout=60000);page.wait_for_timeout(1800);capture('09-desktop-editor','#panes')
   results['desktopText']=page.locator('body').inner_text()[:3500]
   browser.close()
 finally:
  if started:run('omega.stop')
  for log in Path(temp).glob('**/warm-*.log'):(OUT/'warm.log').write_bytes(log.read_bytes())
  for proc in Path('/proc').iterdir():
   if not proc.name.isdigit():continue
   try:
    if f'XDG_STATE_HOME={temp}/state'.encode()+b'\0' in (proc/'environ').read_bytes() and b'BeamLisp' in (proc/'cmdline').read_bytes():os.kill(int(proc.name),signal.SIGTERM)
   except (FileNotFoundError,PermissionError,ProcessLookupError):pass
  (OUT/'audit.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
