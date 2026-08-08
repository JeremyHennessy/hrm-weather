#!/usr/bin/env python3
import json, math, os, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'; DATA.mkdir(exist_ok=True)
SKILL=DATA/'skill.json'; LEDGER=DATA/'ledger.json'
LOCATIONS={
 'hrm': {'lat':44.6488,'lon':-63.5752,'bbox':[-63.80,44.48,-63.42,44.84]},
 'moncton': {'lat':46.0878,'lon':-64.7782,'bbox':[-64.95,45.98,-64.62,46.20]},
 'shediac': {'lat':46.2198,'lon':-64.5411,'bbox':[-64.68,46.10,-64.40,46.34]},
}
MODELS=['gem_hrdps_continental','gem_regional','gem_seamless','ecmwf_ifs025','ecmwf_aifs025_single','gfs_seamless','icon_seamless','ukmo_seamless','meteofrance_seamless','jma_seamless','kma_seamless','bom_access_global','cma_grapes_global']
LEADS=[3,6,12,24]

def get_json(url,timeout=30):
 req=urllib.request.Request(url,headers={'User-Agent':'hrm-weather-consensus/1.0'})
 with urllib.request.urlopen(req,timeout=timeout) as r:return json.load(r)

def load(path,default):
 try:return json.loads(path.read_text())
 except:return default

def save(path,obj):path.write_text(json.dumps(obj,indent=2,sort_keys=True)+'\n')

def hav(lat1,lon1,lat2,lon2):
 p1,p2=math.radians(lat1),math.radians(lat2);dp=math.radians(lat2-lat1);dl=math.radians(lon2-lon1)
 a=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
 return 6371*2*math.atan2(math.sqrt(a),math.sqrt(1-a))

def eccc_temp(loc):
 now=datetime.now(timezone.utc); b=loc['bbox']
 params={'bbox':','.join(map(str,b)),'limit':'300','f':'json'}
 url='https://api.weather.gc.ca/collections/climate-hourly/items?'+urllib.parse.urlencode(params)
 try:j=get_json(url)
 except:return None
 rows=[]
 for f in j.get('features',[]):
  p=f.get('properties') or {}; t=p.get('TEMP')
  try:t=float(t)
  except:continue
  geom=f.get('geometry') or {}; c=geom.get('coordinates') or []
  dist=999
  if len(c)>=2:
   try:dist=hav(loc['lat'],loc['lon'],float(c[1]),float(c[0]))
   except:pass
  stamp=p.get('UTC_DATE') or p.get('LOCAL_DATE') or p.get('DATE') or ''
  rows.append((stamp,dist,t,p.get('STATION_NAME') or p.get('CLIMATE_IDENTIFIER') or 'ECCC'))
 if not rows:return None
 rows.sort(key=lambda x:(x[0],-x[1]),reverse=True); latest=rows[0][0]
 near=sorted([r for r in rows if r[0]==latest],key=lambda r:r[1])[:3]
 vals=[r[2] for r in near]
 return {'temp':sum(vals)/len(vals),'station':' / '.join(r[3] for r in near),'time':latest}

def forecast(loc,model):
 q={'latitude':loc['lat'],'longitude':loc['lon'],'timezone':'UTC','forecast_days':'2','temperature_unit':'celsius','hourly':'temperature_2m','models':model}
 try:j=get_json('https://api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(q))
 except:return None
 times=j.get('hourly',{}).get('time',[]); vals=j.get('hourly',{}).get('temperature_2m',[])
 return dict(zip(times,vals))

def add_skill(skills,key,error,bias):
 s=skills.get(key,{'n':0,'mae':0.0,'bias':0.0}); n=s['n']
 s['mae']=(s['mae']*n+abs(error))/(n+1); s['bias']=(s.get('bias',0)*n+bias)/(n+1); s['n']=n+1;s['source']='github-actions-eccc-live';s['updated']=datetime.now(timezone.utc).isoformat()
 skills[key]=s

def aggregate(skills,loc,model):
 rows=[]
 for lead in LEADS:
  s=skills.get(f'{loc}:{model}:{lead}')
  if s and s.get('n',0):rows.append(s)
 if not rows:return
 n=sum(x['n'] for x in rows)
 skills[f'{loc}:{model}:all']={'n':n,'mae':sum(x['mae']*x['n'] for x in rows)/n,'bias':sum(x.get('bias',0)*x['n'] for x in rows)/n,'source':'aggregate-leads','updated':datetime.now(timezone.utc).isoformat()}

def main():
 state=load(SKILL,{'updated_at':None,'skills':{}}); skills=state.get('skills',{})
 ledger=load(LEDGER,[]); now=datetime.now(timezone.utc); obs={k:eccc_temp(v) for k,v in LOCATIONS.items()}
 # Score due forecasts only when an ECCC observation is available near the target time.
 for e in ledger:
  if e.get('scored'):continue
  target=datetime.fromisoformat(e['target'].replace('Z','+00:00'))
  if target>now+timedelta(minutes=20) or now-target>timedelta(hours=3):continue
  o=obs.get(e['loc'])
  if not o:continue
  err=float(e['pred'])-float(o['temp']); add_skill(skills,f"{e['loc']}:{e['model']}:{e['lead']}",err,err);e['scored']=True;e['actual']=o['temp'];e['error']=err
 # Record new forecasts at fixed lead times.
 issued=now.replace(minute=0,second=0,microsecond=0)
 existing={(e['loc'],e['model'],e['lead'],e['issued']) for e in ledger}
 for lname,loc in LOCATIONS.items():
  for model in MODELS:
   fc=forecast(loc,model)
   if not fc:continue
   for lead in LEADS:
    target=issued+timedelta(hours=lead); key=target.strftime('%Y-%m-%dT%H:00')
    pred=fc.get(key)
    ident=(lname,model,lead,issued.isoformat())
    if pred is not None and ident not in existing:
     ledger.append({'loc':lname,'model':model,'lead':lead,'issued':issued.isoformat(),'target':target.isoformat(),'pred':pred,'scored':False})
 for lname in LOCATIONS:
  for model in MODELS:aggregate(skills,lname,model)
 ledger=[e for e in ledger if datetime.fromisoformat(e['issued'])>now-timedelta(days=35)]
 state={'updated_at':now.isoformat(),'observations':obs,'skills':skills}
 save(SKILL,state);save(LEDGER,ledger)
 print(f"skills={len(skills)} ledger={len(ledger)}")
if __name__=='__main__':main()
