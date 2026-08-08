#!/usr/bin/env python3
import json, math, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; SKILL=ROOT/'data'/'skill.json'
LOCS={'hrm':(44.6488,-63.5752,[-63.80,44.48,-63.42,44.84]),'moncton':(46.0878,-64.7782,[-64.95,45.98,-64.62,46.20]),'shediac':(46.2198,-64.5411,[-64.68,46.10,-64.40,46.34])}
MODELS=['gem_hrdps_continental','gem_regional','ecmwf_ifs025','gfs_seamless','icon_seamless','ukmo_seamless']
LEADS=[3,6,12]; DAYS=14

def get(url,timeout=45):
 req=urllib.request.Request(url,headers={'User-Agent':'weather-consensus/1.0'})
 with urllib.request.urlopen(req,timeout=timeout) as r:return json.load(r)
def load():
 try:return json.loads(SKILL.read_text())
 except:return {'updated_at':None,'skills':{}}
def save(x):SKILL.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def add(skills,key,errors):
 if not errors:return
 n=len(errors);skills[key]={'n':n,'mae':sum(abs(x) for x in errors)/n,'bias':sum(errors)/n,'source':'single-runs-eccc-14d','updated':datetime.now(timezone.utc).isoformat()}
def aggregate(skills,loc,model):
 rows=[skills.get(f'{loc}:{model}:{l}') for l in [3,6,12,24] if skills.get(f'{loc}:{model}:{l}')]
 rows=[x for x in rows if x.get('n',0)]
 if not rows:return
 n=sum(x['n'] for x in rows);skills[f'{loc}:{model}:all']={'n':n,'mae':sum(x['mae']*x['n'] for x in rows)/n,'bias':sum(x.get('bias',0)*x['n'] for x in rows)/n,'source':'aggregate-leads','updated':datetime.now(timezone.utc).isoformat()}
def observations(lat,lon,bbox,start,end):
 q={'bbox':','.join(map(str,bbox)),'datetime':f'{start:%Y-%m-%d}T00:00:00Z/{end:%Y-%m-%d}T23:59:59Z','limit':'10000','f':'json'}
 try:j=get('https://api.weather.gc.ca/collections/climate-hourly/items?'+urllib.parse.urlencode(q))
 except:return {}
 groups={}
 for f in j.get('features',[]):
  p=f.get('properties') or {};t=p.get('TEMP');dt=p.get('UTC_DATE') or p.get('DATE')
  try:t=float(t)
  except:continue
  if not dt:continue
  key=str(dt).replace(' ','T')[:13];groups.setdefault(key,[]).append(t)
 return {k:sum(v)/len(v) for k,v in groups.items()}
def run_forecast(lat,lon,model,run):
 q={'latitude':lat,'longitude':lon,'timezone':'UTC','temperature_unit':'celsius','hourly':'temperature_2m','models':model,'run':run.strftime('%Y-%m-%dT00:00'),'forecast_hours':'13'}
 try:j=get('https://single-runs-api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(q))
 except:return {}
 h=j.get('hourly',{});return dict(zip(h.get('time',[]),h.get('temperature_2m',[])))
def main():
 state=load();skills=state.setdefault('skills',{});end=datetime.now(timezone.utc)-timedelta(days=1);start=end-timedelta(days=DAYS-1)
 for lname,(lat,lon,bbox) in LOCS.items():
  obs=observations(lat,lon,bbox,start,end)
  if not obs:continue
  for model in MODELS:
   errs={l:[] for l in LEADS}
   for day in range(DAYS):
    run=(start+timedelta(days=day)).replace(hour=0,minute=0,second=0,microsecond=0)
    fc=run_forecast(lat,lon,model,run)
    for lead in LEADS:
     target=run+timedelta(hours=lead);key=target.strftime('%Y-%m-%dT%H')
     pred=fc.get(target.strftime('%Y-%m-%dT%H:00'));actual=obs.get(key)
     if isinstance(pred,(int,float)) and isinstance(actual,(int,float)):errs[lead].append(float(pred)-float(actual))
   for lead in LEADS:
    if len(errs[lead])>=5:add(skills,f'{lname}:{model}:{lead}',errs[lead])
   aggregate(skills,lname,model)
 state['updated_at']=datetime.now(timezone.utc).isoformat();save(state);print('short-lead skills updated')
if __name__=='__main__':main()
