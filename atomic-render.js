/* Keep one complete forecast on screen while refreshes run, and apply V3 PoP calibration. */
(()=>{
  function patchProbabilities(base){
    if(typeof window.WXCalibratedPop!=='function'||!Array.isArray(base))return;
    for(const x of base){
      const d=x?.d;if(!d?.hourly?.time)continue;
      let start=0;
      try{start=typeof idx==='function'?idx(d):0}catch{}
      const pops=d.hourly.precipitation_probability;
      if(Array.isArray(pops))for(let i=start;i<pops.length;i++){
        const lead=i-start,raw=pops[i],cal=window.WXCalibratedPop(lead,raw);
        if(Number.isFinite(cal))pops[i]=cal;
      }
      const daily=d.daily?.precipitation_probability_max;
      if(Array.isArray(daily))for(let i=0;i<daily.length;i++){
        const lead=i===0?12:(i+1)*24,raw=daily[i],cal=window.WXCalibratedPop(lead,raw);
        if(Number.isFinite(cal))daily[i]=cal;
      }
    }
  }
  function install(){
    if(typeof window.render!=='function'){setTimeout(install,10);return}
    if(window.__wxAtomicRenderInstalled)return;window.__wxAtomicRenderInstalled=true;
    const original=window.render;
    window.render=function(base,mods,official,alerts,loading){
      // The old first-stage render painted a temporary base-provider forecast and
      // then replaced it with model consensus seconds later. Keep the existing
      // complete forecast (or skeleton on first launch) until consensus is ready.
      if(loading===true)return;
      patchProbabilities(base);
      return original(base,mods,official,alerts,false);
    };
  }
  install();
})();
