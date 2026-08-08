let wxSharedSkills={};
async function wxLoadSharedSkills(){try{const r=await fetch('./data/skill.json?ts='+Date.now(),{cache:'no-store'});if(!r.ok)return;const j=await r.json();wxSharedSkills=j.skills||j||{};const h=document.getElementById('health');if(h&&j.updated_at)h.dataset.sharedUpdated=j.updated_at}catch{}}
const wxLocalGetSkills=getSkills;
getSkills=function(){const local=wxLocalGetSkills();return Object.assign({},wxSharedSkills,local)};
function wxSkill(id,lead=6){const s=getSkills();return s[`${loc}:${id}:${lead}`]||s[`${loc}:${id}:all`]||null}
function wxBiasFix(id,lead=6){const s=wxSkill(id,lead);return s&&s.n>=3&&Number.isFinite(s.bias)?clamp(s.bias,-3,3):0}
skillFactor=function(id,lead=6){const s=wxSkill(id,lead);if(!s||s.n<3||!Number.isFinite(s.mae))return 1;return clamp(1.35/(.75+s.mae),.62,1.30)};
weightedModel=function(mods,zname,getter,lead=0,windDir=null){let n=0,d=0;for(const x of mods.filter(x=>x.z[0]===zname)){let v=getter(x);if(!Number.isFinite(v))continue;v-=wxBiasFix(x.m[0],lead);const w=weightOf(x.m,lead,windDir);n+=v*w;d+=w}return d?n/d:null};
function wxMergeAllLeadSkills(){const s=getSkills();for(const m of M){const rows=Object.entries(s).filter(([k,v])=>k.startsWith(`${loc}:${m[0]}:`)&&!k.endsWith(':all')&&/^\w+:[^:]+:\d+$/.test(k)&&v&&v.n>=3&&Number.isFinite(v.mae));if(!rows.length)continue;let n=0,ae=0,be=0;for(const[,v]of rows){n+=v.n;ae+=v.mae*v.n;be+=(v.bias||0)*v.n}s[`${loc}:${m[0]}:all`]={n,mae:ae/n,bias:be/n,source:'aggregate-leads',updated:Date.now()}}saveSkills(s)}
const wxBaseBacktest=runHistoricalBacktest;
runHistoricalBacktest=async function(days=90){await wxBaseBacktest(days);wxMergeAllLeadSkills();wxScorecard?.()};
const wxPriorLoad=load;
load=async function(){await wxLoadSharedSkills();return wxPriorLoad()};
refresh.onclick=load;
window.addEventListener('load',()=>{wxLoadSharedSkills().then(()=>{const h=document.getElementById('health');if(h&&h.dataset.sharedUpdated){const d=new Date(h.dataset.sharedUpdated);if(!Number.isNaN(d)){const age=Math.max(0,Math.round((Date.now()-d)/3600000));h.insertAdjacentHTML('beforeend',`<span> · shared calibration ${age}h old</span>`)}}})});
