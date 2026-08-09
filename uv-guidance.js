/* Contextual UV protection overlay bootstrap. The richer forecast-insights
   module becomes the sole writer once loaded so sunscreen guidance never flips
   between two independent renderers. */
(()=>{
  const finite=v=>Number.isFinite(Number(v));
  const locKey=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  function engine(){if(window.WXAccuracyV3)return window.WXAccuracyV3;try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}}
  function uvValue(){
    const direct=parseFloat((document.querySelector('#uv')?.textContent||'').replace(/[^0-9.]/g,''));
    if(finite(direct))return direct;
    const e=engine(),h=e?.consensus?.[locKey()]?.hours||{};
    for(const lead of ['1','3','6']){const v=h[lead]?.real_feel_engine?.inputs?.uv_index;if(finite(v))return Number(v)}
    return null;
  }
  function guidance(uv){
    if(!finite(uv)||uv<3)return null;
    if(uv<6)return{level:'Moderate',text:'Sun protection recommended',detail:'Broad-spectrum SPF 30+ · hat/sunglasses · look for shade near midday'};
    if(uv<8)return{level:'High',text:'Sun protection required',detail:'SPF 30+ · shade/cover up · reduce sun from 11 a.m.–3 p.m.'};
    if(uv<11)return{level:'Very high',text:'Extra sun protection required',detail:'SPF 30+ · seek shade · avoid prolonged sun from 11 a.m.–3 p.m.'};
    return{level:'Extreme',text:'Maximum sun protection required',detail:'SPF 30+ · stay in shade where possible · avoid midday sun'};
  }
  function syncLayout(){
    const hero=document.querySelector('.hero'),uv=document.querySelector('#uvGuidance'),metrics=hero?.querySelector('.metrics');
    if(!hero||!uv||!metrics)return;
    if(hero.classList.contains('uvGuidanceActive')&&!uv.hidden&&uv.nextElementSibling!==metrics)hero.appendChild(metrics);
  }
  function ensure(){
    let el=document.querySelector('#uvGuidance');if(el)return el;
    const hero=document.querySelector('.hero');if(!hero)return null;
    el=document.createElement('div');el.id='uvGuidance';el.className='uvGuidance';el.hidden=true;el.setAttribute('role','status');el.setAttribute('aria-live','polite');
    hero.appendChild(el);
    if(!document.querySelector('#uvGuidanceStyle')){const s=document.createElement('style');s.id='uvGuidanceStyle';s.textContent=`
      .hero #uvGuidance.uvGuidance{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%!important;box-sizing:border-box!important;z-index:4!important;margin:12px 0 0!important;padding:10px 12px!important;border:1px solid rgba(255,232,143,.28)!important;border-radius:14px!important;background:rgba(19,35,46,.72)!important;backdrop-filter:blur(14px)!important;-webkit-backdrop-filter:blur(14px)!important;box-shadow:0 8px 22px rgba(0,0,0,.16)!important;font-size:10px!important;line-height:1.3!important;color:#f7fbfd!important;overflow-wrap:anywhere!important}
      .hero #uvGuidance.uvGuidance[hidden]{display:none!important}.hero #uvGuidance.uvGuidance b{display:block!important;margin-bottom:4px!important;font-size:11px!important}.hero #uvGuidance.uvGuidance span{display:block!important;margin-top:2px!important;color:#d8e7ee!important}.hero.uvGuidanceActive{padding-bottom:18px!important;height:auto!important}.hero.uvGuidanceActive .metrics{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%!important;margin:13px 0 0!important}
      @media(max-width:620px){.hero #uvGuidance.uvGuidance{margin:12px 0 0!important;padding:10px 11px!important;font-size:10px!important;line-height:1.35!important}.hero.uvGuidanceActive{padding-bottom:18px!important}.hero.uvGuidanceActive .metrics{margin-top:13px!important}}
      @media(max-width:340px){.hero #uvGuidance.uvGuidance{font-size:9.5px!important;line-height:1.32!important;padding:9px 10px!important}.hero #uvGuidance.uvGuidance b{font-size:10.5px!important}.hero #uvGuidance.uvGuidance span{font-size:9.5px!important;line-height:1.32!important}}
    `;document.head.appendChild(s)}
    new MutationObserver(syncLayout).observe(hero,{attributes:true,attributeFilter:['class'],childList:true,subtree:false});
    return el;
  }
  function paint(){
    if(typeof window.WXRefreshForecastInsights==='function'){window.WXRefreshForecastInsights();queueMicrotask(syncLayout);return true}
    const el=ensure();if(!el)return false;const uv=uvValue(),g=guidance(uv),hero=document.querySelector('.hero');
    if(!g){el.hidden=true;hero?.classList.remove('uvGuidanceActive');syncLayout();return true}
    const rounded=Math.round(uv*10)/10;el.innerHTML=`<b>UV ${rounded} · ${g.level}</b><span>${g.text}. ${g.detail}</span>`;el.hidden=false;hero?.classList.add('uvGuidanceActive');syncLayout();return true;
  }
  window.WXRefreshUVGuidance=paint;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint,{once:true});else paint();
  window.addEventListener('wx-v3-ready',paint);document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(paint,80));document.querySelector('.locationPicker')?.addEventListener('change',()=>setTimeout(paint,80));
  const uv=document.querySelector('#uv');if(uv)new MutationObserver(paint).observe(uv,{childList:true,subtree:true,characterData:true});setInterval(()=>{paint();syncLayout()},15000);
})();