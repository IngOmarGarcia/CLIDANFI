# CLIDANFI responsiva · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que CLIDANFI se comporte como aplicación de escritorio en PC (barra lateral, contenido a ancho completo, rejillas, dos paneles en Pacientes) sin alterar en nada la interfaz en móvil.

**Architecture:** El ancho está restringido en solo cinco sitios. Se introduce un estado de shell (`<body class="con-sesion">`) que en `≥900 px` desactiva el marco de dispositivo y en `≥1024 px` añade barra lateral. El contenido se envuelve una sola vez en `.view-container` desde `render()`, de modo que las 16 raíces de vista heredan el ancho sin editarlas. Solo las vistas que necesitan rejilla se tocan una a una.

**Tech Stack:** HTML + Tailwind 3.4 compilado (sin CDN), JavaScript de navegador en IIFE globales (sin módulos, sin build de JS), CSS complementario en `css/styles.css`. Pruebas con `node --test` y con el arnés `vm` de `scripts/`.

## Global Constraints

- **En móvil no cambia nada.** A 390 px la interfaz debe quedar idéntica a antes del cambio. Cualquier diferencia visible es un fallo, no un efecto secundario aceptable.
- **`#view-root` no puede volverse contenedor de scroll en móvil**, o las cabeceras `sticky` de las vistas dejan de pegarse (README §288).
- **`.app-frame` lleva `transform: translateZ(0)` a propósito**: convierte el marco en bloque contenedor de sus descendientes `position: fixed`. Al retirarlo en escritorio, nav / sheets / FAB / avisos pasan a anclarse a la ventana. Es el cambio de comportamiento más probable como causa de fallos.
- **Sin dependencias nuevas.** No hay jsdom ni runner de navegador y no se añaden.
- **`npm run build` debe seguir en verde** tras cada tarea.
- Puntos de corte exactos: `768` (`md:`), `900` (media query propia), `1024` (`lg:`), `1536` (`2xl:`). Tope de contenido `1600px`.
- Idioma del código y los comentarios: español, como el resto del repositorio.

---

# ETAPA 1 · Shell

Al terminar la etapa, en PC se ve la barra lateral y el contenido a ancho completo, todavía en una sola columna.

### Task 1: Función pura de navegación

Hoy `pintarNav()` construye el HTML de la nav inferior en línea. Se extrae a una función pura para poder (a) probarla y (b) reutilizarla para la barra lateral, que es la misma lista con otra presentación.

**Files:**
- Modify: `js/app.js:244-260` (`pintarNav`)
- Test: `scripts/test-navegacion.js` (crear)
- Modify: `package.json` (añadir `test:navegacion` y encadenarlo en `test`)

**Interfaces:**
- Produces: `navHTML(items, actual, variante)` → `string`
  - `items`: `Array<{href: string, icono: string, label: string}>`
  - `actual`: `string` — el href activo, por ejemplo `'#/t/agenda'`
  - `variante`: `'inferior' | 'lateral'`
  - Se expone en `window.AppNav = { navHTML }` para que el test lo alcance con `vm`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `scripts/test-navegacion.js`:

```js
#!/usr/bin/env node
/* ==========================================================================
   CLIDANFI · test-navegacion.js
   La lista de secciones se pinta en dos sitios (barra inferior en móvil y
   barra lateral en escritorio) a partir de la MISMA función. Si se separan,
   una sección nueva aparecería en un sitio y no en el otro sin que nada
   fallara. Estas pruebas atan las dos presentaciones a la misma fuente.

   Uso:  npm run test:navegacion
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const APP_JS = process.argv[2] ? path.resolve(process.argv[2]) : path.join(RAIZ, 'js', 'app.js');

let pasan = 0, fallan = 0;
const check = (cond, msg, extra = '') => {
  if (cond) { pasan++; console.log(`  ✓ ${msg}`); }
  else { fallan++; console.log(`  ✗ ${msg}${extra ? `\n      → ${extra}` : ''}`); }
};

/* app.js es un IIFE que espera un navegador. Se le da el mínimo para que
   evalúe sin tocar el DOM: lo único que se extrae es AppNav. */
function cargarAppNav() {
  const ctx = {
    console,
    window: {},
    document: {
      getElementById: () => null,
      addEventListener: () => {},
      querySelector: () => null
    },
    location: { hash: '' },
    setTimeout, clearTimeout
  };
  ctx.window.document = ctx.document;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(APP_JS, 'utf8'), ctx, { filename: 'app.js' });
  return ctx.window.AppNav;
}

const ITEMS = [
  { href: '#/t/dashboard', icono: 'home',     label: 'Inicio' },
  { href: '#/t/agenda',    icono: 'calendar', label: 'Agenda' },
  { href: '#/t/pacientes', icono: 'users',    label: 'Pacientes' }
];

const AppNav = cargarAppNav();

console.log('\n1 · Las dos presentaciones salen de la misma lista');
const inferior = AppNav.navHTML(ITEMS, '#/t/agenda', 'inferior');
const lateral  = AppNav.navHTML(ITEMS, '#/t/agenda', 'lateral');

for (const it of ITEMS) {
  check(inferior.includes(it.href), `la barra inferior incluye ${it.href}`);
  check(lateral.includes(it.href),  `la barra lateral incluye ${it.href}`);
}

console.log('\n2 · La sección activa se marca en las dos');
check((inferior.match(/aria-current="page"/g) || []).length === 1,
  'la barra inferior marca exactamente una activa');
check((lateral.match(/aria-current="page"/g) || []).length === 1,
  'la barra lateral marca exactamente una activa');

console.log('\n3 · La etiqueta de texto viaja en las dos variantes');
// En la lateral el texto va siempre visible; en la inferior, debajo del icono.
check(inferior.includes('Agenda'), 'la barra inferior escribe la etiqueta');
check(lateral.includes('Agenda'),  'la barra lateral escribe la etiqueta');

console.log('\n4 · Una ruta que no está en la lista no marca nada');
const ninguna = AppNav.navHTML(ITEMS, '#/t/paciente/abc', 'lateral');
check(!ninguna.includes('aria-current="page"'),
  'en una ruta profunda no se marca ninguna sección');

console.log('\n5 · El texto de las etiquetas va escapado');
const peligroso = [{ href: '#/x', icono: 'home', label: '<img src=x onerror=1>' }];
check(!AppNav.navHTML(peligroso, '#/x', 'lateral').includes('<img'),
  'una etiqueta con HTML no se inyecta');

console.log('\n' + '─'.repeat(60));
console.log(`${pasan} pasan · ${fallan} fallan`);
process.exit(fallan ? 1 : 0);
```

- [ ] **Step 2: Ejecutarla y comprobar que falla**

```bash
node scripts/test-navegacion.js
```

Esperado: FALLA con `TypeError: Cannot read properties of undefined (reading 'navHTML')`, porque `window.AppNav` todavía no existe.

- [ ] **Step 3: Extraer `navHTML` en `js/app.js`**

Sustituir el cuerpo de `pintarNav()` (líneas 244-260) por esto, dejando la función pura por encima:

```js
  /**
   * HTML de la lista de secciones. Una sola fuente para las dos
   * presentaciones: barra inferior en móvil, barra lateral en escritorio.
   * Es pura a propósito —no toca el DOM— para poder probarla sin navegador.
   */
  function navHTML(items, actual, variante) {
    if (variante === 'lateral') {
      return `
        <nav class="flex flex-col gap-1 p-3" aria-label="Navegación principal">
          ${items.map((it) => {
            const on = actual === it.href;
            return `
              <a href="${it.href}" ${on ? 'aria-current="page"' : ''}
                class="nav-side flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-bold transition">
                <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg">${icon(it.icono, 'h-5 w-5')}</span>
                <span class="truncate">${E(it.label)}</span>
              </a>`;
          }).join('')}
        </nav>`;
    }

    return `
      <div class="nav-safe flex items-stretch justify-around px-2 pt-2">
        ${items.map((it) => {
          const on = actual === it.href;
          return `
            <a href="${it.href}" class="nav-item flex flex-1 flex-col items-center gap-1 py-1" ${on ? 'aria-current="page"' : ''}>
              <span class="nav-icon-wrap grid h-7 w-14 place-items-center rounded-full transition">${icon(it.icono, 'h-5 w-5')}</span>
              <span class="text-[10px] font-bold leading-none">${E(it.label)}</span>
            </a>`;
        }).join('')}
      </div>`;
  }

  function pintarNav() {
    const actual = '#' + estado.ruta.path;
    const items = NAV[rol()];
    document.getElementById('bottom-nav').innerHTML = navHTML(items, actual, 'inferior');
    const lado = document.getElementById('side-nav');
    if (lado) lado.innerHTML = navHTML(items, actual, 'lateral');
  }
```

Y al final del IIFE, donde ya se exponen otros globales, añadir:

```js
  // Se expone solo para que scripts/test-navegacion.js pueda probarlo sin
  // navegador. La aplicación usa navHTML() directamente, no por aquí.
  global.AppNav = { navHTML };
```

> Nota: `icon()` y `E()` ya existen en el ámbito del IIFE de `app.js`. Si el
> test falla porque no están definidos en el contexto `vm`, añádelos al stub
> del contexto como funciones que devuelvan cadena vacía — la prueba comprueba
> `href`, `aria-current` y escapado, no los iconos.

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```bash
node scripts/test-navegacion.js
```

Esperado: PASA, `0 fallan`.

- [ ] **Step 5: Encadenar en `package.json`**

En `scripts`, añadir `"test:navegacion": "node scripts/test-navegacion.js"` y sumarlo a la cadena de `test`, delante de `test:worker`:

```
"test": "npm run check && npm run test:esquema && npm run test:subidas && npm run test:funciones && npm run test:navegacion && npm run test:worker",
```

- [ ] **Step 6: Verificar la suite completa y commit**

```bash
npm test
git add js/app.js scripts/test-navegacion.js package.json
git commit -m "refactor: una sola fuente para la navegacion inferior y lateral"
```

---

### Task 2: Estado de shell y el hueco de la barra lateral

**Files:**
- Modify: `index.html:26-95` (marca de agua, `.app-shell`, `.app-frame`, nuevo `#side-nav`)
- Modify: `js/app.js` (`mostrarChrome`)

**Interfaces:**
- Consumes: `navHTML(...)` de la Task 1, y `#side-nav` que se crea aquí.
- Produces: la clase `con-sesion` en `<body>`, de la que dependen todas las reglas CSS de la Task 3.

- [ ] **Step 1: Añadir el contenedor de la barra lateral en `index.html`**

Envolver el marco. Sustituir la apertura de `.app-shell` y `.app-frame` por:

```html
  <div class="app-shell">

    <!-- Barra lateral · solo visible con sesión y en pantallas grandes.
         Vive FUERA de .app-frame a propósito: dentro quedaría atrapada por
         el `transform` del marco y no podría ocupar el alto de la ventana. -->
    <aside id="side-nav" class="side-nav" aria-label="Secciones"></aside>

    <div class="app-frame mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-cream-100">
```

Cerrar el `aside` no hace falta: se rellena desde `pintarNav()`.

- [ ] **Step 2: Marcar el estado de sesión desde `mostrarChrome`**

En `js/app.js`, dentro de `mostrarChrome`, añadir como primera línea del cuerpo:

```js
    // Estado del shell. `con-sesion` es de lo que cuelga todo el layout de
    // escritorio: sin ella, la pantalla de acceso conserva el marco oscuro.
    document.body.classList.toggle('con-sesion', visible);
```

- [ ] **Step 3: Comprobar a mano que la clase aparece y desaparece**

```bash
npm run build && npm run serve
```

Abrir `http://localhost:8080`, y en la consola del navegador:

```js
document.body.className        // sin sesión: NO contiene "con-sesion"
```

Iniciar sesión y repetir: ahora **sí** debe contener `con-sesion`. Cerrar sesión: vuelve a desaparecer.

- [ ] **Step 4: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: estado de shell con-sesion y hueco de barra lateral"
```

---

### Task 3: El CSS de escritorio

Es el corazón de la etapa. Todo cuelga de `body.con-sesion`.

**Files:**
- Modify: `css/styles.css:88-150` (bloque de escritorio)

- [ ] **Step 1: Acotar el marco actual a «sin sesión»**

En `css/styles.css`, dentro de `@media (min-width: 900px)`, cambiar los selectores para que **solo apliquen sin sesión**. El bloque existente pasa de `.app-watermark { … }` / `.app-shell { … }` / `.app-frame { … }` a:

```css
@media (min-width: 900px) {
  /* --- SIN SESIÓN · el marco de dispositivo, tal cual estaba ------------- */
  body:not(.con-sesion) .app-watermark { display: block; }

  body:not(.con-sesion) .app-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    padding: 28px 16px;
  }

  body:not(.con-sesion) .app-frame {
    transform: translateZ(0);
    position: relative;
    height: min(var(--frame-max-h), calc(100dvh - 56px));
    min-height: 0 !important;
    overflow: hidden;
    border-radius: 30px;
    border: 1px solid rgba(255, 255, 255, .09);
    box-shadow:
      0 2px 4px rgba(0, 0, 0, .3),
      0 30px 70px -20px rgba(0, 0, 0, .75),
      0 0 0 1px rgba(0, 0, 0, .4);
  }

  body:not(.con-sesion) .app-frame::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 30px;
    pointer-events: none;
    z-index: 60;
    background: linear-gradient(180deg, rgba(255, 255, 255, .10), transparent 22%);
  }

  body:not(.con-sesion) #view-root {
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--ink-300, #d0c8b9) transparent;
  }
  body:not(.con-sesion) #view-root::-webkit-scrollbar { width: 8px; }
  body:not(.con-sesion) #view-root::-webkit-scrollbar-thumb {
    background: var(--ink-200);
    border-radius: 99px;
    border: 2px solid transparent;
    background-clip: content-box;
  }

  body:not(.con-sesion) .app-frame .nav-safe { padding-bottom: .5rem; }
  body:not(.con-sesion) #app-header > div:first-child { padding-top: .75rem; }
```

Igual con el bloque de pantallas bajas más abajo: `body:not(.con-sesion) .app-shell` y `body:not(.con-sesion) .app-frame`.

- [ ] **Step 2: Añadir el layout con sesión, en el mismo `@media (min-width: 900px)`**

```css
  /* --- CON SESIÓN · aplicación a ancho completo -------------------------- */
  /* El fondo oscuro y la marca de agua son del acceso; aquí estorban. */
  body.con-sesion { background: var(--cream-100); }
  body.con-sesion.app-bg { background: var(--cream-100); }
  body.con-sesion .app-bg::after { display: none; }
  body.con-sesion .app-watermark { display: none; }

  /* Sin `transform` ni `overflow` en el marco: los descendientes
     `position: fixed` vuelven a anclarse a la ventana, que es lo que
     queremos en escritorio. Ver el aviso del plan sobre este punto. */
  body.con-sesion .app-frame {
    max-width: none;
    transform: none;
    height: auto;
    overflow: visible;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  body.con-sesion .app-frame::before { display: none; }
}

/* --- ≥1024 px · barra lateral ------------------------------------------- */
.side-nav { display: none; }

@media (min-width: 1024px) {
  body.con-sesion .app-shell {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    min-height: 100dvh;
  }

  body.con-sesion .side-nav {
    display: block;
    position: sticky;
    top: 0;
    align-self: start;
    height: 100dvh;
    border-right: 1px solid var(--ink-200);
    background: #fff;
  }

  /* La barra inferior sobra: sus secciones están ya en el lateral. */
  body.con-sesion #bottom-nav { display: none !important; }
  /* …y con ella sobra el hueco que se le reservaba. */
  body.con-sesion #view-root.pb-28 { padding-bottom: 1.5rem; }
}

/* Estados de la barra lateral */
.nav-side { color: var(--ink-500); }
.nav-side:hover { background: var(--ink-100); color: var(--ink-900); }
.nav-side[aria-current="page"] { background: var(--brand-100); color: var(--brand-700); }
```

- [ ] **Step 3: Verificar a los cuatro anchos**

```bash
npm run build && npm run serve
```

Con las herramientas de desarrollo del navegador (Ctrl+Shift+M), comprobar **con sesión iniciada**:

| Ancho | Qué debe verse |
|---|---|
| 390 px | Idéntico a antes: nav inferior, sin lateral, sin cambios |
| 768 px | Igual que 390 pero más ancho; nav inferior aún |
| 1280 px | Barra lateral a la izquierda, contenido ancho, sin fondo oscuro |
| 1920 px | Igual que 1280, contenido aún más ancho |

Y **sin sesión** a 1280 px: el marco de dispositivo sobre fondo oscuro, **exactamente como antes**.

- [ ] **Step 4: Commit**

```bash
npm test
git add css/styles.css
git commit -m "feat: layout de escritorio a ancho completo con barra lateral"
```

---

### Task 4: El contenedor único de contenido

Sin esto las vistas se estiran hasta 1920 px y las líneas de texto se vuelven ilegibles.

**Files:**
- Modify: `js/app.js` (`render`, la línea `root.innerHTML = resultado.html`)
- Modify: `css/styles.css`

- [ ] **Step 1: Envolver el contenido en `render()`**

En `js/app.js`, sustituir:

```js
      root.innerHTML = resultado.html;
```

por:

```js
      // Un solo envoltorio para las 16 raíces de vista: el ancho de
      // escritorio se resuelve aquí y no repitiendo clases en cada vista.
      // Debe ser un div liso —sin `overflow`— o en móvil convertiría a
      // #view-root en contenedor de scroll y las cabeceras `sticky` de las
      // vistas dejarían de pegarse.
      root.innerHTML = `<div class="view-container">${resultado.html}</div>`;
```

> Cuidado: `resultado.onMount(root)` sigue recibiendo `root`, no el envoltorio.
> Como `querySelector` busca en profundidad, los `onMount` existentes siguen
> funcionando sin tocarlos.

- [ ] **Step 2: Definir `.view-container` en `css/styles.css`**

Al final del bloque de escritorio:

```css
/* ==========================================================================
   Contenedor de contenido
   En móvil es transparente: no aporta ancho ni márgenes, para que las vistas
   queden exactamente como estaban. A partir de 900 px pone el tope de ancho.
   ========================================================================== */
.view-container { width: 100%; }

@media (min-width: 900px) {
  body.con-sesion .view-container {
    max-width: 1600px;
    margin-inline: auto;
    padding-inline: 1rem;
  }
}
```

- [ ] **Step 3: Comprobar que móvil no se movió**

A 390 px, con sesión: la interfaz debe quedar **igual que antes**. Si aparece un margen nuevo, `.view-container` está aplicando `padding-inline` por debajo de 900 px — revisar la media query.

A 1920 px: el contenido deja de tocar los bordes y queda centrado con tope de 1600 px.

- [ ] **Step 4: Commit**

```bash
npm test
git add js/app.js css/styles.css
git commit -m "feat: contenedor unico de contenido con tope de ancho"
```

---

### Task 5: Sheets, botón flotante y avisos

Las tres piezas que dependían del `transform` del marco.

**Files:**
- Modify: `js/ui.js:393` (envoltorio del sheet)
- Modify: `js/views-therapist.js:29` (FAB) y `:70` (barra de acciones)
- Modify: `index.html:83` (`#bottom-nav`), `index.html:89` (`#toast-root`)
- Modify: `css/styles.css`

- [ ] **Step 1: El sheet pasa a diálogo centrado en `lg:`**

En `js/ui.js`, sustituir la línea 393:

```js
      <div class="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[480px]">
```

por:

```js
      <div class="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[480px] lg:inset-y-0 lg:flex lg:max-w-2xl lg:items-center">
```

Y en la línea siguiente, la `<section>`: añadir las clases de escritorio para que deje de ser una hoja pegada abajo:

```js
          class="anim-sheet flex ${heights[size] || heights.auto} flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-lift lg:max-h-[85dvh] lg:w-full lg:rounded-[1.5rem]">
```

El asa de arrastre (`<div class="mx-auto mb-2.5 h-1.5 w-10 rounded-full bg-ink-200"></div>`) no tiene sentido en un diálogo: añadirle `lg:hidden`.

- [ ] **Step 2: El botón flotante y la barra de acciones se ensanchan**

En `js/views-therapist.js:29`, cambiar `max-w-[480px]` por `max-w-[480px] lg:max-w-[1600px] lg:pr-8`.

En `js/views-therapist.js:70`, cambiar `max-w-[480px]` por `max-w-[480px] lg:max-w-[1600px]`.

- [ ] **Step 3: La nav inferior y los avisos**

En `index.html:83`, `#bottom-nav` conserva su `max-w-[480px]`: en `lg:` queda oculta por CSS (Task 3), así que no hay nada que ensanchar.

En `index.html:89`, `#toast-root` pasa de centrado a esquina superior derecha en escritorio:

```html
      <div id="toast-root" class="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4 lg:inset-x-auto lg:right-4 lg:items-end"></div>
```

- [ ] **Step 4: Probar las tres piezas a 1280 px, con sesión**

- Abrir cualquier sheet (por ejemplo «Nuevo paciente»): debe salir **centrado en la ventana**, no pegado abajo ni recortado a 480 px.
- El botón flotante debe quedar en la esquina inferior derecha **del contenido**, no del centro de la pantalla.
- Provocar un aviso (guardar algo): debe aparecer arriba a la derecha.

Y a 390 px: sheet pegado abajo con su asa, FAB abajo a la derecha, aviso arriba centrado. **Como antes.**

- [ ] **Step 5: Commit**

```bash
npm test
git add js/ui.js js/views-therapist.js index.html
git commit -m "feat: sheets, boton flotante y avisos adaptados a escritorio"
```

---

# ETAPA 2 · Rejillas

Todo se ve ancho; ahora se reparte en columnas.

### Task 6: Blindar el buscador de Pacientes antes de tocar clases

**Trampa real:** `pacientes().onMount` localiza su contenedor con `root.querySelector('.space-y-2.px-4.pb-4')` (`js/views-therapist.js:667`). En cuanto se cambien esas clases por las de la rejilla, **el buscador en vivo dejará de repintar resultados sin lanzar ningún error**. Se arregla antes de tocar nada.

**Files:**
- Modify: `js/views-therapist.js:645` y `:667-676`

- [ ] **Step 1: Dar un ancla estable al contenedor**

En la línea 645, cambiar:

```js
        <div class="space-y-2 px-4 pb-4">
```

por:

```js
        <div id="lista-pacientes" class="space-y-2 px-4 pb-4">
```

- [ ] **Step 2: Usar el ancla en `onMount`**

Sustituir:

```js
          const cont = root.querySelector('.space-y-2.px-4.pb-4');
```

por:

```js
          // Por id, no por clases: las clases cambian con el layout
          // responsivo y un selector de clases se rompería en silencio.
          const cont = root.querySelector('#lista-pacientes');
```

Y en la misma función, `root.querySelector('p.mt-2')` tiene el mismo problema. Darle también un id: en la línea 641 cambiar `<p class="mt-2 …">` por `<p id="meta-pacientes" class="mt-2 …">` y usar `root.querySelector('#meta-pacientes')`.

- [ ] **Step 3: Comprobar que el buscador sigue vivo**

A 390 px, en Pacientes: escribir en el buscador y confirmar que la lista se filtra y que el contador («N pacientes») se actualiza.

- [ ] **Step 4: Commit**

```bash
npm test
git add js/views-therapist.js
git commit -m "fix: anclar el buscador de pacientes por id y no por clases"
```

---

### Task 7: Dashboard en rejilla

**Files:**
- Modify: `js/views-therapist.js:442` (raíz de la vista)

- [ ] **Step 1: Convertir la pila en rejilla**

Cambiar la raíz:

```js
      <div class="space-y-4 px-4 pt-4 anim-fade-up">
```

por:

```js
      <div class="space-y-4 px-4 pt-4 anim-fade-up md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0 xl:grid-cols-3">
```

> `md:space-y-0` es imprescindible: sin él, `space-y-4` sigue metiendo margen
> superior a los hijos y la rejilla queda desalineada.

La gráfica de ingresos debe ocupar la fila entera. Localizar su tarjeta contenedora y añadirle `md:col-span-2 xl:col-span-3`. El aviso de «Base de datos desactualizada» y el de solicitudes nuevas también: son avisos de ancho completo, misma clase.

- [ ] **Step 2: Verificar a los cuatro anchos**

390 px: una columna, idéntico a antes. 768 px: dos columnas. 1280 px: tres columnas. La gráfica y los avisos siempre a lo ancho.

- [ ] **Step 3: Commit**

```bash
npm test
git add js/views-therapist.js
git commit -m "feat: dashboard en rejilla en pantallas grandes"
```

---

### Task 8: Agenda como tabla en escritorio

Se mantienen las tarjetas en móvil y se añade una tabla para `lg:`. Dos presentaciones del mismo dato: la tarjeta se oculta en `lg:` y la fila de tabla se oculta por debajo.

**Files:**
- Modify: `js/views-therapist.js:582` (raíz) y la función que pinta cada cita

- [ ] **Step 1: Añadir la tabla junto a las tarjetas**

En la vista `agenda()`, envolver la lista actual de tarjetas en `<div class="lg:hidden">…</div>` y añadir a continuación:

```js
        <div class="hidden lg:block">
          <table class="w-full border-collapse text-[13px]">
            <thead>
              <tr class="border-b border-ink-200 text-left text-[11px] uppercase tracking-wide text-ink-500">
                <th class="py-2 pr-3 font-bold">Hora</th>
                <th class="py-2 pr-3 font-bold">Paciente</th>
                <th class="py-2 pr-3 font-bold">Servicio</th>
                <th class="py-2 pr-3 font-bold">Estado</th>
                <th class="py-2 font-bold"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              ${list.map(citaFila).join('')}
            </tbody>
          </table>
        </div>
```

Y escribir `citaFila(c)` junto a la función que ya pinta la tarjeta, reutilizando **sus mismos** `data-action` para que los manejadores de eventos existentes sigan sirviendo sin tocarlos:

```js
  /* Misma cita que la tarjeta de móvil, en fila de tabla. Los `data-action`
     son idénticos a propósito: el delegador de eventos no distingue, así que
     no hay que duplicar ninguna lógica. */
  const citaFila = (c) => `
    <tr class="border-b border-ink-100 hover:bg-ink-50">
      <td class="py-2.5 pr-3 font-bold tabular-nums">${E(horaDe(c))}</td>
      <td class="py-2.5 pr-3">${E(c.pacientes ? c.pacientes.nombre : '—')}</td>
      <td class="py-2.5 pr-3 text-ink-500">${E(c.servicio || '—')}</td>
      <td class="py-2.5 pr-3">${chipEstado(c.estado)}</td>
      <td class="py-2.5 text-right">
        <button data-action="abrir-cita" data-id="${E(c.id)}"
          class="rounded-lg px-2.5 py-1.5 text-[12px] font-bold text-brand-700 hover:bg-brand-50">Abrir</button>
      </td>
    </tr>`;
```

> Antes de escribirla, **leer la tarjeta existente** y copiar de ella los
> nombres reales de `horaDe`, `chipEstado`, `c.servicio` y el `data-action`
> que abre la cita. Los de arriba son los nombres esperados; si en el código
> se llaman de otra forma, mandan los del código.

- [ ] **Step 2: Verificar**

390 px y 768 px: tarjetas, sin rastro de tabla. 1280 px: tabla, sin tarjetas. Y **pulsar «Abrir» en la tabla debe hacer exactamente lo mismo** que tocar la tarjeta en móvil.

- [ ] **Step 3: Commit**

```bash
npm test
git add js/views-therapist.js
git commit -m "feat: agenda como tabla en escritorio"
```

---

### Task 9: Ficha, valoración, rutinas y sorteos

**Files:**
- Modify: `js/views-therapist.js:773` (ficha), `:1319` (valoración), `:1565` (rutinas), `:1798` (sorteos)

- [ ] **Step 1: Ficha del paciente a dos columnas**

Línea 773, cambiar `class="mt-3 space-y-4 px-4 pb-6"` por:

```
class="mt-3 space-y-4 px-4 pb-6 xl:grid xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start xl:gap-5 xl:space-y-0"
```

La tarjeta de resumen (sesiones, pagos) es el primer hijo y cae sola en la columna izquierda. El bloque de pestañas debe llevar `xl:sticky xl:top-4` **no**: es el resumen el que se queda fijo. Añadir `xl:sticky xl:top-4` a la tarjeta de resumen.

- [ ] **Step 2: Valoración a dos columnas**

Línea 1319, añadir a la raíz `lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0`.

Las tablas de goniometría y fuerza (`.tbl`) deben seguir a ancho completo: a sus contenedores, `lg:col-span-2`.

- [ ] **Step 3: Catálogo de rutinas en rejilla**

Línea 1565, añadir a la raíz `sm:grid sm:grid-cols-2 sm:items-start sm:gap-3 sm:space-y-0 lg:grid-cols-3 xl:grid-cols-4`.

- [ ] **Step 4: Sorteos a dos columnas**

Línea 1798, añadir a la raíz `lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0`.

- [ ] **Step 5: Verificar las cuatro vistas a 390 / 1280 px**

A 390 px las cuatro deben quedar **exactamente como antes**. A 1280 px, repartidas.

Atención a la valoración: es la vista con formulario y aviso de «cambios sin guardar». Comprobar que sigue avisando al salir con cambios pendientes.

- [ ] **Step 6: Commit**

```bash
npm test
git add js/views-therapist.js
git commit -m "feat: ficha, valoracion, rutinas y sorteos en varias columnas"
```

---

### Task 10: Las cuatro vistas del paciente

**Files:**
- Modify: `js/views-patient.js` (sus 6 raíces con `anim-fade-up`)

- [ ] **Step 1: Localizar las raíces**

```bash
grep -n "anim-fade-up" js/views-patient.js
```

- [ ] **Step 2: Añadir rejilla a cada raíz de vista**

A cada raíz de las vistas de nivel superior (Inicio, Mi rutina, Promos, Sorteos), añadir:

```
md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0 xl:grid-cols-3
```

Los encabezados de bienvenida y cualquier tarjeta destacada llevan `md:col-span-2 xl:col-span-3`.

> Las vistas de paciente **no** llevan dos paneles: está fuera de alcance por diseño.

- [ ] **Step 3: Verificar entrando con la cuenta de paciente**

`paciente@clidanfi.mx`. A 390 px, sin cambios; a 1280 px, repartido.

- [ ] **Step 4: Commit**

```bash
npm test
git add js/views-patient.js
git commit -m "feat: vistas del paciente en rejilla en pantallas grandes"
```

---

# ETAPA 3 · Dos paneles en Pacientes

### Task 11: Lista y ficha en la misma pantalla

Sin tocar el enrutador: las rutas siguen siendo `#/t/pacientes` y `#/t/paciente/:id`. Lo único que cambia es qué pinta cada vista cuando hay sitio.

**Files:**
- Modify: `js/views-therapist.js:624` (`pacientes()`) y `:683` (`paciente()`)

**Interfaces:**
- Produces: `panelLista(list, seleccionadoId)` → `string`, el panel izquierdo reutilizado por las dos vistas.

- [ ] **Step 1: Extraer el panel de lista**

Sacar de `pacientes()` el buscador y la lista a una función que las dos vistas puedan usar:

```js
  /**
   * Panel izquierdo de la vista de dos columnas. Es el mismo buscador y la
   * misma lista que se ven a pantalla completa en móvil; lo único que cambia
   * es que aquí se marca cuál está abierto.
   */
  function panelLista(list, seleccionadoId = '') {
    return `
      <div class="hidden lg:flex lg:h-[calc(100dvh-8rem)] lg:flex-col lg:overflow-hidden lg:rounded-2xl lg:border lg:border-ink-200 lg:bg-white">
        <div class="shrink-0 border-b border-ink-100 p-3">
          <input id="buscador-pacientes-panel" type="search" autocomplete="off"
            value="${E(_busqueda)}" placeholder="Buscar paciente"
            class="field !py-2.5 !rounded-xl" />
        </div>
        <div id="lista-pacientes-panel" class="min-h-0 flex-1 overflow-y-auto p-2">
          ${list.map((p) => `
            <a href="#/t/paciente/${E(p.id)}"
              class="block rounded-xl px-3 py-2.5 text-[13px] font-bold ${p.id === seleccionadoId ? 'bg-brand-100 text-brand-700' : 'text-ink-700 hover:bg-ink-100'}">
              ${E(p.nombre)}
            </a>`).join('')}
        </div>
      </div>`;
  }
```

- [ ] **Step 2: `pacientes()` muestra el panel más un vacío a la derecha**

En `lg:`, la vista de lista pasa a dos columnas con un mensaje a la derecha. Envolver su HTML actual:

```js
      <div class="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-4 lg:px-4 lg:pt-4">
        ${panelLista(list)}
        <div class="lg:hidden">${/* la lista a pantalla completa de móvil, tal cual */''}</div>
        <div class="hidden lg:grid lg:h-[calc(100dvh-8rem)] lg:place-items-center lg:rounded-2xl lg:border lg:border-dashed lg:border-ink-300">
          <p class="text-[13px] font-semibold text-ink-400">Elige un paciente de la lista</p>
        </div>
      </div>
```

> El bloque `lg:hidden` contiene el HTML de lista que ya existía. No se
> reescribe: se mueve dentro del envoltorio tal cual.

- [ ] **Step 3: `paciente()` antepone el panel**

En `paciente()`, cargar también la lista y envolver:

```js
    const list = await API.listarPacientes({ q: _busqueda });
```

y la raíz de su HTML pasa a:

```js
      <div class="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-4 lg:px-4 lg:pt-4">
        ${panelLista(list, id)}
        <div class="min-w-0">
          ${/* toda la ficha que ya existía, sin tocar */''}
        </div>
      </div>
```

- [ ] **Step 4: Enganchar el buscador del panel**

En el `onMount` de las dos vistas, añadir:

```js
      const panel = root.querySelector('#buscador-pacientes-panel');
      if (panel) {
        let tp;
        panel.addEventListener('input', (e) => {
          _busqueda = e.target.value;
          clearTimeout(tp);
          tp = setTimeout(async () => {
            const nuevos = await API.listarPacientes({ q: _busqueda });
            const cont = root.querySelector('#lista-pacientes-panel');
            if (!cont) return;
            const sel = location.hash.split('/').pop();
            cont.innerHTML = nuevos.map((p) => `
              <a href="#/t/paciente/${E(p.id)}"
                class="block rounded-xl px-3 py-2.5 text-[13px] font-bold ${p.id === sel ? 'bg-brand-100 text-brand-700' : 'text-ink-700 hover:bg-ink-100'}">
                ${E(p.nombre)}
              </a>`).join('');
          }, 180);
        });
      }
```

- [ ] **Step 5: Verificar el comportamiento completo**

A 1280 px:
- Entrar en Pacientes → lista a la izquierda, «Elige un paciente» a la derecha.
- Pulsar un paciente → su ficha a la derecha, **la lista sigue ahí** y el elegido queda marcado.
- Pegar `#/t/paciente/<id>` en la barra de direcciones → carga con los dos paneles.
- El botón de atrás del navegador funciona.

A 390 px: lista a pantalla completa; al elegir, la ficha a pantalla completa; atrás vuelve a la lista. **Como antes.**

- [ ] **Step 6: Commit**

```bash
npm test
git add js/views-therapist.js
git commit -m "feat: pacientes en dos paneles en escritorio"
```

---

### Task 12: Repaso final y regresión de móvil

- [ ] **Step 1: Suite completa**

```bash
npm test && npm run build
```

Esperado: todo verde, y `dist/ listo · N archivos`.

- [ ] **Step 2: Barrido a los cuatro anchos, los dos roles, sin y con sesión**

| Ancho | Sin sesión | Fisio | Paciente |
|---|---|---|---|
| 390 | marco no, pantalla llena | idéntico a antes | idéntico a antes |
| 768 | marco no | 2 columnas, nav abajo | 2 columnas, nav abajo |
| 1280 | **marco de dispositivo** | lateral + 3 columnas + 2 paneles | lateral + 3 columnas |
| 1920 | **marco de dispositivo** | tope de 1600 px | tope de 1600 px |

- [ ] **Step 3: La regresión que importa**

Con `git stash` volver al estado anterior, capturar las pantallas principales a 390 px, restaurar y comparar. **Cualquier diferencia visible en móvil es un fallo que hay que corregir antes de dar la etapa por buena.**

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "docs: cierre del trabajo responsivo"
```

---

## Notas para quien ejecute

- **No hay pruebas de navegador.** Las únicas automatizadas aquí son las de `navHTML` (Task 1). Todo lo demás se valida a ojo a los cuatro anchos. No es negociable saltarse ese paso: es la única red que hay.
- **`dist/` no se toca a mano.** Cloudflare Pages ejecuta el build y regenera todo. Los archivos de `dist/` que están en git son historia, no lo que se publica.
- Si algo `position: fixed` aparece descolocado en escritorio, la causa casi segura es el `transform` de `.app-frame` (ver Global Constraints).
