(()=>{
 const qs=(s,r=document)=>r.querySelector(s), all=(s,r=document)=>[...r.querySelectorAll(s)];
 const byTitle=t=>all('.section').find(s=>qs('h2',s)?.textContent.trim()===t);
 const txt=(el,v)=>{if(el&&el.textContent!==v)el.textContent=v};
 function arrange(){
   const warn=qs('#warn'),hero=qs('.hero'),brief=qs('.dayBrief'); if(!warn||!hero)return;
   const glance=qs('#glance')?.closest('.section'),hourly=byTitle('Next 12 hours'),days=byTitle('7-day outlook');
   if(glance)glance.classList.add('glanceSection'); if(hourly)hourly.classList.add('sectionHour'); if(days)days.classList.add('sectionDays');
   const primary=new Set([glance,hero,brief,hourly,days].filter(Boolean));
   all('.section').forEach(s=>s.classList.toggle('sectionDeep',!primary.has(s)));
   let anchor=warn;
   for(const n of [glance,hero,brief,hourly,days].filter(Boolean)){
     if(anchor.nextElementSibling!==n)anchor.insertAdjacentElement('afterend',n);
     anchor=n;
   }
   const summary=qs('#daySummary');
   if(summary&&summary.parentElement!==hero){summary.classList.add('heroSummary');hero.querySelector('.callout')?.insertAdjacentElement('afterend',summary)}
   if(!hero.querySelector('.confidenceOrb')){
     const orb=document.createElement('div');orb.className='confidenceOrb';orb.innerHTML='<strong>--%</strong><span>Forecast Confidence</span><small>model agreement</small>';hero.appendChild(orb);
   }
   if(!qs('#photoCredit')){
     const f=all('.footer').at(-1);if(f){const c=document.createElement('div');c.id='photoCredit';c.className='photoCredit';c.innerHTML='Hero photo: Jcart1534 / Wikimedia Commons · CC BY-SA 3.0';f.insertAdjacentElement('afterend',c)}
   }
 }
 function activeLocation(){
   const a=qs('.tab.active');return a?.textContent.replace(/^[^A-Za-z]+/,'').trim()||'Weather Consensus';
 }
 function syncHeader(){
   const name=activeLocation();txt(qs('.brand h1'),name);txt(qs('.brandsub'),'Weather Consensus · Real Feel first');
 }
 function syncConfidence(){
   const orb=qs('.confidenceOrb');if(!orb)return;
   const u=parseFloat((qs('#uncertainty')?.textContent||'').replace(/[^0-9.]/g,''));
   const count=all('#models .model').length||parseInt((qs('#modelCount')?.textContent||'').match(/\d+/)?.[0]||'0',10);
   let score=86;if(Number.isFinite(u)){score=u<=.6?95:u<=1?92:u<=1.5?88:u<=2.2?82:74}
   txt(qs('strong',orb),`${score}%`);txt(qs('small',orb),count?`agreement across ${count} models`:'model agreement');
 }
 function normalizeLabels(){
   all('.hour b').forEach(el=>el.setAttribute('aria-label',`Real Feel ${el.textContent.trim()}`));
   all('.dayTemps strong').forEach(el=>el.setAttribute('aria-label',`Real Feel maximum ${el.textContent.trim()}`));
 }
 function refresh(){arrange();syncHeader();syncConfidence();normalizeLabels()}
 window.addEventListener('DOMContentLoaded',()=>{
   refresh();[250,900,2200,5000].forEach(ms=>setTimeout(refresh,ms));
   qs('#tabs')?.addEventListener('click',()=>setTimeout(refresh,50));
   qs('#locPrev')?.addEventListener('click',()=>setTimeout(refresh,50));
   qs('#locNext')?.addEventListener('click',()=>setTimeout(refresh,50));
 });
 window.addEventListener('load',refresh);
})();
