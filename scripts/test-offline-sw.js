/* Verifica la rama de producción del service worker; el navegador prueba localhost. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve('dist');
const events=new Map(),cacheStores=new Map();
let skipped=0,claimed=0;
const key=value=>{const u=new URL(typeof value==='string'?value:value.url,'https://clidanfi.example');return u.pathname+u.search;};
const caches={
  async open(name){
    if(!cacheStores.has(name))cacheStores.set(name,new Map());
    const entries=cacheStores.get(name);
    return {
      async addAll(files){
        const rows=files.map(file=>{const local=path.resolve(root,'.'+new URL(file,'https://clidanfi.example').pathname);assert.ok(local.startsWith(root+path.sep));return[key(file),fs.readFileSync(local)];});
        for(const[k,v]of rows)entries.set(k,v);
      },
      async match(request){const row=entries.get(key(request));return row?new Response(row):undefined;}
    };
  },
  async keys(){return [...cacheStores.keys()];},
  async delete(name){return cacheStores.delete(name);}
};
const self={location:new URL('https://clidanfi.example/sw.js'),
  addEventListener:(type,fn)=>events.set(type,fn),skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;}}};
vm.runInNewContext(fs.readFileSync('dist/sw.js','utf8'),{self,caches,URL,console,fetch:async()=>{throw new Error('Sin red');}});
async function lifecycle(name){let job;events.get(name)({waitUntil:value=>{job=value;}});await job;}
async function request(url,mode='cors'){
  let result;events.get('fetch')({request:{url,mode,method:'GET'},respondWith:value=>{result=value;}});return result;
}
(async()=>{
  cacheStores.set('clidanfi-shell-vieja',new Map());cacheStores.set('otra-aplicacion',new Map());
  await lifecycle('install');assert.equal(skipped,0,'producción espera sin interrumpir formularios');
  assert.ok(cacheStores.has('clidanfi-shell-vieja'),'la instalación conserva la versión activa');
  const shell=[...cacheStores.keys()].find(k=>k.startsWith('clidanfi-shell-')&&k!=='clidanfi-shell-vieja');
  assert.ok(cacheStores.get(shell).has('/js/offline.js'));assert.ok(cacheStores.get(shell).has('/js/offline-profile.js'));
  assert.ok(cacheStores.get(shell).has('/js/supabase-client.js'));assert.ok(cacheStores.get(shell).has('/manifest.webmanifest'));
  await lifecycle('activate');assert.equal(claimed,1);assert.ok(!cacheStores.has('clidanfi-shell-vieja'));assert.ok(cacheStores.has('otra-aplicacion'));
  const html=await(await request('https://clidanfi.example/','navigate')).text();
  assert.equal(html,fs.readFileSync('dist/index.html','utf8'));
  const script=html.match(/src="\.\/(js\/offline-profile\.js\?v=[^"]+)"/)[1];
  const cached=await(await request('https://clidanfi.example/'+script)).text();
  assert.equal(cached,fs.readFileSync('dist/js/offline-profile.js','utf8'));
  assert.equal(await request('https://example.supabase.co/rest/v1/notas'),undefined,'no intercepta datos clínicos');
  console.log('Service worker de producción: precaché completa, apertura sin red, actualización diferida y aislamiento de datos correctos.');
})().catch(e=>{console.error(e);process.exitCode=1;});
