(()=>{
 const qs=(s,r=document)=>r.querySelector(s), all=(s,r=document)=>[...r.querySelectorAll(s)];
 const byTitle=t=>all('.section').find(s=>qs('h2',s)?.textContent.trim()===t);
 const txt=(el,v)=>{if(el&&el.textContent!==v)el.textContent=v};
 function addBottomNav(){
   if(!qs('#v11BottomNavStyle')){const st=document.createElement('style');st.id='v11BottomNavStyle';st.textContent='.appNav{position:fixed;z-index:60;left:50%;transform:translateX(-50%);bottom:max(8px,env(safe-area-inset-bottom));width:min(690px,calc(100% - 18px));height:66px;padding:7px 8px;display:grid;grid-template-columns:repeat(5,1fr);gap:2px;border:1px solid rgba(222,242,252,.16);border-radius:22px;background:rgba(3,28,48,.86);backdrop-filter:blur(24px) saturate(140%);-webkit-backdrop-filter:blur(24px) saturate(140%);box-shadow:0 16px 45px rgba(0,8,18,.36)}.appNav button{border:0;background:transparent;color:#9fb5c3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:15px;font:inherit}.appNav button span{font-size:21px;line-height:1}.appNav button b{font-size:8px;font-weight:500}.appNav button.active{color:#b6a5ff;background:rgba(116,82,229,.16)}.appNav button.active span{filter:drop-shadow(0 0 8px rgba(145,111,255,.5))}@media(min-width:800px){.appNav{bottom:14px}}';document.head.appendChild(st)}
   if(qs('#appNav'))return;
   const nav=document.createElement('nav');nav.id='appNav';nav.className='appNav';nav.setAttribute('aria-label','App navigation');
   nav.innerHTML='<button data-go="forecast" class="active"><span>⌂</span><b>Forecast</b></button><button data-go="models"><span>⌁</span><b>Models</b></button><button data-go="map"><span>▧</span><b>Map</b></button><button data-go="alerts"><span>△</span><b>Alerts</b></button><button data-go="accuracy"><span>◎</span><b>Accuracy</b></button>';
   document.body.appendChild(nav);
   nav.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;let target=null;if(b.dataset.go==='forecast')target=qs('.topbar');if(b.dataset.go==='models')target=byTitle('Model consensus');if(b.dataset.go==='map'||b.dataset.go==='alerts')target=byTitle('Official data');if(b.dataset.go==='accuracy')target=byTitle('Accuracy engine');target?.scrollIntoView({behavior:'smooth',block:'start'});all('button',nav).forEach(x=>x.classList.toggle('active',x===b))});
 }
 function arrange(){
   const warn=qs('#warn'),hero=qs('.hero'),brief=qs('.dayBrief'); if(!warn||!hero)return;
   const glance=qs('#glance')?.closest('.section'),hourly=byTitle('Next 12 hours'),days=byTitle('7-day outlook');
   if(glance)glance.classList.add('glanceSection'); if(hourly)hourly.classList.add('sectionHour'); if(days)days.classList.add('sectionDays');
   const primary=new Set([glance,hero,brief,hourly,days].filter(Boolean));all('.section').forEach(s=>s.classList.toggle('sectionDeep',!primary.has(s)));
   let anchor=warn;for(const n of [glance,hero,brief,hourly,days].filter(Boolean)){if(anchor.nextElementSibling!==n)anchor.insertAdjacentElement('afterend',n);anchor=n}
   const summary=qs('#daySummary');if(summary&&summary.parentElement!==hero){summary.classList.add('heroSummary');hero.querySelector('.callout')?.insertAdjacentElement('afterend',summary)}
   if(!hero.querySelector('.confidenceOrb')){const orb=document.createElement('div');orb.className='confidenceOrb';orb.innerHTML='<strong>--%</strong><span>Forecast Confidence</span><small>model agreement</small>';hero.appendChild(orb)}
   if(!qs('#photoCredit')){const f=all('.footer').at(-1);if(f){const c=document.createElement('div');c.id='photoCredit';c.className='photoCredit';c.innerHTML='Hero photo: <a href="https://commons.wikimedia.org/wiki/File:Peggys_Cove_Lighthouse,_NS.jpg" target="_blank" rel="noopener">Shawn M. Kent / Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by/1.0/" target="_blank" rel="noopener">CC BY 1.0</a>';f.insertAdjacentElement('afterend',c)}}
   addBottomNav();
 }
 function activeLocation(){const a=qs('.tab.active');return a?.textContent.replace(/^[^A-Za-z]+/,'').trim()||'Weather Consensus'}
 function syncHeader(){txt(qs('.brand h1'),activeLocation());txt(qs('.brandsub'),'Weather Consensus · Real Feel first')}
 function syncConfidence(){const orb=qs('.confidenceOrb');if(!orb)return;const u=parseFloat((qs('#uncertainty')?.textContent||'').replace(/[^0-9.]/g,''));const count=all('#models .model').length||parseInt((qs('#modelCount')?.textContent||'').match(/\d+/)?.[0]||'0',10);let score=86;if(Number.isFinite(u)){score=u<=.6?95:u<=1?92:u<=1.5?88:u<=2.2?82:74}txt(qs('strong',orb),`${score}%`);txt(qs('small',orb),count?`agreement across ${count} models`:'model agreement')}
 function normalizeLabels(){all('.hour b').forEach(el=>el.setAttribute('aria-label',`Real Feel ${el.textContent.trim()}`));all('.dayTemps strong').forEach(el=>el.setAttribute('aria-label',`Real Feel maximum ${el.textContent.trim()}`))}
 function refresh(){arrange();syncHeader();syncConfidence();normalizeLabels()}
 window.addEventListener('DOMContentLoaded',()=>{refresh();[250,900,2200,5000].forEach(ms=>setTimeout(refresh,ms));qs('#tabs')?.addEventListener('click',()=>setTimeout(refresh,50));qs('#locPrev')?.addEventListener('click',()=>setTimeout(refresh,50));qs('#locNext')?.addEventListener('click',()=>setTimeout(refresh,50))});window.addEventListener('load',refresh);
})();
