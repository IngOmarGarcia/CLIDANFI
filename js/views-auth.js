/* ==========================================================================
   CLIDANFI · views-auth.js  ·  PANTALLA DE ACCESO
   Puerta de entrada obligatoria. Sin sesión válida no se renderiza ninguna
   otra vista (el guardia está en app.js).
   ========================================================================== */
(function (global) {
  'use strict';

  const { escapeHtml: E, icon, toast } = UI;

  /** ¿Estamos contra Supabase o en modo demostración con datos locales? */
  const esDemo = () => API._impl !== 'supabase';

  async function login() {
    const demo = esDemo();
    const cuentas = demo ? (Store.USUARIOS_DEMO || []) : [];

    const html = `
      <div class="flex min-h-[100dvh] flex-col justify-center px-6 py-10 anim-fade-up">

        <!-- Marca -->
        <div class="mb-8 flex flex-col items-center text-center">
          <!-- ▼ ESPACIO RESERVADO PARA EL LOGO DE LA CLÍNICA ▼ -->
          <img
            src="./assets/logo-clidanfi.svg"
            alt="Logo de CLIDANFI, clínica de fisioterapia"
            width="80" height="80"
            class="h-20 w-20 rounded-2xl object-contain"
            onerror="this.classList.add('logo-fallback'); this.removeAttribute('src');"
          />
          <!-- ▲ FIN ESPACIO RESERVADO PARA EL LOGO ▲ -->
          <h1 class="mt-4 text-[26px] font-extrabold tracking-tight text-ink-900">CLIDANFI</h1>
          <p class="mt-1 text-[13px] font-medium text-ink-500">Fisioterapia y rehabilitación</p>
        </div>

        <!-- Formulario -->
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
             class="hidden items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[12.5px] font-semibold leading-snug text-rose-700 ring-1 ring-rose-200"></p>

          <button id="btn-login" type="submit"
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[15px] font-extrabold text-white shadow-card transition active:scale-[.98] disabled:opacity-60">
            <span id="btn-login-texto">Entrar</span>
          </button>
        </form>

        ${demo ? `
          <!-- Aviso y accesos del modo demostración -->
          <div class="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p class="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-700">
              ${icon('alert', 'h-3.5 w-3.5')} Modo demostración
            </p>
            <p class="mt-1 text-[12px] font-medium leading-snug text-amber-900">
              Supabase no está configurado, así que los datos viven solo en este navegador.
              Usa una de estas cuentas de prueba:
            </p>
            <div class="mt-3 space-y-2">
              ${cuentas.map((u) => `
                <button type="button" data-cuenta="${E(u.email)}" data-pass="${E(u.password)}"
                  class="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-white p-2.5 text-left active:scale-[.99]">
                  <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg ${u.rol === 'fisio' ? 'bg-brand-100 text-brand-700' : 'bg-violet-100 text-violet-700'}">
                    ${icon(u.rol === 'fisio' ? 'stethoscope' : 'user', 'h-4 w-4')}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[12.5px] font-bold text-ink-800">${E(u.rol === 'fisio' ? 'Fisioterapeuta' : 'Paciente')}</span>
                    <span class="block truncate font-mono text-[11px] text-ink-500">${E(u.email)} · ${E(u.password)}</span>
                  </span>
                  <span class="shrink-0 text-[11px] font-extrabold text-amber-700">Usar</span>
                </button>`).join('')}
            </div>
          </div>` : ''}

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

      const mostrarError = (msg) => {
        error.innerHTML = `${icon('alert', 'h-4 w-4 shrink-0')}<span>${E(msg)}</span>`;
        error.classList.remove('hidden');
        error.classList.add('flex');
      };
      const limpiarError = () => { error.classList.add('hidden'); error.classList.remove('flex'); };

      [email, pass].forEach((i) => i.addEventListener('input', limpiarError));

      // Mostrar / ocultar contraseña
      root.querySelector('#ver-password').addEventListener('click', (e) => {
        const visible = pass.type === 'text';
        pass.type = visible ? 'password' : 'text';
        e.currentTarget.innerHTML = icon(visible ? 'eye' : 'eyeOff', 'h-4 w-4');
        e.currentTarget.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
        pass.focus();
      });

      // Rellenar con una cuenta de demostración
      root.querySelectorAll('[data-cuenta]').forEach((b) => b.addEventListener('click', () => {
        email.value = b.dataset.cuenta;
        pass.value = b.dataset.pass;
        limpiarError();
        form.requestSubmit();
      }));

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        limpiarError();

        if (!email.value.trim() || !pass.value) return mostrarError('Escribe tu correo y contraseña.');

        boton.disabled = true;
        botonTexto.textContent = 'Entrando…';
        try {
          await API.auth.entrar(email.value, pass.value);
          toast('Sesión iniciada');
          await App.entrar();               // el router decide el destino según el rol
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

  global.VistaAuth = { login, esDemo };
})(window);
