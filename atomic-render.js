/* Keep startup responsive, preserve completed forecasts during refresh, and apply V3 PoP calibration. */
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
    if(window.__wxAtomicRenderInstalled)return;
    window.__wxAtomicRenderInstalled=true;
    const original=window.render;
    let hasComplete=false;
    let initialPartialShown=false;
    window.render=function(base,mods,official,alerts,loading){
      if(loading===true){
        // On first launch, show useful base weather immediately instead of leaving
        // the entire app in its skeleton state while dozens of model feeds load.
        // After a complete forecast exists, suppress partial refresh paints so the
        // visible forecast stays stable until the new consensus is ready.
        if(hasComplete||initialPartialShown)return;
        initialPartialShown=true;
        return original(base,mods,official,alerts,true);
      }
      patchProbabilities(base);
      const result=original(base,mods,official,alerts,false);
      hasComplete=true;
      window.__wxHasCompleteForecast=true;
      return result;
    };
  }
  install();
})();
