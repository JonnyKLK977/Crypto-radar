const CACHE_NAME="crypto-radar-shell-v13";
const SHELL=["/","/styles.css","/phase2.css","/phase3.css","/phase4.css","/phase5.css","/phase6.css","/phase7.css","/phase8.css","/phase9.css","/phase10.css","/phase11.css","/phase12.css","/phase13.css","/phase14.css","/phase15.css","/phase16.css","/phase17.css","/phase18.css","/phase19.css","/phase20.css","/phase21.css","/app.js","/i18n.js","/i18n-en.json","/i18n-es.json","/icon.svg","/manifest.webmanifest"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>Promise.allSettled(SHELL.map(path=>cache.add(path)))));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put("/",copy));return response}).catch(()=>caches.match("/")));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>{
    const network=fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))}return response});
    return cached||network;
  }));
});
