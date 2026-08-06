/* ==========================================================================
   CLIDANFI · views-auth.js
   Puerta de entrada obligatoria + pantalla de configuración.
   Sin sesión válida no se renderiza ninguna otra vista (guardia en app.js).
   ========================================================================== */
(function (global) {
  'use strict';

  const { escapeHtml: E, icon, toast } = UI;

  /* ======================================================================
     BLOQUE DE MARCA (logo + nombre + lema)

     Sale de la tabla `configuracion`, cuya lectura es pública precisamente
     para que esta pantalla —que se pinta sin sesión— muestre el logo de la
     clínica correcta. Sin logo propio se usa el de assets/.
     ====================================================================== */
  const MARCA_DEF = { clinica: 'CLIDANFI', lema: 'Fisioterapia y rehabilitación', logo_url: '' };
  const LOGO_POR_DEFECTO = './assets/logo-clidanfi.jpeg';

  /* Última marca leída. `confirmaTuCorreo` y la pantalla de configuración son
     síncronas y no pueden esperar a la red: reutilizan lo ya cargado. */
  let _marca = { ...MARCA_DEF };

  const marca = (cfg) => {
    const c = { ..._marca, ...(cfg || {}) };
    return `
    <div class="mb-8 flex flex-col items-center text-center">
      <!-- ▼ LOGO DE LA CLÍNICA ▼ -->
      <img
        src="${E(c.logo_url || LOGO_POR_DEFECTO)}"
        alt="Logo de ${E(c.clinica)}"
        width="88" height="88"
        class="h-20 w-20 rounded-2xl object-contain"
        onerror="this.classList.add('logo-fallback'); this.removeAttribute('src');"
      />
      <!-- ▲ FIN LOGO ▲ -->
      <h1 class="mt-4 text-[26px] font-extrabold tracking-tight text-ink-900">${E(c.clinica)}</h1>
      <p class="mt-1 text-[13px] font-medium text-ink-500">${E(c.lema)}</p>
    </div>`;
  };

  /**
   * Lee la marca del servidor. No requiere sesión: la política
   * `config_lectura_publica` alcanza al rol anon. Si falla, se conservan los
   * valores por defecto y la pantalla de acceso sigue siendo usable.
   */
  const cargarMarca = async () => {
    if (!global.API || !API.getConfig) return _marca;
    try {
      _marca = { ..._marca, ...(await API.getConfig()) };
    } catch (e) {
      console.warn('[CLIDANFI] No se pudo leer la marca de la clínica:', e.message);
    }
    return _marca;
  };

  /* ======================================================================
     1 · ACCESO
     ====================================================================== */
  async function login() {
    const cfg = await cargarMarca();

    const html = `
      <div class="flex min-h-[100dvh] flex-col justify-center px-6 py-10 anim-fade-up">
        ${marca(cfg)}

        <!-- Entrar / Crear cuenta -->
        <div class="mb-5 flex gap-1 rounded-2xl bg-ink-100 p-1" role="tablist">
          <button type="button" role="tab" data-modo="entrar"
            class="btn-modo flex-1 rounded-xl py-2.5 text-[13px] font-extrabold transition">Entrar</button>
          <button type="button" role="tab" data-modo="registro"
            class="btn-modo flex-1 rounded-xl py-2.5 text-[13px] font-extrabold transition">Crear cuenta</button>
        </div>

        <!-- ============================ REGISTRO ============================ -->
        <form id="form-registro" novalidate class="hidden space-y-3.5" autocomplete="on">
          <div>
            <label for="reg-nombre" class="mb-1 block text-[12px] font-bold text-ink-700">Nombre completo</label>
            <input id="reg-nombre" type="text" autocomplete="name" required
                   placeholder="Nombre y apellidos" class="field !py-3" />
          </div>
          <div>
            <label for="reg-email" class="mb-1 block text-[12px] font-bold text-ink-700">Correo electrónico</label>
            <input id="reg-email" type="email" inputmode="email" autocomplete="email" required
                   placeholder="tucorreo@ejemplo.com" class="field !py-3" />
          </div>
          <div>
            <label for="reg-password" class="mb-1 block text-[12px] font-bold text-ink-700">Contraseña</label>
            <input id="reg-password" type="password" autocomplete="new-password" required
                   placeholder="Mínimo 6 caracteres" class="field !py-3" />
          </div>
          <div>
            <label for="reg-password2" class="mb-1 block text-[12px] font-bold text-ink-700">Repite la contraseña</label>
            <input id="reg-password2" type="password" autocomplete="new-password" required
                   placeholder="••••••••" class="field !py-3" />
          </div>

          <p id="registro-error" role="alert" aria-live="polite"
             class="hidden items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-[12.5px] font-semibold leading-snug text-brand-800 ring-1 ring-brand-200"></p>

          <button id="btn-registro" type="submit"
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[15px] font-extrabold text-white shadow-card transition active:scale-[.98] disabled:opacity-60">
            <span id="btn-registro-texto">Crear mi cuenta</span>
          </button>

          <div class="flex items-start gap-2 rounded-xl bg-ink-100 px-3 py-2.5">
            ${icon('info', 'h-4 w-4 shrink-0 text-ink-500')}
            <p class="text-[11.5px] leading-snug text-ink-600">
              ¿Ya eres paciente de la clínica? Regístrate con <strong>el mismo correo</strong> que
              diste en recepción y tu historial, tus citas y tus ejercicios se vincularán solos.
            </p>
          </div>
        </form>

        <!-- ============================= ACCESO ============================= -->
        <form id="form-login" novalidate class="space-y-3.5" autocomplete="on">
          <div>
            <label for="login-email" class="mb-1 block text-[12px] font-bold text-ink-700">Correo electrónico</label>
            <input id="login-email" name="email" type="email" inputmode="email" autocomplete="username"
                   required placeholder="tucorreo@ejemplo.com" class="field !py-3" />
          </div>

          <div>
            <label for="login-password" class="mb-1 block text-[12px] font-bold text-ink-700">Contraseña</label>
            <div class="relative">
              <input id="login-password" name="password" type="password" autocomplete="current-password"
                     required placeholder="••••••••" class="field !py-3 !pr-12" />
              <button type="button" id="ver-password" aria-label="Mostrar contraseña"
                class="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-400 active:bg-ink-100">
                ${icon('eye', 'h-4 w-4')}
              </button>
            </div>
          </div>

          <p id="login-error" role="alert" aria-live="polite"
             class="hidden items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-[12.5px] font-semibold leading-snug text-brand-800 ring-1 ring-brand-200"></p>

          <button id="btn-login" type="submit"
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[15px] font-extrabold text-white shadow-card transition active:scale-[.98] disabled:opacity-60">
            <span id="btn-login-texto">Entrar</span>
          </button>

          <button type="button" id="btn-recuperar"
            class="w-full py-1 text-center text-[12.5px] font-bold text-brand-700 active:opacity-70">
            ¿Olvidaste tu contraseña?
          </button>
        </form>

        <p class="mt-8 text-center text-[11px] leading-relaxed text-ink-400">
          Al entrar aceptas el tratamiento de tus datos clínicos<br />conforme al aviso de privacidad de la clínica.
        </p>
      </div>`;

    const onMount = (root) => {
      const form = root.querySelector('#form-login');
      const email = root.querySelector('#login-email');
      const pass = root.querySelector('#login-password');
      const error = root.querySelector('#login-error');
      const boton = root.querySelector('#btn-login');
      const botonTexto = root.querySelector('#btn-login-texto');
      const formRegistro = root.querySelector('#form-registro');

      /* --- Conmutador Entrar / Crear cuenta --- */
      const cambiarModo = (modo) => {
        formRegistro.classList.toggle('hidden', modo !== 'registro');
        form.classList.toggle('hidden', modo === 'registro');
        root.querySelectorAll('.btn-modo').forEach((b) => {
          const activo = b.dataset.modo === modo;
          b.className = `btn-modo flex-1 rounded-xl py-2.5 text-[13px] font-extrabold transition ${
            activo ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500'}`;
          b.setAttribute('aria-selected', activo ? 'true' : 'false');
        });
        (modo === 'registro' ? root.querySelector('#reg-nombre') : email).focus();
      };
      root.querySelectorAll('.btn-modo').forEach((b) =>
        b.addEventListener('click', () => cambiarModo(b.dataset.modo)));
      cambiarModo('entrar');

      /* --- Alta pública --- */
      const errorReg = root.querySelector('#registro-error');
      const botonReg = root.querySelector('#btn-registro');
      const botonRegTexto = root.querySelector('#btn-registro-texto');

      const mostrarErrorReg = (msg) => {
        errorReg.innerHTML = `${icon('alert', 'h-4 w-4 shrink-0')}<span>${E(msg)}</span>`;
        errorReg.classList.remove('hidden');
        errorReg.classList.add('flex');
      };

      formRegistro.addEventListener('input', () => {
        errorReg.classList.add('hidden');
        errorReg.classList.remove('flex');
      });

      formRegistro.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nombre = root.querySelector('#reg-nombre').value.trim();
        const correo = root.querySelector('#reg-email').value.trim();
        const p1 = root.querySelector('#reg-password').value;
        const p2 = root.querySelector('#reg-password2').value;

        if (!nombre) return mostrarErrorReg('Escribe tu nombre completo.');
        if (!correo) return mostrarErrorReg('Escribe tu correo electrónico.');
        if (p1.length < 6) return mostrarErrorReg('La contraseña debe tener al menos 6 caracteres.');
        if (p1 !== p2) return mostrarErrorReg('Las contraseñas no coinciden.');

        botonReg.disabled = true;
        botonRegTexto.textContent = 'Creando cuenta…';
        try {
          const r = await API.auth.registrar(correo, p1, nombre);
          if (r.necesitaConfirmar) {
            root.innerHTML = confirmaTuCorreo(r.email);
            return;
          }
          toast(`¡Bienvenido a ${_marca.clinica}!`);
          await App.entrar();
        } catch (err) {
          mostrarErrorReg(err.message || 'No se pudo crear la cuenta.');
        } finally {
          botonReg.disabled = false;
          botonRegTexto.textContent = 'Crear mi cuenta';
        }
      });

      const mostrarError = (msg) => {
        error.innerHTML = `${icon('alert', 'h-4 w-4 shrink-0')}<span>${E(msg)}</span>`;
        error.classList.remove('hidden');
        error.classList.add('flex');
      };
      const limpiarError = () => { error.classList.add('hidden'); error.classList.remove('flex'); };

      [email, pass].forEach((i) => i.addEventListener('input', limpiarError));

      root.querySelector('#ver-password').addEventListener('click', (e) => {
        const visible = pass.type === 'text';
        pass.type = visible ? 'password' : 'text';
        e.currentTarget.innerHTML = icon(visible ? 'eye' : 'eyeOff', 'h-4 w-4');
        e.currentTarget.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
        pass.focus();
      });

      root.querySelector('#btn-recuperar').addEventListener('click', async () => {
        if (!email.value.trim()) { mostrarError('Escribe tu correo para enviarte el enlace.'); return email.focus(); }
        try {
          await API.auth.recuperar(email.value);
          toast('Te enviamos un enlace para restablecer tu contraseña', 'success', 4000);
        } catch (err) { mostrarError(err.message || 'No se pudo enviar el enlace.'); }
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        limpiarError();
        if (!email.value.trim() || !pass.value) return mostrarError('Escribe tu correo y contraseña.');

        boton.disabled = true;
        botonTexto.textContent = 'Entrando…';
        try {
          await API.auth.entrar(email.value, pass.value);
          toast('Sesión iniciada');
          await App.entrar();
        } catch (err) {
          mostrarError(err.message || 'No se pudo iniciar sesión.');
          pass.value = '';
          pass.focus();
        } finally {
          boton.disabled = false;
          botonTexto.textContent = 'Entrar';
        }
      });

      email.focus();
    };

    return { titulo: 'Acceso', html, onMount, pantallaCompleta: true };
  }

  /** Pantalla tras registrarse cuando Supabase exige confirmar el correo. */
  const confirmaTuCorreo = (correo) => `
    <div class="flex min-h-[100dvh] flex-col justify-center px-6 py-10 anim-fade-up">
      ${marca()}
      <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white">
          ${icon('bell', 'h-7 w-7')}
        </div>
        <h2 class="mt-3 text-[17px] font-extrabold text-emerald-900">Revisa tu correo</h2>
        <p class="mt-1.5 text-[13px] leading-relaxed text-emerald-800">
          Te enviamos un enlace de confirmación a<br />
          <strong class="break-all">${E(correo)}</strong>
        </p>
        <p class="mt-3 text-[12px] leading-snug text-emerald-700">
          Ábrelo para activar tu cuenta. Si ya eras paciente de la clínica, al confirmarlo
          tu historial quedará vinculado automáticamente.
        </p>
      </div>
      <button onclick="location.reload()"
        class="mt-5 w-full rounded-2xl bg-ink-900 py-3.5 text-[14.5px] font-extrabold text-white active:scale-[.98]">
        Volver al inicio
      </button>
    </div>`;

  /* ======================================================================
     2 · CONFIGURACIÓN REQUERIDA
     Sustituye al antiguo "modo demostración": si falta configuración se dice
     exactamente qué falta y cómo arreglarlo, en vez de arrancar con datos
     falsos que luego no coinciden con la base real.
     ====================================================================== */
  const AYUDA = {
    'sin-env': {
      titulo: 'Falta el archivo de credenciales',
      pasos: [
        'Copia <code>js/env.example.js</code> a <code>js/env.js</code>.',
        'O ejecuta <code>npm run env</code> con las variables de entorno definidas.'
      ]
    },
    'sin-credenciales': {
      titulo: 'Faltan las credenciales de Supabase',
      pasos: [
        'Abre <code>js/env.js</code>.',
        'Pega <code>SUPABASE_URL</code> y <code>SUPABASE_ANON_KEY</code> desde Supabase → Project Settings → API.',
        'En Netlify, defínelas en Site configuration → Environment variables y vuelve a desplegar.'
      ]
    },
    'url-invalida': {
      titulo: 'La URL de Supabase no es válida',
      pasos: ['Debe tener la forma <code>https://xxxxxxxx.supabase.co</code>, sin barra final.']
    },
    'key-invalida': {
      titulo: 'La clave de Supabase no es válida',
      pasos: ['Copia la <code>anon public</code> key completa desde Project Settings → API.']
    },
    'key-peligrosa': {
      titulo: 'Estás usando la clave equivocada',
      pasos: [
        'La <code>service_role</code> key ignora las políticas de seguridad y <strong>nunca</strong> debe ir en el navegador.',
        'Sustitúyela por la <code>anon public</code> key.'
      ]
    },
    'sin-libreria': {
      titulo: 'Falta el cliente de Supabase',
      pasos: ['Ejecuta <code>npm install</code> en la carpeta del proyecto.']
    }
  };

  async function configuracion() {
    const fallo = global.CLIDANFI_FALLO || { codigo: 'desconocido', mensaje: 'Configuración incompleta.' };
    const ayuda = AYUDA[fallo.codigo] || { titulo: 'Configuración incompleta', pasos: [] };

    const html = `
      <div class="flex min-h-[100dvh] flex-col justify-center px-6 py-10 anim-fade-up">
        ${marca()}

        <div class="rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <p class="flex items-center gap-2 text-[13.5px] font-extrabold text-brand-800">
            ${icon('alert', 'h-4 w-4 shrink-0')} ${E(ayuda.titulo)}
          </p>
          <p class="mt-1.5 text-[12.5px] leading-snug text-brand-900">${E(fallo.mensaje)}</p>
        </div>

        ${ayuda.pasos.length ? `
          <div class="mt-4 rounded-2xl border border-ink-200 bg-white p-4">
            <p class="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Cómo resolverlo</p>
            <ol class="space-y-2.5">
              ${ayuda.pasos.map((p, i) => `
                <li class="flex gap-2.5">
                  <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-extrabold text-white">${i + 1}</span>
                  <span class="text-[12.5px] leading-snug text-ink-700">${p}</span>
                </li>`).join('')}
            </ol>
          </div>` : ''}

        <div class="mt-4 rounded-2xl bg-ink-100 p-3.5">
          <p class="text-[11.5px] leading-relaxed text-ink-600">
            La <code class="rounded bg-ink-200 px-1 font-mono text-[11px]">anon key</code> es pública por diseño:
            viaja al navegador en cualquier aplicación de Supabase. Lo que protege los datos son las
            políticas RLS del servidor, no ocultar esa clave.
          </p>
        </div>

        <button id="btn-recargar"
          class="mt-5 w-full rounded-2xl bg-ink-900 py-3.5 text-[14.5px] font-extrabold text-white active:scale-[.98]">
          Recargar
        </button>
      </div>`;

    const onMount = (root) =>
      root.querySelector('#btn-recargar').addEventListener('click', () => location.reload());

    return { titulo: 'Configuración', html, onMount, pantallaCompleta: true };
  }

  global.VistaAuth = { login, configuracion, marca };
})(window);
