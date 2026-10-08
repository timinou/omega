#!/usr/bin/env python3
"""Record only package/runtime hashes and non-sensitive machine pressure facts."""
from pathlib import Path
import hashlib,json,os,platform,subprocess,sys,datetime
root=Path(__file__).resolve().parents[3]
files=[]
for folder in ['spikes/pelagic/pelagic','spikes/pelagic/host','spikes/pelagic/shaders','vendor/bl-ed/web/out','vendor/bl-ed/web/pkg/pelagic']:
 files.extend(p for p in (root/folder).glob('*') if p.is_file() and p.suffix in ['.bl','.mjs','.glsl','.css'])
files.extend(root/p for p in ['vendor/bl-ed/web/host.mjs','vendor/bl-ed/web/package-hosts.mjs','vendor/bl-ed/ed/core.bl','vendor/bl-ed/ed/main.bl'])
value={'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
 'platform':platform.platform(),'cpus':os.cpu_count(),'loadAverage':os.getloadavg(),
 'pressure':{k:Path('/proc/pressure/'+k).read_text() for k in ['cpu','memory','io']},
 'sha256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(files))}}
target=Path(sys.argv[1]) if len(sys.argv)>1 else root/'spikes/pelagic/proof/performance/environment.json'
target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(value,indent=2)+'\n')
print(target)
