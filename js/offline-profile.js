(function (global) {
  'use strict';
  const { escapeHtml: E, openSheet, confirmSheet, toast } = UI;
  const size = n => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
  const fileCount = n => `${n} archivo${n === 1 ? '' : 's'}`;
  const date = value => value ? new Date(value).toLocaleString('es-MX') : 'Todavía no completada';
  const monthKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const monthName = key => new Date(`${key}-01T12:00:00`).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
  const amount = files => {
    const bytes = files.reduce((n,f)=>n+(f.blob?.size || f.expected || 0),0);
    const unknown = files.some(f=>!f.blob && !(f.expected>0));
    return { bytes, label: unknown ? (bytes ? `al menos ${size(bytes)}` : 'tamaño por calcular') : size(bytes) };
  };
  async function show(selection = {}) {
    let s = await Offline.status(), estimate;
    try { estimate = await navigator.storage?.estimate?.(); } catch {}
    const now=new Date(), today=Offline.fileDay(now), previous=monthKey(new Date(now.getFullYear(),now.getMonth()-1,1));
    const first=[previous,...s.files.map(f=>Offline.fileDay(f.date).slice(0,7)).filter(Boolean)].sort()[0];
    const months=[], cursor=new Date(`${first}-01T12:00:00`);
    while(monthKey(cursor)<=monthKey(now)){months.push(monthKey(cursor));cursor.setMonth(cursor.getMonth()+1);}
    const start=selection.from || previous, end=selection.to || 'today';
    const downloaded=s.files.filter(f=>f.blob), missing=s.files.filter(f=>!f.blob);
    const used=estimate?.usage ?? (s.fileBytes+s.textBytes+s.pendingBytes);
    const option=(key,selected)=>`<option value="${key}" ${key===selected?'selected':''}>${E(monthName(key))}</option>`;
    const names={crearPaciente:'Paciente',crearPacienteExpres:'Paciente',crearNota:'Nota',cambiarFechaNota:'Cambio de fecha',editarNota:'Edición anterior desactivada',guardarValoracion:'Valoración',subirArchivo:'Archivo'};
    openSheet({
      title:'Archivos sin conexión',subtitle:'Mi cuenta · Este dispositivo',size:'tall',
      body:`<div class="offline-downloads space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div><p class="text-[12px] text-ink-500">Espacio ocupado</p><p class="text-[28px] font-extrabold">≈ ${size(used)}</p></div>
          <details class="agenda-help offline-help"><summary aria-label="Ayuda de archivos sin conexión">?</summary><div class="agenda-help-content space-y-3">
            <p>El espacio ocupado estima lo que guarda esta aplicación en este navegador, incluidas sus cuentas. Los archivos descargados y por descargar corresponden a tu cuenta.</p>
            <p>Se descargan automáticamente los últimos 7 días. Las copias anteriores permanecen hasta que tú las retires. Las notas y valoraciones se guardan como texto, sin descargar sus PDF.</p>
            <p>Los intervalos incluyen meses completos. «Hoy» termina en la fecha actual. Se usa la fecha de la nota o de creación del archivo.</p>
            <p>Quitar copias solo libera espacio aquí. Conserva los originales en la nube y Drive, los textos y los archivos pendientes de subir. Las copias retiradas no se descargan otra vez automáticamente.</p>
            <p>Los tamaños pendientes se consultan sin descargar el contenido. Si falta información se indica un mínimo conocido o «tamaño por calcular».</p>
            <p>La agenda muestra la última información recibida. Las citas requieren conexión. La aplicación sincroniza mientras está abierta.</p>
            <p>Última preparación: ${E(date(s.last))}. Borrar los datos del sitio o desinstalar puede eliminar trabajo no sincronizado.</p>
            <button id="offline-persist" class="w-full rounded-xl border border-ink-200 p-3 text-sm">Proteger almacenamiento</button><p id="offline-persist-status" class="text-sm" role="status"></p>
          </div></details>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl bg-brand-50 p-3"><p class="text-[12px] text-ink-500">Descargados</p><p class="text-[20px] font-extrabold">${fileCount(downloaded.length)}</p><p class="text-[12px]">${size(s.fileBytes)}</p></div>
          <div class="rounded-xl bg-ink-50 p-3"><p class="text-[12px] text-ink-500">Por descargar</p><p class="text-[20px] font-extrabold">${fileCount(missing.length)}</p><p id="offline-missing-size" class="text-[12px]">${E(amount(missing).label)}</p></div>
        </div>
        <button id="offline-download-all" class="w-full rounded-xl bg-brand-700 p-3 font-bold text-white" ${!Offline.online()||!missing.length?'disabled':''}>${missing.length?`Descargar todo · ${E(amount(missing).label)}`:'Todo descargado'}</button>
        <div class="rounded-xl border border-ink-200 p-3 space-y-3">
          <p class="text-[13px] font-bold">Elegir un periodo</p>
          <div class="grid grid-cols-2 gap-3">
            <label class="block text-[12px] font-bold">Desde<select id="offline-from" class="field">${months.map(k=>option(k,start)).join('')}</select></label>
            <label class="block text-[12px] font-bold">Hasta<select id="offline-to" class="field">${months.map(k=>option(k,end)).join('')}<option value="today" ${end==='today'?'selected':''}>Hoy</option></select></label>
          </div>
          <p id="offline-range-label" class="text-[12px] font-bold text-brand-800" role="status"></p>
          <button id="offline-download-range" class="w-full rounded-xl bg-ink-100 p-3 text-[13px] font-bold"></button>
          <button id="offline-remove-range" class="w-full rounded-xl border border-rose-200 p-3 text-[13px] font-bold text-rose-700"></button>
        </div>
        <p id="offline-download-progress" class="text-[12px]" role="status" hidden></p>
        <button id="offline-prepare" class="w-full rounded-xl border border-ink-200 p-3 text-[12px] font-bold" ${s.preparing||!Offline.online()?'disabled':''}>${s.preparing?'Actualizando…':'Actualizar información'}</button>
        ${s.error||s.failures?'<p class="text-[12px] text-amber-800">Hay información pendiente de actualizar.</p>':''}
        ${s.pending.length?`<details class="rounded-xl bg-amber-50 p-3" ${s.pending.some(q=>q.error)?'open':''}><summary class="cursor-pointer text-[12px] font-bold">${s.pending.length} cambios pendientes de subir${s.pending.some(q=>q.error)?' · Revisar':''}</summary>${s.pending.map(q=>`<div class="mt-3 text-[12px]"><p>${E(names[q.name]||'Registro')} · ${E(q.result.titulo||q.result.nombre||date(q.at))}</p>${q.error?`<p class="text-rose-700">${E(q.error)}</p>${q.base&&q.table==='valoraciones'?`<button class="block underline" data-keep-new="${E(q.key)}">Guardar como registro nuevo</button>`:''}`:''}<button class="underline" data-export-pending="${E(q.key)}">Descargar respaldo</button></div>`).join('')}</details>`:''}
      </div>`,
      onMount(root){
        let busy=false;
        const from=root.querySelector('#offline-from'),to=root.querySelector('#offline-to');
        const selected=()=>({from:from.value,to:to.value});
        const range=()=>{
          const a=`${from.value}-01`,b=to.value==='today'?today:Offline.fileDay(new Date(Number(to.value.slice(0,4)),Number(to.value.slice(5,7)),0));
          if(a>b)throw new Error('El mes inicial debe ser anterior al mes final.');return[a,b];
        };
        const inRange=()=>{const[a,b]=range();return s.files.filter(f=>Offline.fileDay(f.date)>=a&&Offline.fileDay(f.date)<=b);};
        const render=()=>{
          const get=root.querySelector('#offline-download-range'),remove=root.querySelector('#offline-remove-range');
          try{
            const files=inRange(),pending=files.filter(f=>!f.blob),local=files.filter(f=>f.blob);
            root.querySelector('#offline-range-label').textContent=`${monthName(from.value)} — ${to.value==='today'?'Hoy':monthName(to.value)}`;
            get.textContent=pending.length?`Descargar ${fileCount(pending.length)} · ${amount(pending).label}`:'Sin archivos pendientes en este periodo';
            remove.textContent=local.length?`Liberar ${amount(local).label} · ${fileCount(local.length)}`:'Sin copias locales en este periodo';
            get.disabled=busy||!Offline.online()||!pending.length;remove.disabled=busy||!local.length;
          }catch(e){root.querySelector('#offline-range-label').textContent=e.message;get.disabled=remove.disabled=true;}
        };
        from.addEventListener('change',render);to.addEventListener('change',render);render();
        const bind=(selector,fn)=>root.querySelectorAll(selector).forEach(btn=>btn.addEventListener('click',async()=>{
          if(busy)return;busy=true;btn.disabled=true;
          try{await fn(btn);}catch(e){toast(e.message,'error',6000);}
          finally{busy=false;if(btn.isConnected){btn.disabled=false;render();}}
        }));
        const download=async files=>{
          const progress=root.querySelector('#offline-download-progress');let count=0,failed=0;
          root.querySelectorAll('button,select').forEach(el=>{el.disabled=true;});progress.hidden=false;
          for(const[index,f]of files.entries()){
            progress.textContent=`Descargando ${index+1} de ${files.length}…`;
            try{await Offline.download(f,true);count++;}catch{failed++;}
          }
          toast(`${count} archivos descargados${failed?` · ${failed} pendientes`:''}`,failed?'warn':'success');await show(selected());
        };
        bind('#offline-download-all',()=>download(s.files.filter(f=>!f.blob)));
        bind('#offline-download-range',()=>download(inRange().filter(f=>!f.blob)));
        bind('#offline-remove-range',async()=>{
          const[a,b]=range(),files=inRange().filter(f=>f.blob&&!f.pending);
          const yes=await confirmSheet({title:'Liberar espacio',message:`Se quitarán ${files.length} copias (${amount(files).label}) de este dispositivo. Los originales de la nube y los cambios pendientes se conservan.`,confirmText:'Quitar copias locales',tone:'danger'});
          if(yes){const r=await Offline.removeFiles(a,b);toast(`${size(r.bytes)} liberados`);}await show(selected());
        });
        bind('#offline-prepare',async()=>{await Offline.prepare();await show(selected());});
        bind('#offline-persist',async()=>{const yes=await navigator.storage?.persist?.();root.querySelector('#offline-persist-status').textContent=yes?'Almacenamiento protegido.':'El navegador no concedió almacenamiento persistente.';});
        bind('[data-export-pending]',async btn=>{
          const q=s.pending.find(q=>q.key===btn.dataset.exportPending),binary=q.name==='subirArchivo';
          const blob=binary?q.args[1]:new Blob([JSON.stringify(q,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
          link.href=url;link.download=binary?(q.args[1].name||q.result.titulo):`clidanfi-pendiente-${q.result.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
        });
        bind('[data-keep-new]',async btn=>{const yes=await confirmSheet({title:'Conservar ambas versiones',message:'Tu edición se guardará como una valoración nueva. La versión del sistema se conserva.',confirmText:'Guardar como registro nuevo'});if(yes)await Offline.keepAsNew(btn.dataset.keepNew);await show(selected());});
        if(missing.some(f=>!(f.expected>0))&&Offline.online()){
          root.querySelector('#offline-missing-size').textContent='Calculando tamaño…';
          Offline.measureFiles().then(async()=>{
            if(!root.isConnected||busy)return;s=await Offline.status();const pending=s.files.filter(f=>!f.blob);
            root.querySelector('#offline-missing-size').textContent=amount(pending).label;
            root.querySelector('#offline-download-all').textContent=pending.length?`Descargar todo · ${amount(pending).label}`:'Todo descargado';render();
          }).catch(()=>{});
        }
      }
    });
  }

  global.OfflineProfile = { show };
  let bannerState = null, bannerTimer = null, bannerRequest = 0;
  function connectionDate(value, now = new Date()) {
    const last = new Date(value);
    if (!value || !Number.isFinite(+last)) return 'sin registro';
    const week = new Date(now);
    week.setHours(0,0,0,0);
    week.setDate(week.getDate() - (week.getDay()+6)%7);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate()-1);
    const day = last.toDateString() === now.toDateString() ? 'Hoy'
      : last.toDateString() === yesterday.toDateString() ? 'Ayer'
      : last >= week && last <= now ? last.toLocaleDateString('es-MX', { weekday:'long' })
      : last.toLocaleDateString('es-MX', { day:'2-digit',month:'2-digit',year:'numeric' });
    return `${day} - ${last.toLocaleTimeString('es-MX', { hour:'2-digit',minute:'2-digit',hourCycle:'h23' })}`;
  }
  async function updateBanner() {
      const request = ++bannerRequest;
      const user = global.App?.sesion?.user.id;
      if (!user) {
        clearTimeout(bannerTimer); bannerState = null;
        const banner = document.getElementById('offline-status');
        if (banner) banner.hidden = true;
        return;
      }
      const connected = Offline.online();
      const last = connected ? null : await Offline.connectionInfo();
      if (request !== bannerRequest || user !== global.App?.sesion?.user.id) return;
      let banner = document.getElementById('offline-status');
      if (!banner) {
        banner = document.createElement('div'); banner.id = 'offline-status'; banner.setAttribute('role','status');
        banner.className = 'offline-status'; document.body.prepend(banner);
      }
      const changed = !bannerState || bannerState.user !== user || bannerState.connected !== connected;
      bannerState = { user, connected };
      banner.className = `offline-status${connected ? ' offline-status-connected' : ''}`;
      banner.textContent = connected ? 'Con conexión' : `Sin conexión · Última conexión: ${connectionDate(last)}`;
      if (!connected) {
        clearTimeout(bannerTimer); banner.hidden = false;
      } else if (changed) {
        clearTimeout(bannerTimer); banner.hidden = false;
        bannerTimer = setTimeout(() => { if (bannerState?.connected) banner.hidden = true; }, 4000);
      }
  }
  global.addEventListener('clidanfi-offline', () => updateBanner().catch(console.error));
  document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(e => toast(`No se pudo preparar la apertura sin conexión: ${e.message}`, 'warn', 6000));
    updateBanner().catch(console.error);
  });
  document.addEventListener('click', event => {
    if (Offline.online()) return;
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (['nueva-cita','cancelar-cita','registrar-asistencia','convertir-solicitud'].includes(action)) {
      event.preventDefault(); event.stopImmediatePropagation();
      toast('Esta operación requiere conexión para comprobar la agenda compartida.', 'warn', 5000);
    }
  }, true);
})(window);
