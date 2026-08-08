(()=>{
  const qs=(s,r=document)=>r.querySelector(s);
  const all=(s,r=document)=>[...r.querySelectorAll(s)];
  const byTitle=t=>all('.section').find(s=>qs('h2',s)?.textContent.trim()===t);

  function classifyAndOrder(){
    const app=qs('.app'),hero=qs('.hero'),warn=qs('#warn');
    if(!app||!hero||!warn)return;
    const glance=qs('#glance')?.closest('.section');
    const hourly=byTitle('Next 12 hours');
    const days=byTitle('7-day outlook');
    const brief=qs('.dayBrief');
    if(glance)glance.classList.add('glanceSection');
    if(hourly)hourly.classList.add('sectionHour');
    if(days)days.classList.add('sectionDays');
    const primary=new Set([glance,hourly,days,brief].filter(Boolean));
    all('.section').forEach(s=>{if(!primary.has(s))s.classList.add('sectionDeep')});

    // Priority: warnings -> Today at a glance -> Real Feel hero -> hourly -> 7-day -> personal routine.
    let anchor=warn;
    for(const node of [glance,hero,hourly,days,brief].filter(Boolean)){
      anchor.insertAdjacentElement('afterend',node);anchor=node;
    }
  }

  function actualValue(){
    const t=qs('#actual')?.textContent||'';
    const m=t.match(/-?\d+(?:\.\d+)?°/);return m?m[0]:'--°';
  }
  function sunsetValue(){
    const t=qs('#sun')?.textContent||'';
    const bits=t.split('/');return (bits[1]||bits[0]||'--').trim();
  }
  function syncGlance(){
    const g=qs('#glance');if(!g)return;
    const feel=qs('#feels')?.textContent?.trim()||'--°';
    const rain=qs('#rain')?.textContent?.trim()||'--%';
    const outlook=(qs('#advice')?.textContent||'Checking the next several hours…').replace(/\.$/,'');
    const currentIcon=qs('#heroIcon')?.textContent?.trim()||'⛅️';
    g.innerHTML=`
      <div class="glanceFeel"><small>REAL FEEL NOW</small><b>${feel}</b><span>${currentIcon} · Actual ${actualValue()}</span></div>
      <div><small>RAIN NOW</small><b>${rain}</b></div>
      <div><small>SUNSET</small><b>${sunsetValue()}</b></div>
      <div><small>OUTLOOK</small><b>${outlook}</b></div>`;
  }

  function emphasizeRealFeel(){
    all('.hour').forEach(h=>{
      const b=qs('b',h);if(b)b.setAttribute('aria-label',`Real Feel ${b.textContent.trim()}`);
    });
    all('.dayTemps strong').forEach(el=>el.setAttribute('aria-label',`Real Feel maximum ${el.textContent.trim()}`));
  }

  let queued=false;
  function refresh(){
    if(queued)return;queued=true;
    requestAnimationFrame(()=>{queued=false;classifyAndOrder();syncGlance();emphasizeRealFeel()});
  }
  window.addEventListener('load',refresh);
  const mo=new MutationObserver(refresh);
  window.addEventListener('DOMContentLoaded',()=>{mo.observe(document.body,{subtree:true,childList:true,characterData:true});refresh()});
})();
