# CLIDANFI · Sistema de gestión para clínica de fisioterapia

Aplicación web **mobile-first** con acceso por cuenta y dos roles (Fisioterapeuta / Paciente).
HTML + Tailwind CSS compilado + JavaScript vanilla, con Supabase como backend y despliegue en Netlify.

---

## Puesta en marcha en 5 pasos

```bash
npm install          # instala Tailwind y el cliente de Supabase
npm run build        # genera dist/
npm run serve        # abre http://localhost:8080
```

Sin credenciales de Supabase, la app arranca en **modo demostración** (datos en el navegador)
con estas cuentas de prueba:

| Rol | Correo | Contraseña |
|---|---|---|
| Fisioterapeuta | `fisio@clidanfi.mx` | `clidanfi123` |
| Paciente | `paciente@clidanfi.mx` | `paciente123` |

Para **desarrollo con recarga de CSS**: `npm run dev` y abre `index.html` con cualquier servidor estático.

---

## 1 · Conectar Supabase

### 1.1 Base de datos

En **SQL Editor → New query → Run**, ejecuta en este orden:

1. `supabase/schema.sql` — tablas, triggers, funciones, RLS y catálogo de ejercicios.
2. `supabase/seed.sql` — datos mínimos (leer las instrucciones de su cabecera antes).

Ambos son idempotentes: puedes volver a ejecutarlos sin romper nada.

### 1.2 Cuentas

En **Authentication → Users → Add user** (marca *Auto Confirm User*):

- `fisio@clidanfi.mx` → será el fisioterapeuta
- `paciente@clidanfi.mx` → será el paciente de prueba

Copia el UUID de cada uno y pégalos en las variables `v_fisio_uid` y `v_pac_uid`
de `supabase/seed.sql` antes de ejecutarlo. El script se detiene con un mensaje
claro si se te olvida.

> El trigger `handle_new_user` crea todo usuario nuevo como `paciente`.
> Promover a `fisio` es siempre un acto manual — así nadie se auto-asciende registrándose.

### 1.3 Credenciales

```bash
cp js/env.example.js js/env.js     # Windows: copy js\env.example.js js\env.js
```

y rellena `SUPABASE_URL` y `SUPABASE_ANON_KEY` (**Project Settings → API**).

---

## 2 · Desplegar en Netlify

1. Sube el repositorio a GitHub y en Netlify elige **Add new site → Import an existing project**.
2. Netlify lee `netlify.toml`, así que build y publish ya están configurados
   (`npm run build` → `dist`). No toques esos campos.
3. En **Site configuration → Environment variables** añade:

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
   | `SUPABASE_ANON_KEY` | `eyJhbGciOi...` (la **anon** key) |

4. **Deploy**. El build genera `dist/js/env.js` con esos valores.
5. En Supabase → **Authentication → URL Configuration**, añade tu dominio de Netlify
   a *Site URL* y *Redirect URLs*.

Si las variables faltan, el sitio se publica igual en modo demostración en vez de romperse.

### Sobre la seguridad de la `anon key`

**La `anon key` es pública por diseño.** Viaja al navegador en cualquier aplicación web de
Supabase y no es un secreto: lo que protege los datos son las políticas RLS del servidor.

Usar variables de entorno sirve para no dejar credenciales escritas en el repositorio y para
cambiar entre proyectos (staging/producción) sin tocar código.

`scripts/generate-env.js` **aborta el build** si detecta que la llave configurada tiene
`role != "anon"` — la `service_role` key ignora RLS y en el frontend daría acceso total a la
base de datos a cualquiera que abra las herramientas de desarrollo.

---

## 3 · Seguridad: cómo se separa cada rol

El acceso se resuelve en **tres capas**, de fuera hacia adentro:

**1. Router (`js/app.js`)** — sin sesión solo existe la pantalla de acceso. Cada ruta declara
qué rol la puede abrir; escribir a mano `#/t/pacientes` con sesión de paciente redirige a su
propio inicio.

**2. Capa de datos (`js/api.js`)** — una matriz de autorización envuelve cada función:
`SOLO_FISIO` (dashboard, ingresos, lista de pacientes, sorteos…) y `SOLO_PROPIO` (el paciente
solo pasa si el `paciente_id` que pide coincide con el de su sesión). Es el espejo en cliente
de las políticas RLS y sirve para dar errores claros.

**3. RLS en PostgreSQL (`supabase/schema.sql`)** — la única capa que cuenta de verdad:

| Tabla | Fisioterapeuta | Paciente |
|---|---|---|
| `pacientes` | todo | lee solo su ficha (`usuario_id = auth.uid()`) |
| `citas`, `asistencias`, `pagos` | todo | lee solo las suyas |
| `valoraciones`, `notas` | todo | lee solo su expediente |
| `rutinas`, `rutina_items` | todo | lee solo las suyas |
| `boletos` | todo | lee solo sus boletos |
| `sorteos`, `promociones`, `ejercicios` | todo | lee solo lo publicado/activo |
| `perfiles` | todos | solo el suyo, sin poder cambiar su rol |

Detalles que importan:

- **Ningún rol `paciente` tiene políticas de INSERT/UPDATE/DELETE.** Solo lee. Manipular el
  JavaScript del navegador no cambia eso: el rechazo ocurre en el servidor.
- El helper `es_mi_expediente(uuid)` ancla cada política a `pacientes.usuario_id`, así que no
  hay forma de pedir el expediente de otro cambiando un id en la petición.
- La vista `pacientes_ordenados` se declara con `security_invoker = true`: hereda la RLS de
  quien la consulta en lugar de saltársela.
- Un trigger (`bloquear_cambio_de_rol`) impide que alguien se ascienda a `fisio` editando su
  propio perfil.
- `realizar_sorteo()` e `ingresos_por_dia()` comprueban `es_fisio()` internamente, aunque se
  invoquen directamente por RPC.

---

## 4 · Datos mínimos incluidos

Exactamente lo indispensable para entender la estructura:

| Qué | Cuánto |
|---|---|
| Cuentas de acceso | 2 (1 fisio + 1 paciente) |
| Paciente | 1, vinculado a su cuenta de Auth |
| Cita | 1, agendada para mañana |
| Rutina de ejercicios | 1, activa, con 4 ejercicios |
| Sorteo | 1, activo |
| Asistencia + pago | 1 de cada una |

La asistencia existe porque es la que **genera el boleto del sorteo** y el primer ingreso del
dashboard — sin ella, ambos módulos se ven vacíos y no se entiende el mecanismo. Para arrancar
totalmente en cero, borra los bloques marcados en `supabase/seed.sql` (paso 5) y vacía
`asistencias`, `pagos` y `boletos` en `js/store.js`.

El **catálogo de 22 ejercicios** y las **13 secciones de la valoración inicial** no son datos de
prueba: son la configuración clínica del sistema y se conservan íntegros.

---

## 5 · Estructura

```
CLIDANFI/
├── index.html                 Shell: cabecera, chip de usuario, nav inferior
├── netlify.toml               Build, cabeceras de seguridad y caché
├── package.json               Scripts y dependencias
├── tailwind.config.js         Paleta de marca y tokens
├── css/
│   ├── input.css              Entrada de Tailwind (fuente)
│   ├── tailwind.css           GENERADO · 32 KB
│   └── styles.css             Lo que Tailwind no cubre
├── js/
│   ├── env.js                 GENERADO desde variables de entorno
│   ├── env.example.js         Plantilla
│   ├── vendor/supabase.js     GENERADO · cliente UMD copiado de node_modules
│   ├── ui.js                  Formato, iconos SVG, toasts, sheets, imágenes
│   ├── store.js               Modo demostración + catálogos clínicos
│   ├── api.js                 ◄ CAPA DE DATOS (local) + autorización
│   ├── api-supabase.js        ◄ CAPA DE DATOS (Supabase) · misma firma
│   ├── views-auth.js          Pantalla de acceso
│   ├── views-therapist.js     Vista fisioterapeuta
│   ├── views-patient.js       Vista paciente
│   └── app.js                 Router + guardia de sesión
├── scripts/
│   ├── generate-env.js        Variables de entorno → js/env.js (con validación)
│   ├── vendor.js              Copia el cliente de Supabase
│   └── build.js               Build completo → dist/
├── supabase/
│   ├── schema.sql             Tablas, triggers, funciones, RLS
│   └── seed.sql               Datos mínimos
└── assets/                    Aquí va el logo (ver assets/LEER-ME.txt)
```

**Regla de oro:** ninguna vista toca `localStorage` ni Supabase. Todo pasa por `API.*`, y ambas
implementaciones exportan las mismas 46 funciones. Por eso cambiar de modo demostración a
producción no altera ni una línea de las vistas.

---

## 6 · Funcionalidad

### Fisioterapeuta

| Módulo | Qué hace |
|---|---|
| **Dashboard** | Ingresos de la semana con gráfica por día, comparativo contra la semana anterior, ticket promedio, KPIs y agenda de hoy. |
| **Agenda** | Citas de hoy / próximos 21 días agrupadas por día. Registrar asistencia, reagendar, marcar "no asistió" o eliminar. |
| **Pacientes** | Lista **ordenada por fecha de última asistencia** (más reciente arriba). Buscador con *debounce* que ignora acentos. |
| **Ficha** | Pestañas Resumen · Valoración · Historial · Rutinas. |
| **Valoración inicial** | **13 secciones activables con switch** según la dolencia (EVA, postural, goniometría, Daniels, pruebas especiales por región, marcha, neurológica…) sobre un motor de 9 tipos de campo. |
| **Historial** | Línea de tiempo con EVA y **captura de fotos** desde la cámara (test de marcha, postura, radiografías), comprimidas antes de subirse. |
| **Rutinas** | Catálogo visual de 22 ejercicios con filtros. Cada guardado crea una versión que queda **activa y arriba**; el resto es historial por fecha. |
| **Sorteos** | Crear sorteo, **1 boleto automático por asistencia**, participantes, sorteo con animación y publicación controlada del ganador. |
| **Promociones** | Alta, listado y baja con vigencia. |

### Paciente

Ve **únicamente lo suyo**: próxima cita, estatus de su paquete con anillo de progreso, su rutina
activa con imágenes/series/repeticiones y checklist diario, rutinas anteriores, promociones
vigentes y sus boletos de sorteo con los códigos y el historial de ganadores.

### La cascada que amarra todo

Registrar una asistencia dispara, en una sola operación:

1. Reordena la lista de pacientes (sube al primer lugar).
2. Descuenta una sesión del paquete.
3. Registra el ingreso, visible en la gráfica del dashboard.
4. Emite **un boleto por cada sorteo activo vigente**, visible de inmediato para el paciente.

En Supabase esto lo hace el trigger `trg_boletos_asistencia`, y la restricción
`unique (sorteo_id, asistencia_id)` garantiza la idempotencia desde la propia base de datos.

---

## 7 · Personalización

| Qué | Dónde |
|---|---|
| Logo | `assets/logo-clidanfi.svg` (ver `assets/LEER-ME.txt`) |
| Colores de marca | `tailwind.config.js` → `colors.brand` |
| Precio por sesión | `js/store.js` → `config.precio_sesion` |
| Catálogo de ejercicios | `js/store.js` → `CATALOGO_EJERCICIOS` y tabla `ejercicios` |
| Secciones de la valoración | `js/store.js` → `SECCIONES_VALORACION` |

Para añadir una sección a la valoración basta con agregar un objeto al arreglo: el formulario,
el guardado y la vista de resumen se generan solos.

> **Importante con Tailwind compilado:** las clases nunca deben construirse por interpolación
> (`bg-${tono}-100` no se detecta al purgar y desaparecería del CSS). Pásalas siempre completas,
> como hace `kpi(icono, valor, label, 'bg-emerald-100 text-emerald-700')`.

---

## 8 · Notas técnicas

- **Tailwind compilado**: 32 KB con 443 clases, sin CDN ni advertencias en consola.
- **Sin scripts externos**: el cliente de Supabase se sirve desde el propio dominio, lo que
  permite mantener `script-src 'self'` en la CSP.
- **Cabeceras** en `netlify.toml`: CSP, HSTS, `X-Frame-Options: DENY`, `Permissions-Policy`
  (cámara permitida solo al propio origen, para las fotos de pruebas).
- **Caché**: HTML y `env.js` sin caché para que un deploy se vea al instante; CSS y assets 7 días.
- Router por hash, contenedor de 480 px centrado en escritorio, áreas táctiles ≥ 44 px,
  `env(safe-area-inset-*)` para el notch y `prefers-reduced-motion` respetado.
- En modo demostración las fotos se guardan como data-URL comprimidas (máx. 900 px, JPEG 72 %);
  con Supabase van al bucket privado `evidencias` con URL firmada.
