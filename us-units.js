/* U.S. presentation layer for the dedicated New York entry point.
   Forecast/model state remains metric internally; only rendered values are converted.
   This file is injected only into the ny.html shell. */
(()=>{
  if(new URLSearchParams(location.search).get('units')!=='us')return;
  document.documentElement.dataset.wxUnits='us';
  const cToF=c=>c*9/5+32;
  const deltaCToF=c=>c*9/5;
  const kmhToMph=v=>v*0.621371;
  const mmToIn=v=>v/25.4;
  const n=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
  let painting=false,queued=false;
  const set=(el,text)=>{if(el&&el.textContent!==text)el.textContent=text};
  const replaceTemps=text=>String(text||'').replace(/(-?\d+(?:\.\d+)?)\s*°(?:C)?/gi,(_,v)=>`${cToF(Number(v)).toFixed(1)}°F`);
  const replaceKmh=text=>String(text||'').replace(/(-?\d+(?:\.\d+)?)\s*km\/?h/gi,(_,v)=>`${Math.round(kmhToMph(Number(v)))} mph`);
  const replaceMm=text=>String(text||'').replace(/(-?\d+(?:\.\d+)?)\s*mm(?:\/h)?/gi,(m,v)=>m.toLowerCase().includes('/h')?`${mmToIn(Number(v)).toFixed(2)} in/hr`:`${mmToIn(Number(v)).toFixed(2)} in`);
  function tempNode(el,decimals=1){if(!el)return;const text=el.textContent||'';if(!text.includes('°F')){const m=text.match(/-?\d+(?:\.\d+)?/);if(!m)return;el.dataset.wxMetricTemp=m[0]}const v=n(el.dataset.wxMetricTemp);if(v!=null)set(el,`${cToF(v).toFixed(decimals)}°F`)}
  function deltaNode(el,pattern='number'){if(!el)return;const text=el.textContent||'';if(text.includes('°F'))return;const m=text.match(/-?\d+(?:\.\d+)?/);if(!m)return;const v=deltaCToF(Number(m[0])).toFixed(1);if(pattern==='nudge')set(el,`${Number(m[0])>=0?'+':''}${v}°F`);else set(el,text.replace(m[0],v).replace('°','°F'))}
  function actualNode(el){if(!el)return;const text=el.textContent||'',m=text.match(/-?\d+(?:\.\d+)?/);if(!m)return;if(!text.includes('°F'))el.dataset.wxMetricTemp=m[0];const v=n(el.dataset.wxMetricTemp);if(v!=null)el.innerHTML=`Actual <b>${cToF(v).toFixed(1)}°F</b>`}
  function convertCards(){
    document.querySelectorAll('#zones .zt,#microZones .zt,#hours .hour b,.v11DayRF').forEach(el=>tempNode(el,1));
    document.querySelectorAll('#zones .sub,#microZones .sub,#hours .sub,.v11DayActual,.routineMeta span').forEach(el=>{let t=el.textContent||'';if(!t.includes('°F'))t=replaceTemps(t);t=replaceKmh(t);t=replaceMm(t);set(el,t)});
    document.querySelectorAll('.v11RainAmt').forEach(el=>set(el,replaceMm(el.textContent||'')));
    document.querySelectorAll('.v11DayRain').forEach(el=>{const label=el.getAttribute('aria-label')||'';if(/millimetres|mm/i.test(label)){const m=label.match(/expected amount\s+(-?\d+(?:\.\d+)?)/i);if(m)el.setAttribute('aria-label',label.replace(/expected amount\s+-?\d+(?:\.\d+)?\s*millimetres/i,`expected amount ${mmToIn(Number(m[1])).toFixed(2)} inches`))}});
  }
  function paint(){
    if(painting)return;painting=true;
    try{
      tempNode(document.getElementById('feels'),1);actualNode(document.getElementById('actual'));tempNode(document.getElementById('fhigh'),1);tempNode(document.getElementById('officialTemp'),1);
      for(const id of ['morningFeel','eveningFeel'])tempNode(document.getElementById(id),1);
      for(const id of ['morningActual','eveningActual']){const el=document.getElementById(id);if(el){let t=el.textContent||'';if(!t.includes('°F'))t=replaceTemps(t);set(el,t)}}
      const range=document.getElementById('range');if(range){let t=range.textContent||'';if(!t.includes('°F'))t=replaceTemps(t);set(range,t)}
      const wind=document.getElementById('wind');if(wind){const txt=wind.textContent||'';if(!/mph/i.test(txt)){const vals=[...txt.matchAll(/-?\d+(?:\.\d+)?/g)].map(x=>Number(x[0]));if(vals.length)set(wind,vals.map(v=>Math.round(kmhToMph(v))).join(' / ')+' mph')}}
      const total=document.getElementById('rainTotal');if(total)set(total,replaceMm(total.textContent||''));
      for(const id of ['rainTiming','radarArrival']){const el=document.getElementById(id);if(el)set(el,replaceMm(el.textContent||''))}
      const summary=document.getElementById('daySummary');if(summary){let t=summary.textContent||'';if(!t.includes('°F'))t=replaceTemps(t);t=replaceKmh(t);set(summary,t);summary.dataset.source='us-units'}
      const advice=document.getElementById('advice');if(advice){let t=advice.textContent||'';if(!t.includes('°F'))t=replaceTemps(t);set(advice,t)}
      const uncertainty=document.getElementById('uncertainty');if(uncertainty){const t=uncertainty.textContent||'',m=t.match(/-?\d+(?:\.\d+)?/);if(m&&!t.includes('°F'))set(uncertainty,`±${deltaCToF(Number(m[0])).toFixed(1)}°F`)}
      deltaNode(document.getElementById('v3Nudge'),'nudge');deltaNode(document.getElementById('v3Walk'));
      document.querySelectorAll('#scoreRows .scoreRow span').forEach(el=>{let t=el.textContent||'';if(!t.includes('°F'))t=t.replace(/(-?\d+(?:\.\d+)?)°\s*MAE/gi,(_,v)=>`${deltaCToF(Number(v)).toFixed(1)}°F MAE`).replace(/bias\s*([+-]?\d+(?:\.\d+)?)°/gi,(_,v)=>`bias ${Number(v)>=0?'+':''}${deltaCToF(Number(v)).toFixed(1)}°F`);set(el,t)});
      const note=document.getElementById('skillNote');if(note){let t=note.textContent||'';if(!t.includes('°F'))t=t.replace(/(-?\d+(?:\.\d+)?)°\s*MAE/gi,(_,v)=>`${deltaCToF(Number(v)).toFixed(1)}°F MAE`).replace(/spread\s*(-?\d+(?:\.\d+)?)°/gi,(_,v)=>`spread ${deltaCToF(Number(v)).toFixed(1)}°F`);set(note,t)}
      convertCards();
      document.querySelectorAll('.metric small').forEach(el=>{if((el.textContent||'').trim()==='WIND / GUST')el.title='mph'});
      const footer=document.getElementById('updated');if(footer)footer.dataset.units='us';
    }finally{painting=false}
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;paint()})}
  window.WXApplyUSUnits=paint;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(paint,80),{once:true});else setTimeout(paint,80);
  window.addEventListener('wx-fast-current-ready',schedule);window.addEventListener('wx-v3-ready',schedule);
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  setInterval(paint,4000);
})();
