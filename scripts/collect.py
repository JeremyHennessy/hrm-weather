#!/usr/bin/env python3
import json, math, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'; DATA.mkdir(exist_ok=True)
SKILL=DATA/'skill.json'; LEDGER=DATA/'ledger.json'
LOCATIONS={
 'hrm': {'lat':44.6822,'lon':-63.6012,'points':[(44.6488,-63.5752),(44.7318,-63.6619),(44.6661,-63.5676)],'bbox':[-63.80,44.48,-63.42,44.84]},
 'moncton': {'lat':46.0878,'lon':-64.7782,'points':[(46.0878,-64.7782)],'bbox':[-64.95,45.98,-64.62,46.20]},
 'shediac': {'lat':46.2198,'lon':-64.5411,'points':[(46.2198,-64.5411)],'bbox':[-64.68,46.10,-64.40,46.34]},
 'lunenburg': {'lat':44.377896,'lon':-64.309529,'points':[(44.377896,-64.309529)],'bbox':[-64.46,44.25,-64.15,44.50]},
 'wolfville': {'lat':45.0791,'lon':-64.4383,'points':[(45.091713,-64.359242),(45.067858,-64.460234),(45.077707,-64.495306)],'bbox':[-64.62,44.98,-64.22,45.20]},
}
MODELS=['gem_hrdps_continental','gem_regional','gem_seamless','ecmwf_ifs025','ecmwf_aifs025_single','gfs_seamless','icon_seamless','ukmo_seamless','meteofrance_seamless','jma_seamless','kma_seamless','bom_access_global','cma_grapes_global']
LEADS=[3,6,12,24]

def get_json(url,timeout=20):
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

def parse_stamp(value):
 if not value:return None
 s=str(value).replace(' ','T').replace('Z','+00:00')
 try:
  dt=datetime.fromisoformat(s)
  return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
 except:return None

def eccc_temp(loc):
 now=datetime.now(timezone.utc); b=loc['bbox']; start=now-timedelta(hours=6); end=now+timedelta(hours=1)
 params={'bbox':','.join(map(str,b)),'datetime':f'{start.isoformat().replace("+00:00","Z")}/{end.isoformat().replace("+00:00","Z")}','limit':'500','f':'json'}
 try:j=get_json('https://api.weather.gc.ca/collections/climate-hourly/items?'+urllib.parse.urlencode(params))
 except:return None
 rows=[]
 for f in j.get('features',[]):
  p=f.get('properties') or {}; t=p.get('TEMP'); stamp=p.get('UTC_DATE') or p.get('DATE') or p.get('LOCAL_DATE'); dt=parse_stamp(stamp)
  try:t=float(t)
  except:continue
  if not dt or abs((now-dt).total_seconds())>6*3600:continue
  c=(f.get('geometry') or {}).get('coordinates') or []; dist=999
  if len(c)>=2:
   try:dist=hav(loc['lat'],loc['lon'],float(c[1]),float(c[0]))
   except:pass
  rows.append((dt,dist,t,p.get('STATION_NAME') or p.get('CLIMATE_IDENTIFIER') or 'ECCC'))
 if not rows:return None
 latest=max(r[0] for r in rows)
 near=sorted([r for r in rows if abs((latest-r[0]).total_seconds())<=3600],key=lambda r:r[1])[:3]
 if not near:return None
 vals=[r[2] for r in near]
 return {'temp':sum(vals)/len(vals),'station':' / '.join(r[3] for r in near),'time':latest.isoformat()}

def forecast_point(lat,lon,model):
 q={'latitude':lat,'longitude':lon,'timezone':'UTC','forecast_days':'2','temperature_unit':'celsius','hourly':'temperature_2m','models':model}
 try:j=get_json('https://api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(q))
 except:return None
 h=j.get('hourly',{}); return dict(zip(h.get('time',[]),h.get('temperature_2m',[])))

def forecast(loc,model):
 rows=[forecast_point(lat,lon,model) for lat,lon in loc.get('points',[(loc['lat'],loc['lon'])])]
 rows=[r for r in rows if r]
 if not rows:return None
 keys=set().union(*(r.keys() for r in rows)); out={}
 for k in keys:
  vals=[r.get(k) for r in rows if isinstance(r.get(k),(int,float))]
  if vals:out[k]=sum(vals)/len(vals)
 return out

def add_skill(skills,key,error):
 s=skills.get(key,{'n':0,'mae':0.0,'bias':0.0}); n=s['n']
 s['mae']=(s['mae']*n+abs(error))/(n+1); s['bias']=(s.get('bias',0)*n+error)/(n+1); s['n']=n+1
 s['source']='github-actions-eccc-live'; s['updated']=datetime.now(timezone.utc).isoformat(); skills[key]=s

def aggregate(skills,loc,model):
 rows=[skills.get(f'{loc}:{model}:{lead}') for lead in LEADS]
 rows=[x for x in rows if x and x.get('n',0)]
 if not rows:return
 n=sum(x['n'] for x in rows)
 skills[f'{loc}:{model}:all']={'n':n,'mae':sum(x['mae']*x['n'] for x in rows)/n,'bias':sum(x.get('bias',0)*x['n'] for x in rows)/n,'source':'aggregate-leads','updated':datetime.now(timezone.utc).isoformat()}

def main():
 state=load(SKILL,{'updated_at':None,'skills':{}}); skills=state.get('skills',{}); ledger=load(LEDGER,[]); now=datetime.now(timezone.utc)
 obs={k:eccc_temp(v) for k,v in LOCATIONS.items()}
 for e in ledger:
  if e.get('scored'):continue
  target=datetime.fromisoformat(e['target'].replace('Z','+00:00'))
  if target>now+timedelta(minutes=20) or now-target>timedelta(hours=3):continue
  o=obs.get(e['loc'])
  if not o:continue
  odt=parse_stamp(o.get('time'))
  if not odt or abs((odt-target).total_seconds())>5400:continue
  err=float(e['pred'])-float(o['temp']); add_skill(skills,f"{e['loc']}:{e['model']}:{e['lead']}",err)
  e['scored']=True;e['actual']=o['temp'];e['error']=err;e['observation_time']=o['time']
 issued=now.replace(minute=0,second=0,microsecond=0); existing={(e['loc'],e['model'],e['lead'],e['issued']) for e in ledger}
 for lname,loc in LOCATIONS.items():
  for model in MODELS:
   fc=forecast(loc,model)
   if not fc:continue
   for lead in LEADS:
    target=issued+timedelta(hours=lead); pred=fc.get(target.strftime('%Y-%m-%dT%H:00')); ident=(lname,model,lead,issued.isoformat())
    if pred is not None and ident not in existing:ledger.append({'loc':lname,'model':model,'lead':lead,'issued':issued.isoformat(),'target':target.isoformat(),'pred':pred,'scored':False})
 for lname in LOCATIONS:
  for model in MODELS:aggregate(skills,lname,model)
 ledger=[e for e in ledger if datetime.fromisoformat(e['issued'])>now-timedelta(days=35)]
 state={'updated_at':now.isoformat(),'observations':obs,'skills':skills}; save(SKILL,state);save(LEDGER,ledger)
 print(f'skills={len(skills)} ledger={len(ledger)} fresh_obs={sum(1 for x in obs.values() if x)} locations={len(LOCATIONS)}')

if __name__=='__main__':main()
