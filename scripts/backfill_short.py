#!/usr/bin/env python3
import json, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SKILL=ROOT/'data'/'skill.json'
LOCS={
 'hrm':(44.6488,-63.5752,[-63.80,44.48,-63.42,44.84]),
 'moncton':(46.0878,-64.7782,[-64.95,45.98,-64.62,46.20]),
 'shediac':(46.2198,-64.5411,[-64.68,46.10,-64.40,46.34]),
}
MODELS=['gem_hrdps_continental','gem_regional','ecmwf_ifs025','gfs_seamless','icon_seamless','ukmo_seamless']
LEADS=[3,6,12]
DAYS=10
MAX_WORKERS=12
HTTP_TIMEOUT=12

def get(url,timeout=HTTP_TIMEOUT):
 req=urllib.request.Request(url,headers={'User-Agent':'weather-consensus/1.0'})
 with urllib.request.urlopen(req,timeout=timeout) as r:return json.load(r)

def load():
 try:return json.loads(SKILL.read_text())
 except:return {'updated_at':None,'skills':{}}

def save(x):SKILL.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')

def add(skills,key,errors):
 if not errors:return
 n=len(errors)
 skills[key]={'n':n,'mae':sum(abs(x) for x in errors)/n,'bias':sum(errors)/n,'source':f'single-runs-eccc-{DAYS}d','updated':datetime.now(timezone.utc).isoformat()}

def aggregate(skills,loc,model):
 rows=[skills.get(f'{loc}:{model}:{lead}') for lead in [3,6,12,24]]
 rows=[x for x in rows if x and x.get('n',0)]
 if not rows:return
 n=sum(x['n'] for x in rows)
 skills[f'{loc}:{model}:all']={'n':n,'mae':sum(x['mae']*x['n'] for x in rows)/n,'bias':sum(x.get('bias',0)*x['n'] for x in rows)/n,'source':'aggregate-leads','updated':datetime.now(timezone.utc).isoformat()}

def observations(bbox,start,end):
 q={'bbox':','.join(map(str,bbox)),'datetime':f'{start:%Y-%m-%d}T00:00:00Z/{end:%Y-%m-%d}T23:59:59Z','limit':'10000','f':'json'}
 j=get('https://api.weather.gc.ca/collections/climate-hourly/items?'+urllib.parse.urlencode(q),20)
 groups={}
 for f in j.get('features',[]):
  p=f.get('properties') or {}; dt=p.get('UTC_DATE') or p.get('DATE'); t=p.get('TEMP')
  try:t=float(t)
  except:continue
  if not dt:continue
  key=str(dt).replace(' ','T')[:13]
  groups.setdefault(key,[]).append(t)
 return {k:sum(v)/len(v) for k,v in groups.items()}

def fetch_run(task):
 lname,lat,lon,model,run=task
 q={'latitude':lat,'longitude':lon,'timezone':'UTC','temperature_unit':'celsius','hourly':'temperature_2m','models':model,'run':run.strftime('%Y-%m-%dT00:00'),'forecast_hours':'13'}
 try:
  j=get('https://single-runs-api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(q))
  h=j.get('hourly',{})
  return task,dict(zip(h.get('time',[]),h.get('temperature_2m',[])))
 except Exception:
  return task,{}

def main():
 state=load(); skills=state.setdefault('skills',{})
 end=(datetime.now(timezone.utc)-timedelta(days=1)).replace(hour=0,minute=0,second=0,microsecond=0)
 start=end-timedelta(days=DAYS-1)
 obs_by_loc={}
 for lname,(_,_,bbox) in LOCS.items():
  try:obs_by_loc[lname]=observations(bbox,start,end)
  except Exception:obs_by_loc[lname]={}
 tasks=[]
 for lname,(lat,lon,_) in LOCS.items():
  for model in MODELS:
   for day in range(DAYS):
    tasks.append((lname,lat,lon,model,start+timedelta(days=day)))
 errors={(lname,model,lead):[] for lname in LOCS for model in MODELS for lead in LEADS}
 completed=0
 with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
  futs=[pool.submit(fetch_run,t) for t in tasks]
  for fut in as_completed(futs):
   task,fc=fut.result(); lname,_,_,model,run=task; completed+=1
   obs=obs_by_loc.get(lname,{})
   for lead in LEADS:
    target=run+timedelta(hours=lead)
    pred=fc.get(target.strftime('%Y-%m-%dT%H:00')); actual=obs.get(target.strftime('%Y-%m-%dT%H'))
    if isinstance(pred,(int,float)) and isinstance(actual,(int,float)):
     errors[(lname,model,lead)].append(float(pred)-float(actual))
 for (lname,model,lead),errs in errors.items():
  if len(errs)>=4:add(skills,f'{lname}:{model}:{lead}',errs)
 for lname in LOCS:
  for model in MODELS:aggregate(skills,lname,model)
 if not skills:
  raise SystemExit(f'No skill records produced; completed {completed}/{len(tasks)} archive requests')
 state['updated_at']=datetime.now(timezone.utc).isoformat(); save(state)
 print(f'short-lead skills={len(skills)} archive_requests={completed}/{len(tasks)}')

if __name__=='__main__':main()
