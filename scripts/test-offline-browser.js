/* Prueba completa sin cuentas reales: servidor local + Supabase simulado.
   Ejecutar después de npm run build. Usa Edge instalado; no descarga navegadores. */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve('dist');
const mock = `(() => {
 const user={id:'offline-test-user',email:'offline@test.invalid'};
 const now=new Date().toISOString();
 const patient={id:'offline-test-patient',usuario_id:user.id,nombre:'Paciente de prueba sin conexión',telefono:'1234567890',activo:true,creado_en:now,paquete_total:0,paquete_usadas:0};
 const tables={perfiles:[{id:user.id,rol:'fisio',nombre:'Prueba Offline'}],configuracion:[{id:1,clinica:'CLIDANFI',lema:'Prueba local',logo_url:null,precio_sesion:450}],pacientes:[patient],pacientes_ordenados:[patient],citas:[],notas:[{id:'offline-test-note',paciente_id:patient.id,texto:'Nota clínica anterior disponible sin internet',creado_en:now,fecha_nota:now,adjuntos:[],revision:1,signos_vitales:{}}],archivos:[{id:'offline-test-file',paciente_id:patient.id,titulo:'Foto reciente de prueba',ruta:patient.id+'/foto.jpg',mime:'image/jpeg',tamano:1000,creado_en:now},...[1,2].map(n=>({id:'old-file-'+n,paciente_id:patient.id,titulo:'Archivo anterior '+n,ruta:patient.id+'/old-'+n+'.jpg',mime:'image/jpeg',tamano:n*2000,creado_en:new Date(new Date().getFullYear(),new Date().getMonth()-n,1).toISOString()}))]};
 const sb={auth:{getSession:async()=>({data:{session:{user}}}),getUser:async()=>({data:{user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({})},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:location.origin+'/assets/logo-clidanfi.jpeg'}}),getPublicUrl:()=>({data:{publicUrl:location.origin+'/assets/logo-clidanfi.jpeg'}}),upload:async()=>({data:{}})})},rpc:async()=>({data:[]}),from(table){
 let filters=[],one=false,from=0,to=999,action='read',payload;
 const query={select(){return query},eq(k,v){filters.push(r=>r[k]===v);return query},neq(){return query},gte(){return query},lte(){return query},gt(){return query},lt(){return query},is(){return query},in(){return query},or(){return query},order(){return query},limit(n){to=n-1;return query},range(a,b){from=a;to=b;return query},single(){one=true;return query},maybeSingle(){one=true;return query},insert(r){action='insert';payload=r;return query},update(r){action='update';payload=r;return query},then(resolve,reject){
 try{let rows=(tables[table]||[]).filter(r=>filters.every(fn=>fn(r)));
 if(action==='insert'){if(!tables[table])tables[table]=[];tables[table].push(payload);rows=[payload];}
 if(action==='update')rows.forEach(r=>Object.assign(r,payload));
 return Promise.resolve({data:one?(rows[0]||null):rows.slice(from,to+1),error:null,count:rows.length}).then(resolve,reject);
 }catch(e){return Promise.reject(e).then(resolve,reject)}
 }};return query;
 }};
 window.supabase={createClient:()=>sb};
})();`;
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpeg':'image/jpeg', '.webmanifest':'application/manifest+json' };
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  if (pathname === '/legacy-sw.js') {
    res.setHeader('Content-Type','text/javascript');
    return res.end("self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open('clidanfi-shell-legacy-preview');await c.put('/index.html',new Response('<html><body>Vista anterior guardada</body></html>',{headers:{'Content-Type':'text/html'}}));await self.skipWaiting();})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(caches.open('clidanfi-shell-legacy-preview').then(c=>c.match('/index.html')));});");
  }
  if (pathname === '/js/vendor/supabase.js') { res.setHeader('Content-Type','text/javascript'); return res.end((req.headers.cookie||'').includes('test-patient=1')?mock.replace("rol:'fisio'","rol:'paciente'"):mock); }
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(target,(error,data)=>{ if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',types[path.extname(target)] || 'application/octet-stream');res.end(data); });
});
(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const context = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:1 });
    const page = await context.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(async()=>window.App?.sesion && (await Offline.status()).last);
    assert.equal(await page.locator('#offline-status').textContent(),'Con conexión');
    assert.equal(await page.locator('#offline-status').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(220, 252, 231)');
    await page.waitForFunction(()=>document.getElementById('offline-status')?.hidden);
    await page.evaluate(()=>window.dispatchEvent(new Event('clidanfi-offline')));
    assert.ok(await page.locator('#offline-status').isHidden());
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
    await page.waitForFunction(()=>navigator.serviceWorker.controller);
    await page.locator('[data-action="abrir-cuenta"]:visible').first().click();
    await page.locator('[data-action="abrir-descargas"]').click();
    await page.getByRole('dialog',{name:'Archivos sin conexión'}).waitFor();
    assert.ok(await page.locator('#offline-remove-range').isVisible());
    assert.equal(await page.evaluate(async()=>(await Offline.status()).files.filter(f=>f.blob).length),1);
    assert.equal(await page.locator('#offline-from').evaluate(el=>el.tagName),'SELECT');
    assert.match(await page.locator('#offline-range-label').textContent(),/Hoy/);
    assert.match(await page.locator('#offline-download-all').textContent(),/Descargar todo.*KB/);
    const help=page.locator('details.offline-help');
    assert.equal(await help.getAttribute('open'),null);
    await help.locator('summary').click();
    assert.ok(await help.getByText(/Se descargan automáticamente/).isVisible());
    await help.locator('summary').click();
    fs.mkdirSync('output/offline-review',{recursive:true});
    await page.screenshot({path:'output/offline-review/profile-mobile.png',fullPage:true});
    await page.locator('#offline-download-all').click();
    await page.getByRole('button',{name:'Todo descargado',exact:true}).waitFor();
    assert.equal(await page.evaluate(async()=>(await Offline.status()).files.filter(f=>f.blob).length),3);
    await page.locator('#offline-remove-range').click();
    await page.getByRole('button',{name:'Quitar copias locales',exact:true}).click();
    await page.locator('#offline-download-all').waitFor();
    assert.equal(await page.evaluate(async()=>(await Offline.status()).files.filter(f=>f.blob).length),1);
    await page.locator('#offline-download-all').click();
    await page.getByRole('button',{name:'Todo descargado',exact:true}).waitFor();
    await context.setOffline(true);
    // Cerrar la pestaña y volver a entrar sin pedir ningún archivo a la red.
    await page.close();
    const offline = await context.newPage();
    offline.on('pageerror',e=>errors.push(e.message));
    await offline.goto(url+'/#/t/agenda');
    await offline.waitForFunction(()=>window.App?.sesion);
    assert.equal(await offline.evaluate(()=>App.sesion.user.id),'offline-test-user');
    assert.equal(await offline.evaluate(async()=>(await API.listarPacientes({q:'Paciente'})).length),1);
    assert.match(await offline.evaluate(async()=>(await API.notasDePaciente('offline-test-patient'))[0].texto),/sin internet/);
    assert.ok((await offline.evaluate(async()=>(await API.enlaceDeArchivo('offline-test-file')).url)).startsWith('blob:'));
    assert.ok(await offline.locator('#offline-status').isVisible());
    assert.match(await offline.locator('#offline-status').textContent(),/^Sin conexión · Última conexión:/);
    assert.equal(await offline.locator('#offline-status').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 244, 220)');
    await offline.goto(url+'/#/t/paciente/offline-test-patient?tab=valoracion');
    await offline.getByText('Sin valoración inicial',{exact:true}).waitFor();
    await offline.goto(url+'/#/t/paciente/offline-test-patient?tab=historial');
    await offline.getByText('Nota clínica anterior disponible sin internet',{exact:true}).waitFor();
    assert.equal(await offline.locator('[data-action="editar-nota"]').count(), 0);
    assert.equal(await offline.evaluate(()=>typeof API.editarNota), 'undefined');
    await offline.locator('[data-action="fecha-nota"][data-id="offline-test-note"]').click();
    await offline.locator('#f-fecha-nota').fill('2026-10-28T12:30');
    await offline.locator('#guardar-fecha-nota').click();
    await offline.getByText('Nota clínica anterior disponible sin internet',{exact:true}).waitFor();
    assert.equal(await offline.evaluate(async()=>(await API.obtenerNota('offline-test-note')).texto),'Nota clínica anterior disponible sin internet');
    await offline.locator('[data-action="nueva-nota"]').click();
    await offline.locator('#f-nota-texto').fill('Atención capturada en la calle');
    await offline.locator('#btn-guardar-nota').click();
    await offline.getByText('Atención capturada en la calle',{exact:true}).waitFor();
    const noteId=await offline.evaluate(async()=>(await API.notasDePaciente('offline-test-patient')).find(n=>n.texto==='Atención capturada en la calle').id);
    await offline.reload();
    await offline.waitForFunction(()=>window.App?.sesion);
    assert.equal(await offline.evaluate(async id=>(await API.obtenerNota(id)).texto,noteId),'Atención capturada en la calle');
    assert.equal(await offline.evaluate(async()=>new Date((await API.obtenerNota('offline-test-note')).fecha_nota).getDate()),28);
    await offline.locator('#f-exp-archivo').setInputFiles('assets/icon-192.png');
    await offline.waitForFunction(async()=>(await Offline.status()).pending.some(q=>q.table==='archivos'));
    await offline.evaluate(()=>OfflineProfile.show());
    await offline.getByRole('dialog',{name:'Archivos sin conexión'}).waitFor();
    await offline.screenshot({path:'output/offline-review/profile-mobile-offline.png',fullPage:true});
    await offline.setViewportSize({width:1440,height:1000});
    await offline.screenshot({path:'output/offline-review/profile-desktop-offline.png',fullPage:true});
    await context.setOffline(false);
    await offline.waitForFunction(()=>document.getElementById('offline-status')?.textContent==='Con conexión' && !document.getElementById('offline-status').hidden);
    await offline.waitForFunction(()=>document.getElementById('offline-status')?.hidden);
    assert.deepEqual(errors,[]);
    await context.close();
    // Regresión: una caché antigua debe actualizarse sin borrar datos locales.
    const upgradeContext=await browser.newContext({viewport:{width:390,height:844}});
    const upgrade=await upgradeContext.newPage();
    await upgrade.goto(url);
    await upgrade.waitForFunction(async()=>window.App?.sesion && (await Offline.status()).last);
    await upgrade.evaluate(async()=>{
      await new Promise((resolve,reject)=>{const r=indexedDB.open('clidanfi-offline-v1');r.onsuccess=()=>{const tx=r.result.transaction('meta','readwrite');tx.objectStore('meta').put({key:'preview-upgrade-sentinel',value:'conservar'});tx.oncomplete=()=>{r.result.close();resolve();};tx.onerror=reject;};});
      await navigator.serviceWorker.register('/legacy-sw.js',{scope:'/'});
    });
    await upgrade.waitForFunction(()=>navigator.serviceWorker.controller?.scriptURL.endsWith('/legacy-sw.js'));
    await upgrade.reload();
    await upgrade.getByText('Vista anterior guardada',{exact:true}).waitFor();
    await upgrade.evaluate(()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}));
    await upgrade.waitForFunction(()=>navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
    await upgrade.reload();
    await upgrade.waitForFunction(()=>window.App?.sesion);
    assert.equal(await upgrade.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('clidanfi-offline-v1');r.onsuccess=()=>{const q=r.result.transaction('meta').objectStore('meta').get('preview-upgrade-sentinel');q.onsuccess=()=>{resolve(q.result.value);r.result.close();};};})),'conservar');
    await upgrade.locator('[data-action="abrir-cuenta"]:visible').first().click();
    const entry=upgrade.locator('[data-action="abrir-descargas"]');
    assert.equal(await entry.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(254, 243, 199)');
    await upgrade.screenshot({path:'output/offline-review/profile-entry-yellow.png',fullPage:true});
    await entry.click();
    assert.equal(await upgrade.locator('#offline-from').evaluate(el=>el.tagName),'SELECT');
    await upgradeContext.close();
    const patientContext=await browser.newContext();
    await patientContext.addCookies([{name:'test-patient',value:'1',url}]);
    let patientPage=await patientContext.newPage();
    await patientPage.goto(url);
    await patientPage.waitForFunction(async()=>App.sesion?.perfil.rol==='paciente' && (await Offline.status()).last);
    await patientPage.evaluate(()=>navigator.serviceWorker.ready);
    await patientPage.waitForFunction(()=>navigator.serviceWorker.controller);
    await patientContext.setOffline(true);await patientPage.close();patientPage=await patientContext.newPage();
    await patientPage.goto(url+'/#/p/inicio');await patientPage.waitForFunction(()=>App.sesion?.perfil.rol==='paciente');
    assert.equal(await patientPage.evaluate(async()=>(await API.miPaciente()).id),'offline-test-patient');
    assert.equal(await patientPage.evaluate(async()=>(await API.misBoletos('offline-test-patient')).length),0);
    assert.equal(await patientPage.evaluate(async()=>(await API.listarPromociones({soloVigentes:true})).length),0);
    assert.equal(await patientPage.evaluate(async()=>{try{await API.obtenerPaciente('otro-paciente');return 'permitido';}catch(e){return e.message;}}),'Acceso denegado: no puedes consultar el expediente de otro paciente.');
    assert.match(await patientPage.evaluate(async()=>{try{await API.obtenerNota('offline-test-note');return 'permitido';}catch(e){return e.message;}}),/exclusiva del fisioterapeuta/);
    await patientContext.close();
    console.log('Navegador: precaché completa, apertura desde cero sin red, sesión persistente, agenda, expedientes, fotos y notas tras recarga correctos. Capturas en output/offline-review.');
  } finally { await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; }).finally(()=>server.close());
