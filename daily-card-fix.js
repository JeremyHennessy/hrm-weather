/* 7-day forecast readability: Real Feel first, actual secondary, rain % explicit. */
(()=>{
  function parseRain(text){
    const pct=text.match(/(?:Rain\s*)?(\d+(?:\.\d+)?)%/i)?.[1]||'--';
    const mm=text.match(/(?:Amount\s*)?(\d+(?:\.\d+)?)\s*mm/i)?.[1];
    return{pct,mm};
  }
  function fix(){
    document.querySelectorAll('#days .v11Day').forEach(day=>{
      const rain=day.querySelector('.v11DayRain');if(!rain)return;
      if(rain.dataset.readable==='1'&&rain.querySelector('.v11RainPct'))return;
      const p=parseRain(rain.textContent||'');
      rain.dataset.readable='1';
      rain.innerHTML=`<strong class="v11RainPct">Rain ${p.pct}%</strong>${p.mm?`<span class="v11RainAmt">${p.mm} mm expected</span>`:''}`;
      rain.setAttribute('aria-label',`Rain chance ${p.pct} percent${p.mm?`, expected amount ${p.mm} millimetres`:''}`);
    });
  }
  const style=document.createElement('style');style.id='daily-card-readable';style.textContent=`
    .sectionDays .v11Day{min-height:164px!important;overflow:hidden!important}
    .v11DayActual{display:block!important;width:100%!important;text-align:center!important;white-space:nowrap!important;font-size:8.5px!important;line-height:1.2!important;margin-top:8px!important}
    .v11DayRain{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:flex-start!important;gap:2px!important;width:100%!important;min-width:0!important;margin-top:9px!important;white-space:normal!important;text-align:center!important;line-height:1.15!important;overflow:hidden!important}
    .v11RainPct{display:block!important;max-width:100%!important;font-size:9px!important;font-weight:650!important;color:#eaf7fc!important;white-space:nowrap!important}
    .v11RainAmt{display:block!important;max-width:100%!important;font-size:7.5px!important;color:#9fb8c6!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    @media(max-width:390px){.sectionDays .v11Day{min-width:92px!important}.v11RainPct{font-size:8.5px!important}.v11RainAmt{font-size:7px!important}}
  `;document.head.appendChild(style);
  function start(){
    fix();const root=document.getElementById('days');if(!root)return;
    let queued=false;
    new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;fix()})}).observe(root,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
