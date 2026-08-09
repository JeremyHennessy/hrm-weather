import('./weather-icons.js?v=20').catch(()=>{});
(()=>{
  const scenes={
    'HRM Core':{
      file:'2022-08-15 01 Wide angle view of Halifax skyline, Nova Scotia, Canada.jpg',
      position:'50% center',
      page:'https://commons.wikimedia.org/wiki/File:2022-08-15_01_Wide_angle_view_of_Halifax_skyline,_Nova_Scotia,_Canada.jpg',
      credit:'Halifax skyline / Wikimedia Commons'
    },
    'Moncton':{
      file:'Moncton-Skyline-web.jpg',
      position:'50% center',
      page:'https://commons.wikimedia.org/wiki/File:Moncton-Skyline-web.jpg',
      credit:'Moncton skyline across the Petitcodiac / Wikimedia Commons'
    },
    'Shediac':{
      file:'Plage Parlee.JPG',
      position:'50% center',
      page:'https://commons.wikimedia.org/wiki/File:Plage_Parlee.JPG',
      credit:'Parlee Beach / Wikimedia Commons'
    },
    'Lunenburg':{
      file:'Lunenburg waterfront, panorama (7161756495).jpg',
      position:'50% center',
      page:'https://commons.wikimedia.org/wiki/File:Lunenburg_waterfront,_panorama_(7161756495).jpg',
      credit:'Lunenburg waterfront / Wikimedia Commons'
    },
    'Wolfville Area':{
      file:'Gaspereau Vineyards Nova Scotia.jpg',
      position:'50% 52%',
      page:'https://commons.wikimedia.org/wiki/File:Gaspereau_Vineyards_Nova_Scotia.jpg',
      credit:'Gaspereau Valley vineyards / Wikimedia Commons'
    }
  };

  function gradient(part,kind){
    const time={
      dawn:'linear-gradient(180deg,rgba(16,37,60,.08) 0%,rgba(179,101,83,.12) 35%,rgba(3,25,43,.80) 77%,rgba(2,19,34,.97) 100%)',
      day:'linear-gradient(180deg,rgba(0,28,51,.02) 0%,rgba(0,27,48,.08) 34%,rgba(2,25,43,.70) 72%,rgba(2,22,39,.97) 100%)',
      dusk:'linear-gradient(180deg,rgba(26,22,57,.08) 0%,rgba(125,66,88,.13) 38%,rgba(4,23,43,.81) 75%,rgba(2,18,34,.98) 100%)',
      night:'linear-gradient(180deg,rgba(0,7,24,.32) 0%,rgba(0,14,31,.44) 38%,rgba(1,17,32,.87) 74%,rgba(0,12,25,.99) 100%)'
    }[part]||'linear-gradient(180deg,rgba(0,14,31,.2),rgba(0,12,25,.94))';
    const weather={
      sun:'linear-gradient(110deg,rgba(255,198,92,.04),transparent 62%)',
      partly:'linear-gradient(110deg,rgba(110,174,207,.05),transparent 62%)',
      cloud:'linear-gradient(110deg,rgba(90,111,126,.17),rgba(35,58,75,.08) 58%,transparent)',
      fog:'linear-gradient(110deg,rgba(211,225,230,.23),rgba(89,112,124,.15) 60%,transparent)',
      rain:'linear-gradient(110deg,rgba(17,65,96,.31),rgba(10,37,62,.16) 60%,transparent)',
      storm:'linear-gradient(110deg,rgba(22,26,58,.40),rgba(7,22,42,.24) 60%,transparent)',
      snow:'linear-gradient(110deg,rgba(218,232,239,.27),rgba(101,132,150,.14) 60%,transparent)'
    }[kind]||'linear-gradient(transparent,transparent)';
    return `${time},${weather}`;
  }

  function apply(){
    const hero=document.querySelector('.hero');
    if(!hero)return;
    const loc=hero.dataset.location||'HRM Core';
    const scene=scenes[loc]||scenes['HRM Core'];
    const part=hero.dataset.daypart||'day';
    const kind=hero.dataset.condition||'partly';
    const file=`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(scene.file)}?width=1800`;
    hero.style.setProperty('background-image',`${gradient(part,kind)},url("${file}")`,'important');
    hero.style.setProperty('background-position',scene.position,'important');
    hero.dataset.sceneSource='iconic-local';
    const credit=document.querySelector('#photoCredit');
    if(credit)credit.innerHTML=`Hero photo: <a href="${scene.page}" target="_blank" rel="noopener">${scene.credit}</a> · weather/time treatment applied`;
  }

  function weatherEmoji(text){
    for(const e of ['⛈️','⛈','🌨️','🌨','❄️','❄','🌧️','🌧','🌦️','🌦','🌫️','🌫','☁️','☁','⛅️','⛅','🌥️','🌥','🌤️','🌤','☀️','☀'])if(text.includes(e))return e;
    return '⛅️';
  }

  function formatDays(){
    const root=document.querySelector('#days');
    if(!root)return;
    [...root.querySelectorAll('.day')].forEach(day=>{
      if(day.classList.contains('v11Day'))return;
      const name=day.querySelector(':scope > b')?.textContent?.trim()||'';
      const main=day.querySelector('.dayMain')?.textContent||'';
      const rf=main.match(/(?:feels|Real Feel)\s*max\s*(-?\d+(?:\.\d+)?)°/i)?.[1];
      const rain=main.match(/☂\s*(\d+(?:\.\d+)?)%/)?.[1];
      const mm=main.match(/·\s*(\d+(?:\.\d+)?)mm/)?.[1];
      const high=day.querySelector('.dayTemps strong')?.textContent?.trim()||'--°';
      const low=(day.querySelector('.dayTemps small')?.textContent||'').match(/-?\d+(?:\.\d+)?°/)?.[0]||'--°';
      if(!rf)return;
      day.classList.add('v11Day');
      day.innerHTML=`<small class="v11DayName">${name}</small><div class="v11DayWx">${weatherEmoji(main)}</div><strong class="v11DayRF">${rf}°</strong><span class="v11DayActual">Actual ${high} / ${low}</span><span class="v11DayRain">☂ ${rain||'--'}%${mm?` · ${mm}mm`:''}</span>`;
    });
  }

  function formatHours(){
    document.querySelectorAll('#hours .hour .sub').forEach(el=>{
      if(/^air\s/i.test(el.textContent))el.textContent=el.textContent.replace(/^air\s*/i,'Actual ');
    });
  }

  function start(){
    const hero=document.querySelector('.hero');
    if(!hero){setTimeout(start,100);return;}
    apply();formatDays();formatHours();
    new MutationObserver(apply).observe(hero,{attributes:true,attributeFilter:['data-location','data-condition','data-daypart']});
    const days=document.querySelector('#days');if(days)new MutationObserver(()=>queueMicrotask(formatDays)).observe(days,{childList:true});
    const hours=document.querySelector('#hours');if(hours)new MutationObserver(()=>queueMicrotask(formatHours)).observe(hours,{childList:true,subtree:true});
    document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(()=>{apply();formatDays();formatHours()},50));
    document.querySelector('.locationPicker')?.addEventListener('change',()=>setTimeout(()=>{apply();formatDays();formatHours()},50));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
