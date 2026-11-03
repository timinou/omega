import urllib.request,urllib.error,urllib.parse,json,hashlib
from pathlib import Path
base='http://127.0.0.1:8794'
def request(path,owner='owner@example.test',body=None,origin=None):
 headers={}
 if owner:headers['tailscale-user-login']=owner
 if origin:headers['Origin']=origin
 if body is not None:headers['Content-Type']='application/json'
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 try:r=urllib.request.urlopen(req,timeout=60)
 except urllib.error.HTTPError as e:r=e
 raw=r.read()
 try:data=json.loads(raw)
 except ValueError:data=raw.decode(errors='replace')
 return r.status,data
checks=[]
for owner in [None,'other@example.test']:
 status,data=request('/api/doc?path=project:project/review.bl.org',owner)
 assert status==403 and 'Documents, without' not in json.dumps(data)
checks.append('anonymous and another account rejected before document resolution')
status,d=request('/api/doc?path=project:project/review.bl.org');assert status==200 and d['ok']
u=d['data']['dossier']['url'].replace('/view','/')
for endpoint in ['view','src','rev','doc','answers']:
 for owner in [None,'other@example.test']:
  status,_=request(u+endpoint,owner);assert status==403,(endpoint,status)
status,_=request(u+'answer','other@example.test',{'id':'direction','answer':'Keep it','note':'unauthorized','base':d['rev']});assert status==403
checks.append('render/source/revisions/answers and writes use the same account policy')
status,_=request('/api/doc?path=project:project/review.bl.org',origin='https://unrelated.example');assert status==403
status,result=request(u+'answer',body={'id':'direction','answer':'Keep it','note':'Private HTTP acceptance','base':d['rev']});assert status==200 and result['ok'],result
status,_=request(u+'answer',body={'id':'direction','answer':'Needs a change','note':'stale','base':d['rev']});assert status==409
checks.append('guarded answer saves and stale concurrent answer is refused')
status,full=request('/api/doc?path='+urllib.parse.quote('file:///tmp/omega-dossier-prototype/review.bl.org'));assert status==200 and full['rev']==result['rev'] and full['data']['document']==d['data']['document']
checks.append('project and full-file reads converge on accepted answer revision')
Path('spikes/workspace/dossier/proof/http.json').write_text(json.dumps({'checks':checks,'scope':'Isolated configured-owner middleware fixture with synthetic identity headers; not deployed Tailscale authentication'},indent=2))
print(json.dumps(checks,indent=2))
