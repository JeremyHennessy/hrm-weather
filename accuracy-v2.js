/* Weather Consensus Accuracy Engine 2.0 client integration */
(function(){
  const FAMILY={
    gem_hrdps_continental:'canada',gem_regional:'canada',gem_seamless:'canada',
    ecmwf_ifs025:'ecmwf',ecmwf_aifs025_single:'ecmwf',
    gfs_seamless:'noaa',icon_seamless:'dwd',ukmo_seamless:'ukmo',
    meteofrance_seamless:'meteofrance',jma_seamless:'jma',kma_seamless:'kma',
    bom_access_global:'bom',cma_grapes_global:'cma'
  };
  let V2=null,V2_SKILL={};

  const finite=x=>Number.isFinite(Number(x));
  const num=x=>finite(x)?Number(x):null;
  const clamp2=(x,a,b)=>Math.max(a,Math.min(b,x));

  function v2Loc(){return (typeof loc!=='undefined'&&loc)||'hrm'}
  function v2Fresh(){
    const t=V2?.updated_at?Date.parse(V2.updated_at):0;
    return t && Date.now()-t < 3*60*60*1000;
  }
  function v2Regime(){return V2?.regimes?.[v2Loc()]?.name||'unknown'}
  function v2Skill(id,lead=6,varName='temperature_2m'){
    const l=v2Loc(),r=v2Regime();
    const keys=[
      `${l}:${id}:${varName}:${lead}:${r}`,
      `${l}:${id}:${varName}:${lead}`,
      `${l}:${id}:${varName}:all`,
      `${l}:${id}:${lead}`,
      `${l}:${id}:all`
    ];
    for(const k of keys){
      const s=V2_SKILL[k];
      if(s?.n>=4)return s;
    }
    return null;
  }
  function v2Bias(id,lead=6,varName='temperature_2m'){
    const s=v2Skill(id,lead,varName);
    return s&&finite(s.bias)?clamp2(Number(s.bias),-4,4):0;
  }
  function v2Stability(id,lead=6,varName='temperature_2m'){
    const s=V2?.stability?.[`${v2Loc()}:${id}:${varName}:${lead}`];
    const c=num(s?.run_change_mae);
    return c===null?1:clamp2(1.08/(1+c/3),.70,1.08);
  }
  function v2SkillWeight(id,lead=6,varName='temperature_2m'){
    const s=v2Skill(id,lead,varName),mae=num(s?.mae);
    const sf=!s||s.n<4||mae===null?1:clamp2(1.35/(.70+mae),.55,1.35);
    return sf*v2Stability(id,lead,varName);
  }
  function v2RegimeWeight(id,lead,windDir){
    const r=v2Regime();
    let f=1;
    if(id==='gem_hrdps_continental'&&lead<=12)f*=1.10;
    if(id==='ecmwf_ifs025'&&lead>=24)f*=1.06;
    if(r==='marine_onshore'&&id==='gem_hrdps_continental')f*=1.08;
    if(r==='frontal'&&['canada','ecmwf'].includes(FAMILY[id]))f*=1.03;
    return f;
  }
  function v2BaseWeight(m){
    return Array.isArray(m)&&finite(m[3])?Number(m[3]):1;
  }
  function v2ModelWeight(m,lead,windDir){
    return v2BaseWeight(m)*v2SkillWeight(m[0],lead)*v2RegimeWeight(m[0],lead,windDir);
  }
  function v2ServerTemp(lead){
    if(!V2||!v2Fresh()||lead<=0)return null;
    const hs=V2?.consensus?.[v2Loc()]?.hours||{};
    const points=Object.keys(hs).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!points.length)return null;
    if(hs[String(lead)]&&finite(hs[String(lead)].temperature_2m))return Number(hs[String(lead)].temperature_2m);
    let lo=points.filter(x=>x<=lead).pop(),hi=points.find(x=>x>=lead);
    if(lo===undefined)lo=hi;if(hi===undefined)hi=lo;
    if(lo===undefined||hi===undefined)return null;
    const a=num(hs[String(lo)]?.temperature_2m),b=num(hs[String(hi)]?.temperature_2m);
    if(a===null)return b;if(b===null)return a;if(lo===hi)return a;
    return a+(b-a)*(lead-lo)/(hi-lo);
  }

  // Replace v1 per-model averaging with family-collapsed averaging. Multiple GEM
  // products or IFS+AIFS improve their family's estimate but do not become multiple
  // independent votes. Learned bias is corrected before averaging.
  function installWeighting(){
    if(typeof weightedModel!=='function')return;
    window.weightedModel=function(mods,zname,getter,lead=0,windDir=null){
      const groups={};
      for(const x of mods.filter(x=>x.z?.[0]===zname)){
        let v=getter(x);if(!finite(v))continue;
        const id=x.m?.[0],family=FAMILY[id]||id||'unknown';
        v=Number(v)-v2Bias(id,lead);
        const w=v2ModelWeight(x.m,lead,windDir);
        (groups[family]||(groups[family]=[])).push({v,w});
      }
      const familyVals=[];
      for(const rows of Object.values(groups)){
        const den=rows.reduce((a,r)=>a+r.w,0);
        const val=den?rows.reduce((a,r)=>a+r.v*r.w,0)/den:rows.reduce((a,r)=>a+r.v,0)/rows.length;
        if(finite(val))familyVals.push(val);
      }
      const learned=familyVals.length?familyVals.reduce((a,b)=>a+b,0)/familyVals.length:null;
      // For forecast hours, the server-side V2 result is the three-engine blend
      // (nowcast + learned local + raw ensemble). It is interpolated between stored
      // lead anchors. Current conditions remain local/live and are observation-corrected
      // by the existing render path.
      const final=v2ServerTemp(lead);
      return finite(final)?Number(final):learned;
    };
    window.skillFactor=function(id,lead=6){return v2SkillWeight(id,lead)};
    window.regimeFactor=function(id,lead,windDir){return v2RegimeWeight(id,lead,windDir)};
    window.weightOf=function(m,lead,windDir){return v2ModelWeight(m,lead,windDir)};
  }

  function ensureUI(){
    const acc=[...document.querySelectorAll('.section')].find(s=>s.querySelector('h2')?.textContent==='Accuracy engine');
    if(acc&&!document.getElementById('v2EngineGrid')){
      const note=acc.querySelector('#skillNote');
      (note||acc).insertAdjacentHTML('afterend',`
        <div id="v2EngineGrid" class="v2EngineGrid">
          <div class="v2Stat"><small>WEATHER REGIME</small><b id="v2Regime">learning</b><span id="v2RegimeMeta">wind + pressure + moisture</span></div>
          <div class="v2Stat"><small>INDEPENDENT FAMILIES</small><b id="v2Families">--</b><span>provider duplication removed</span></div>
          <div class="v2Stat"><small>ENSEMBLE SYSTEMS</small><b id="v2Ensembles">--</b><span>IFS · AIFS · GEFS · GEPS</span></div>
          <div class="v2Stat"><small>FORECAST STABILITY</small><b id="v2Stability">--</b><span>run-to-run change</span></div>
        </div>
        <div id="v2EngineNote" class="sub" style="margin-top:9px">Loading Accuracy Engine 2.0…</div>`);
    }
    const prob=[...document.querySelectorAll('.section')].find(s=>s.querySelector('h2')?.textContent==='Probabilistic ensemble');
    if(prob&&!document.getElementById('v2Blend')){
      const card=prob.querySelector('.card');
      if(card)card.insertAdjacentHTML('beforeend',`
        <div id="v2Blend" class="v2Blend">
          <div><small>0–3H</small><b>Radar / nowcast first</b></div>
          <div><small>6–24H</small><b>Learned local first</b></div>
          <div><small>3–7D</small><b>Ensemble weight rises</b></div>
        </div>`);
      const span=prob.querySelector('.head span');if(span)span.textContent='IFS ENS + AIFS ENS + GEFS + GEPS';
    }
    if(!document.getElementById('v2-style')){
      const st=document.createElement('style');st.id='v2-style';st.textContent=`
        .v2EngineGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:11px}
        .v2Stat{border:1px solid var(--line);border-radius:15px;padding:10px;background:#0b243555}
        .v2Stat small,.v2Stat span{display:block;color:var(--muted);font-size:9px}
        .v2Stat b{display:block;font-size:15px;margin:4px 0}
        .v2Blend{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}
        .v2Blend>div{border-top:1px solid #ffffff18;padding-top:8px}
        .v2Blend small{display:block;color:var(--muted);font-size:9px}.v2Blend b{font-size:10px}
        @media(max-width:620px){.v2EngineGrid{grid-template-columns:repeat(2,1fr)}.v2Blend{grid-template-columns:1fr}}
      `;document.head.appendChild(st);
    }
  }

  function renderV2(){
    ensureUI();if(!V2)return;
    const l=v2Loc(),reg=V2.regimes?.[l]||{},health=V2.source_health?.[l]||{},c6=V2.consensus?.[l]?.hours?.['6']||{};
    const r=document.getElementById('v2Regime'),rm=document.getElementById('v2RegimeMeta'),
      f=document.getElementById('v2Families'),e=document.getElementById('v2Ensembles'),
      s=document.getElementById('v2Stability'),n=document.getElementById('v2EngineNote');
    if(r)r.textContent=(reg.name||'mixed').replaceAll('_',' ');
    if(rm)rm.textContent=`wind ${finite(reg.wind_direction)?Math.round(reg.wind_direction)+'°':'--'} · ${finite(reg.wind_speed)?Math.round(reg.wind_speed)+' km/h':'--'} · ΔP ${finite(reg.pressure_tendency_3h)?Number(reg.pressure_tendency_3h).toFixed(1)+' hPa':'--'}`;
    if(f)f.textContent=String(c6.effective_independent_sources??'--');
    if(e)e.textContent=`${health.ensemble_products??0}/4`;
    const st=Object.entries(V2.stability||{}).filter(([k,v])=>k.startsWith(l+':')&&k.endsWith(':temperature_2m:6')&&finite(v.run_change_mae)).map(([,v])=>Number(v.run_change_mae));
    const sta=st.length?st.reduce((a,b)=>a+b,0)/st.length:null;
    if(s)s.textContent=sta===null?'learning':`±${sta.toFixed(1)}°`;
    const nc=V2.nowcast?.[l]||{},rad=nc.radar_available?'radar live':'radar fallback',rdpa=nc.rdpa_available?'RDPA truth live':'RDPA pending';
    if(n)n.textContent=`V2: bias-corrected family weighting · ${rad} · ${rdpa} · MAE/bias/RMSE/Brier/CRPS scoring · ${health.deterministic_models??0}/${health.deterministic_expected??13} deterministic models.`;
    if(typeof chips!=='undefined'&&chips){
      const existing=chips.innerHTML;
      if(!existing.includes('independent families'))chips.innerHTML=existing+`<span class="chip">${c6.effective_independent_sources??'--'} independent families</span><span class="chip">${(reg.name||'mixed').replaceAll('_',' ')} regime</span>`;
    }
  }

  async function fetchV2(){
    try{
      const [er,sr]=await Promise.all([
        fetch('data/engine-v2.json?ts='+Date.now(),{cache:'no-store'}),
        fetch('data/skill.json?ts='+Date.now(),{cache:'no-store'})
      ]);
      if(er.ok)V2=await er.json();
      if(sr.ok){
        const ss=await sr.json();V2_SKILL=ss.skills||{};
        try{
          const local=typeof getSkills==='function'?getSkills():{};
          const merged={...V2_SKILL,...local};
          localStorage.setItem('wx-skills',JSON.stringify(merged));
        }catch{}
      }
      window.WXAccuracyV2=V2;
      installWeighting();renderV2();
      // Initial v5b load may have started before this addon arrived. Re-run once so
      // the visible hourly forecast uses the V2 family/ensemble blend immediately.
      if(V2&&typeof load==='function'&&!window.__wxV2Reloaded){
        window.__wxV2Reloaded=true;
        setTimeout(()=>load(),50);
      }
    }catch(e){
      const n=document.getElementById('v2EngineNote');if(n)n.textContent='Accuracy Engine 2.0 shared data is not published yet; local learner remains active.';
    }
  }

  ensureUI();
  fetchV2();
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&(!V2||!v2Fresh()))fetchV2()});
  setInterval(renderV2,60000);
})();
