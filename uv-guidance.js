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
  function ensure(){
    let el=document.querySelector('#uvGuidance');if(el)return el;
    const hero=document.querySelector('.hero');if(!hero)return null;
    el=document.createElement('div');el.id='uvGuidance';el.className='uvGuidance';el.hidden=true;el.setAttribute('role','status');el.setAttribute('aria-live','polite');
    hero.appendChild(el);
    if(!document.querySelector('#uvGuidanceStyle')){const s=document.createElement('style');s.id='uvGuidanceStyle';s.textContent=`
      .uvGuidance{position:absolute;left:16px;right:16px;bottom:14px;z-index:8;padding:10px 12px;border:1px solid rgba(255,232,143,.28);border-radius:14px;background:rgba(19,35,46,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 8px 22px rgba(0,0,0,.16);font-size:10px;line-height:1.3;color:#f7fbfd}
      .uvGuidance[hidden]{display:none!important}.uvGuidance b{font-size:11px}.uvGuidance span{display:block;margin-top:2px;color:#d8e7ee}.hero.uvGuidanceActive{padding-bottom:86px!important}
      @media(max-width:620px){.uvGuidance{left:12px;right:12px;bottom:11px;padding:9px 10px}.hero.uvGuidanceActive{padding-bottom:82px!important}}
    `;document.head.appendChild(s)}
    return el;
  }
  function paint(){
    if(typeof window.WXRefreshForecastInsights==='function'){window.WXRefreshForecastInsights();return true}
    const el=ensure();if(!el)return false;const uv=uvValue(),g=guidance(uv),hero=document.querySelector('.hero');
    if(!g){el.hidden=true;hero?.classList.remove('uvGuidanceActive');return true}
    const rounded=Math.round(uv*10)/10;el.innerHTML=`<b>UV ${rounded} · ${g.level}</b> · ${g.text}<span>${g.detail}</span>`;el.hidden=false;hero?.classList.add('uvGuidanceActive');return true;
  }
  window.WXRefreshUVGuidance=paint;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint,{once:true});else paint();
  window.addEventListener('wx-v3-ready',paint);document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(paint,80));document.querySelector('.locationPicker')?.addEventListener('change',()=>setTimeout(paint,80));
  const uv=document.querySelector('#uv');if(uv)new MutationObserver(paint).observe(uv,{childList:true,subtree:true,characterData:true});setInterval(paint,15000);
})();
