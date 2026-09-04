(()=>{
  const clean=s=>(s||'').replace(/\uFE0F/g,'').trim();
  const icons={
    '☀':()=>sun(),
    '🌤':()=>partly(),
    '⛅':()=>partly(),
    '☁':()=>cloud(),
    '🌫':()=>fog(),
    '🌧':()=>rain(),
    '🌦':()=>showers(),
    '🌨':()=>snow(),
    '⛈':()=>storm()
  };
  const defs=`<defs>
    <linearGradient id="wcCloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f9fcff"/><stop offset="1" stop-color="#c9d8e2"/></linearGradient>
    <linearGradient id="wcCloudDark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dce6ed"/><stop offset="1" stop-color="#aebfca"/></linearGradient>
    <linearGradient id="wcSun" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd95a"/><stop offset="1" stop-color="#ffb52f"/></linearGradient>
    <linearGradient id="wcRain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fdcff"/><stop offset="1" stop-color="#4daeff"/></linearGradient>
    <filter id="wcShadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#001421" flood-opacity=".24"/></filter>
  </defs>`;
  const svg=body=>`<svg class="wcIcon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${defs}${body}</svg>`;
  const cloudShape=(fill='url(#wcCloud)')=>`<path d="M18 45.5h30.5c7 0 11.5-4.5 11.5-10.4 0-5.8-4.4-10.1-10.1-10.4C47.6 18.5 41.9 14 35 14c-8.1 0-14.8 6.1-15.8 14A9.3 9.3 0 0 0 9 37.2c0 4.8 3.7 8.3 9 8.3Z" fill="${fill}" filter="url(#wcShadow)"/>`;
  function sun(){return svg(`<g stroke="#ffc33e" stroke-width="2.3" stroke-linecap="round"><path d="M32 5v7M32 52v7M5 32h7M52 32h7M13 13l5 5M46 46l5 5M51 13l-5 5M18 46l-5 5"/></g><circle cx="32" cy="32" r="13.5" fill="url(#wcSun)" filter="url(#wcShadow)"/>`)}
  function cloud(){return svg(`<path d="M19 44.5h29.2c7.4 0 12.3-4.8 12.3-11.1 0-6.1-4.7-10.7-10.8-11-2.5-6.5-8.5-11-15.7-11-8.6 0-15.6 6.4-16.8 14.8-6 .2-10.7 4.9-10.7 10.2 0 4.8 4 8.1 12.5 8.1Z" fill="url(#wcCloud)" filter="url(#wcShadow)"/><path d="M17.2 27.1c1.5-8.4 8.4-14.8 16.8-14.8 6.9 0 12.9 4.1 15.7 10.2" fill="none" stroke="#fff" stroke-opacity=".52" stroke-width="1.2" stroke-linecap="round"/>`)}
  function partly(){return svg(`<g opacity=".98"><g stroke="#ffc33e" stroke-width="2" stroke-linecap="round"><path d="M20 5v5M7.5 17.5l4 2.3M32.5 17.5l-4 2.3M9 31h5M31 5v5"/></g><circle cx="20" cy="20" r="10.2" fill="url(#wcSun)" filter="url(#wcShadow)"/></g>${cloudShape()}`)}
  function rain(){return svg(`${cloudShape('url(#wcCloudDark)')}<g stroke="url(#wcRain)" stroke-width="3" stroke-linecap="round"><path d="M22 49l-3 7M34 49l-3 7M46 49l-3 7"/></g>`)}
  function showers(){return svg(`<g opacity=".98"><circle cx="18" cy="18" r="8.5" fill="url(#wcSun)" filter="url(#wcShadow)"/></g>${cloudShape()}<g stroke="url(#wcRain)" stroke-width="3" stroke-linecap="round"><path d="M26 49l-3 7M40 49l-3 7"/></g>`)}
  function snow(){return svg(`${cloudShape('url(#wcCloudDark)')}<g stroke="#dff6ff" stroke-width="1.8" stroke-linecap="round"><path d="M22 50v8M18.5 52l7 4M25.5 52l-7 4M42 50v8M38.5 52l7 4M45.5 52l-7 4"/></g>`)}
  function fog(){return svg(`<path d="M18 37h28c5.5 0 9-3.3 9-7.5 0-4.4-3.5-7.6-8-7.7C44.7 16.5 39.8 13 34 13c-7.2 0-13 5.3-14 12.2-5.2.2-9 4-9 8.2 0 2 .7 3.3 2.2 3.6Z" fill="url(#wcCloudDark)" opacity=".88" filter="url(#wcShadow)"/><g stroke="#dbe7ed" stroke-width="2.4" stroke-linecap="round" opacity=".88"><path d="M10 43h39M16 50h38M8 57h34"/></g>`)}
  function storm(){return svg(`${cloudShape('url(#wcCloudDark)')}<path d="M35 46h-8l4-9h9l-5 8h6l-11 14 5-13Z" fill="#ffd457" filter="url(#wcShadow)"/><g stroke="url(#wcRain)" stroke-width="2.5" stroke-linecap="round"><path d="M18 49l-2 5M49 49l-2 5"/></g>`)}
  function replace(el){
    if(!el || el.querySelector?.('.wcIcon'))return;
    const raw=clean(el.textContent),fn=icons[raw];
    if(fn){if(!el.dataset.wxRaw)el.dataset.wxRaw=raw;el.innerHTML=fn()}
  }
  function decorate(root=document){
    if(root.matches?.('#heroIcon,.wx,.v11DayWx'))replace(root);
    root.querySelectorAll?.('#heroIcon,.wx,.v11DayWx').forEach(replace);
  }
  const style=document.createElement('style');
  style.textContent=`.wcIcon{width:1em;height:1em;display:inline-block;vertical-align:-.12em;overflow:visible}.icon .wcIcon{width:1em;height:1em}.wx .wcIcon,.v11DayWx .wcIcon{margin:auto}.wcIcon path,.wcIcon circle{vector-effect:non-scaling-stroke}`;
  document.head.appendChild(style);
  function start(){
    decorate();
    ['heroIcon','hours','days'].forEach(id=>{const el=document.getElementById(id);if(el)new MutationObserver(()=>decorate(el)).observe(el,{childList:true,subtree:true,characterData:true});});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
