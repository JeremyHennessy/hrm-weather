(()=>{
 const qs=(s,r=document)=>r.querySelector(s), all=(s,r=document)=>[...r.querySelectorAll(s)];
 const byTitle=t=>all('.section').find(s=>qs('h2',s)?.textContent.trim()===t);
 function arrange(){
   const warn=qs('#warn'),hero=qs('.hero'),brief=qs('.dayBrief'); if(!warn||!hero)return;
   const glance=qs('#glance')?.closest('.section'),hourly=byTitle('Next 12 hours'),days=byTitle('7-day outlook');
   if(glance)glance.classList.add('glanceSection'); if(hourly)hourly.classList.add('sectionHour'); if(days)days.classList.add('sectionDays');
   const primary=new Set([glance,hero,brief,hourly,days].filter(Boolean));
   all('.section').forEach(s=>{s.classList.toggle('sectionDeep',!primary.has(s))});
   let anchor=warn; for(const n of [glance,hero,brief,hourly,days].filter(Boolean)){anchor.insertAdjacentElement('afterend',n);anchor=n}
 }
 function normalizeLabels(){
   all('.hour b').forEach(el=>el.setAttribute('aria-label',`Real Feel ${el.textContent.trim()}`));
   all('.dayTemps strong').forEach(el=>el.setAttribute('aria-label',`Real Feel maximum ${el.textContent.trim()}`));
 }
 let queued=false; function refresh(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;arrange();normalizeLabels()})}
 window.addEventListener('DOMContentLoaded',()=>{new MutationObserver(refresh).observe(document.body,{subtree:true,childList:true,characterData:true});refresh()});
 window.addEventListener('load',refresh);
})();
