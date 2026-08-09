(()=>{const s=document.createElement('style');s.id='wx-safe-area';s.textContent=`.app{padding-top:max(16px,calc(env(safe-area-inset-top) + 12px))!important;padding-left:max(13px,env(safe-area-inset-left))!important;padding-right:max(13px,env(safe-area-inset-right))!important;padding-bottom:max(64px,calc(env(safe-area-inset-bottom) + 28px))!important}body{min-height:100dvh}header{min-height:44px}@media(max-width:620px){.app{padding-top:max(18px,calc(env(safe-area-inset-top) + 12px))!important}.tabs{scroll-padding-inline:8px}}`;document.head.appendChild(s)})();

L.lunenburg={n:'Lunenburg',k:'LUNENBURG NS',s:'Lunenburg, Nova Scotia',core:[['Lunenburg',44.377896,-64.309529]],micro:[],bbox:[-64.46,44.25,-64.15,44.50]};
L.wolfville={n:'Wolfville Area',k:'WOLFVILLE NS',s:'Wolfville · New Minas · Kentville',core:[['Wolfville',45.091713,-64.359242],['New Minas',45.067858,-64.460234],['Kentville',45.077707,-64.495306]],micro:[],bbox:[-64.62,44.98,-64.22,45.20]};
const wxBaseRegimeFactor=regimeFactor;
regimeFactor=function(id,lead,windDir){let f=wxBaseRegimeFactor(id,lead,windDir);if(loc==='lunenburg'&&Number.isFinite(windDir)&&windDir>=60&&windDir<=210&&id==='gem_hrdps_continental'&&lead<=12)f*=1.08;return f};

// Same-origin static startup path. This is deliberately independent of
// Open-Meteo/ECCC browser requests so rate limiting can never leave the app at --°.
(()=>{if(document.querySelector('script[data-wx-static-startup]'))return;const s=document.createElement('script');s.src='./startup-fallback.js?v=1';s.async=true;s.dataset.wxStaticStartup='1';document.head.appendChild(s)})();

// Progressive live enrichment: if the primary live feed answers quickly, it can
// replace the static startup state without waiting for every model/zone request.
(()=>{const startupToken=token,z=L[loc]?.core?.[0];if(!z)return;baseQ(z).then(b=>{if(startupToken!==token)return;render([b],[],null,[],true)}).catch(()=>{})})();

let wxSharedSkills={};
async function wxLoadSharedSkills(){try{const r=await fetch('./data/skill.json?ts='+Date.now(),{cache:'no-store'});if(!r.ok)return;const j=await r.json();wxSharedSkills=j.skills||j||{};const h=document.getElementById('health');if(h&&j.updated_at)h.dataset.sharedUpdated=j.updated_at}catch{}}
const wxLocalGetSkills=getSkills;
getSkills=function(){const local=wxLocalGetSkills(),merged={...wxSharedSkills};for(const[k,v]of Object.entries(local)){const r=merged[k];if(!r||(v?.n||0)>(r?.n||0)||(v?.updated&&r?.updated&&new Date(v.updated)>new Date(r.updated)))merged[k]=v}return merged};
function wxSkill(id,lead=6){const s=getSkills();return s[`${loc}:${id}:${lead}`]||s[`${loc}:${id}:all`]||null}
function wxBiasFix(id,lead=6){const s=wxSkill(id,lead);return s&&s.n>=3&&Number.isFinite(s.bias)?clamp(s.bias,-3,3):0}
skillFactor=function(id,lead=6){const s=wxSkill(id,lead);if(!s||s.n<3||!Number.isFinite(s.mae))return 1;return clamp(1.35/(.75+s.mae),.62,1.30)};
weightedModel=function(mods,zname,getter,lead=0,windDir=null){let n=0,d=0;for(const x of mods.filter(x=>x.z[0]===zname)){let v=getter(x);if(!Number.isFinite(v))continue;v-=wxBiasFix(x.m[0],lead);const w=weightOf(x.m,lead,windDir);n+=v*w;d+=w}return d?n/d:null};
function wxMergeAllLeadSkills(){const s=getSkills();for(const m of M){const rows=Object.entries(s).filter(([k,v])=>k.startsWith(`${loc}:${m[0]}:`)&&!k.endsWith(':all')&&/^\w+:[^:]+:\d+$/.test(k)&&v&&v.n>=3&&Number.isFinite(v.mae));if(!rows.length)continue;let n=0,ae=0,be=0;for(const[,v]of rows){n+=v.n;ae+=v.mae*v.n;be+=(v.bias||0)*v.n}s[`${loc}:${m[0]}:all`]={n,mae:ae/n,bias:be/n,source:'aggregate-leads',updated:new Date().toISOString()}}saveSkills(s)}
const wxBaseBacktest=runHistoricalBacktest;
runHistoricalBacktest=async function(days=90){await wxBaseBacktest(days);wxMergeAllLeadSkills();if(typeof wxScorecard==='function')wxScorecard()};
const wxPriorLoad=load;
load=function(){window.__wxPaintStaticStartup?.();wxLoadSharedSkills();return wxPriorLoad()};
refresh.onclick=load;

let wxTermObserver=null,wxTermQueued=false;
const wxReplaceText=(el,fn)=>{if(!el)return;const old=el.textContent,next=fn(old);if(next!==old)el.textContent=next};
function wxApplyTerminology(){
  wxTermObserver?.disconnect();
  try{
    wxReplaceText(document.getElementById('range'),t=>t.replace(/Likely feels-like range/i,'Real Feel range').replace(/Ensemble feels-like range/i,'Real Feel range'));
    document.querySelectorAll('.metric small').forEach(el=>{if(el.textContent.trim()==='FEELS HIGH')el.textContent='REAL FEEL HIGH'});
    document.querySelectorAll('.head span').forEach(el=>wxReplaceText(el,t=>t.replace(/feels-like first/ig,'Real Feel first').replace(/max feels/ig,'Real Feel max')));
    document.querySelectorAll('.zones .sub,.micro .sub,.hours .sub').forEach(el=>wxReplaceText(el,t=>t.replace(/^actual\s+/i,'Actual ').replace(/^air\s+/i,'Actual ')));
    document.querySelectorAll('.dayMain').forEach(el=>{const old=el.innerHTML,next=old.replace(/feels max/ig,'Real Feel max');if(next!==old)el.innerHTML=next});
    document.querySelectorAll('.section .card .sub').forEach(el=>wxReplaceText(el,t=>t.replace(/feels-like range/ig,'Real Feel range')));
    if(typeof advice!=='undefined'&&advice)wxReplaceText(advice,t=>t.replace(/feels near/ig,'Real Feel near'));
  }finally{
    if(wxTermObserver)wxTermObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  }
}
wxTermObserver=new MutationObserver(()=>{if(wxTermQueued)return;wxTermQueued=true;requestAnimationFrame(()=>{wxTermQueued=false;wxApplyTerminology()})});
window.addEventListener('load',()=>{
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  wxTermObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  nav();
  window.__wxPaintStaticStartup?.();
  wxApplyTerminology();
  wxLoadSharedSkills().then(()=>{const h=document.getElementById('health');if(h&&h.dataset.sharedUpdated){const d=new Date(h.dataset.sharedUpdated);if(!Number.isNaN(d)){const age=Math.max(0,Math.round((Date.now()-d)/3600000));h.insertAdjacentHTML('beforeend',`<span> · shared calibration ${age}h old</span>`)}}});
});
