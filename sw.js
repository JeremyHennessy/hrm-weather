const CACHE='weather-consensus-v13';
const ASSETS=['./','./index.html','./app.html','./v4.css','./v9-modern.css','./v5b.js','./v6-extra.js','./v7-final.js','./v8-ui.js','./manifest.webmanifest','./icons/weather-consensus.svg','./icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.hostname.includes('open-meteo.com')||u.hostname.includes('weather.gc.ca')||u.pathname.includes('/data/'))return;e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request)))});
