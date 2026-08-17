# CLIDANFI · Sistema de gestión para clínica de fisioterapia

Aplicación web **mobile-first** con acceso por cuenta y dos roles (Fisioterapeuta / Paciente).
HTML + Tailwind CSS compilado + JavaScript vanilla, con **Supabase como único backend** y
despliegue en Netlify.

> **No hay modo demostración.** La aplicación siempre habla con Supabase. Si falta
> configuración, muestra una pantalla que dice exactamente qué falta y cómo resolverlo,
> en vez de arrancar con datos falsos que luego no coinciden con la base real.

---

## Puesta en marcha

```bash
npm install                          # Tailwind + cliente de Supabase
copy js\env.example.js js\env.js     # (macOS/Linux: cp js/env.example.js js/env.js)
```

Abre `js/env.js` y pega tus credenciales de **Supabase → Project Settings → API**:

```js
window.CLIDANFI_ENV = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...'          // la anon public key
};
```

Después:

```bash
npm run build     # genera dist/
npm run serve     # http://localhost:8080
```

---

## 1 · Base de datos

En **SQL Editor → New query → Run**, ejecuta en este orden:

1. `supabase/schema.sql` — tablas, triggers, funciones, RLS y catálogo de ejercicios.
2. `supabase/seed.sql` — datos mínimos (lee las instrucciones de su cabecera antes).

Ambos son idempotentes.

> **Si ya tenías la base montada, vuelve a ejecutar `supabase/schema.sql` completo.**
> Es idempotente y no borra datos: las columnas nuevas se añaden con `add column if not
> exists`. Sin ese paso faltarán el precio por cita, el motivo de cancelación, la marca de
> historial pendiente, la tabla `archivos`, la tabla `sorteo_excluidos` y el bucket
> `expedientes`. La aplicación **no se rompe** sin ellos —degrada y lo avisa en el
> dashboard—, pero esas funciones quedan a medias: en concreto, un participante excluido de
> una rifa volvería a entrar al guardar el sorteo.

### Cuentas

En **Authentication → Users → Add user** (marca *Auto Confirm User*):

- una para el fisioterapeuta
- una para el paciente de prueba

Copia el UUID de cada uno en `v_fisio_uid` y `v_pac_uid` dentro de `supabase/seed.sql`
antes de ejecutarlo. El script se detiene con un mensaje claro si se te olvida.

> El trigger `handle_new_user` crea todo usuario nuevo como `paciente`. Promover a `fisio`
> es siempre un acto manual, así que nadie se auto-asciende registrándose. **Si al entrar
> ves el portal del paciente en vez del panel, es que falta ese paso**: revisa la fila
> correspondiente en la tabla `perfiles`.

### ⚠ Confirmación de correo: obligatoria

En **Authentication → Providers → Email**, la opción **«Confirm email» debe quedar
ACTIVADA**.

El autorregistro vincula la cuenta nueva con el expediente que ya tuviera ese mismo correo.
Si desactivas la confirmación, cualquiera podría reclamar la historia clínica de otra persona
con solo escribir su dirección. Por eso el trigger `vincular_expediente_por_correo` solo
actúa cuando `email_confirmed_at` no es nulo.

---

## 2 · Desplegar en Netlify

1. Sube el repositorio a GitHub → en Netlify, **Add new site → Import an existing project**.
2. Netlify lee `netlify.toml`: build y publish ya están configurados (`npm run build` → `dist`).
3. En **Site configuration → Environment variables**:

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
   | `SUPABASE_ANON_KEY` | `eyJhbGciOi...` (la **anon** key) |

4. **Deploy**. El build genera `dist/js/env.js` con esos valores.
5. En Supabase → **Authentication → URL Configuration**, añade tu dominio de Netlify a
   *Site URL* y *Redirect URLs*.

### Sobre la seguridad de la `anon key`

**La `anon key` es pública por diseño.** Viaja al navegador en cualquier aplicación web de
Supabase y no es un secreto: lo que protege los datos son las políticas RLS del servidor.
Usar variables de entorno sirve para no dejar credenciales en el repositorio y para cambiar
de proyecto sin tocar código.

Hay dos barreras contra el error caro:

- `js/supabase-client.js` **no arranca la app** si la llave configurada tiene `role != "anon"`.
- `scripts/build.js` **aborta el despliegue** si encuentra cualquier JWT privilegiado
  incrustado en los archivos publicados. Decodifica el token, así que mencionar la palabra
  `service_role` en un comentario es legítimo; llevar la llave, no.

---

## 3 · Seguridad: cómo se separa cada rol

Tres capas, de fuera hacia adentro:

**1. Router (`js/app.js`)** — tres puertas en orden: sin configuración válida → pantalla de
configuración; sin sesión → pantalla de acceso; con sesión, cada ruta declara qué rol la
puede abrir. Escribir a mano `#/t/pacientes` con sesión de paciente redirige a su inicio.

**2. Capa de datos (`js/api.js`)** — una matriz de autorización envuelve cada función:
`SOLO_FISIO` (dashboard, ingresos, lista de pacientes, sorteos…) y `SOLO_PROPIO` (el
paciente solo pasa si el `paciente_id` que pide coincide con el de su sesión). Corta antes
de salir a la red y da mensajes claros.

**3. RLS en PostgreSQL (`supabase/schema.sql`)** — la única capa que cuenta de verdad:

| Tabla | Fisioterapeuta | Paciente |
|---|---|---|
| `pacientes` | todo | lee solo su ficha (`usuario_id = auth.uid()`) |
| `citas`, `asistencias`, `pagos` | todo | lee solo las suyas |
| `valoraciones`, `notas` | todo | lee solo su expediente |
| `rutinas`, `rutina_items` | todo | lee solo las suyas |
| `boletos` | todo | lee solo sus boletos |
| `sorteos`, `promociones`, `ejercicios` | todo | lee solo lo publicado/activo |
| `solicitudes_cita` | todo | crea y lee **las suyas** |
| `perfiles` | todos | solo el suyo, sin poder cambiar su rol |

- El rol `paciente` **solo lee** el expediente clínico. Su única escritura permitida es crear
  su propia solicitud de cita (`solicitudes_cita`), y la política exige que el `usuario_id`
  sea el suyo. Manipular el JavaScript del navegador no cambia eso: el rechazo es del servidor.
- `es_mi_expediente(uuid)` ancla cada política a `pacientes.usuario_id`.
- La vista `pacientes_ordenados` usa `security_invoker = true`: hereda la RLS de quien consulta.
- Un trigger impide ascenderse a `fisio` editando el propio perfil.

---

## 4 · Datos mínimos incluidos

| Qué | Cuánto |
|---|---|
| Cuentas de acceso | 2 (1 fisio + 1 paciente) |
| Paciente | 1, vinculado a su cuenta de Auth |
| Cita | 1, agendada para mañana |
| Rutina de ejercicios | 1, activa, con 4 ejercicios |
| Sorteo | 1, activo |
| Asistencia + pago | 1 de cada una |

La asistencia genera el boleto del sorteo y el primer ingreso del dashboard. Para arrancar
totalmente en cero, borra el paso 5 de `supabase/seed.sql`.

El **catálogo de 22 ejercicios** y las **13 secciones de la valoración inicial** no son datos
de prueba: son configuración clínica y viven en `js/store.js` (y la tabla `ejercicios`).

---

## 5 · Diseño

### Paleta

Muestreada directamente del logotipo (`assets/logo-clidanfi.jpeg`), así que interfaz y marca
van a juego:

| Escala | Uso | Referencia |
|---|---|---|
| `brand` | Rojo clínico · acciones, acentos, cabeceras | `brand-700` `#921f23` (el del logo) |
| `cream` | Beige · fondo de la aplicación | `cream-100` `#f8f4ed` |
| `ink` | Neutros cálidos · texto, bordes, tarjetas | `ink-900` `#1c1b1a` |
| `night` | Fondo oscuro del marco de escritorio | `night-800` `#212022` (el del logo) |

> Si cambias el logotipo, vuelve a muestrear estos tres colores y actualiza
> `tailwind.config.js`, o la interfaz dejará de coincidir con la marca.

Se cambian en un solo sitio: `tailwind.config.js`. Los pocos valores que Tailwind no puede
alcanzar (anillo de progreso SVG, miniaturas generadas) están en `css/styles.css` como
variables CSS y en `js/ui.js`.

### Escritorio

En pantallas ≥ 900 px la vista móvil se convierte en un dispositivo centrado sobre fondo
oscuro con degradado, textura fina y una versión tenue del logotipo. **La vista de celular
no cambia**: todo el tratamiento de escritorio vive dentro de una media query.

Detalle de implementación que conviene conocer antes de tocarlo: `.app-frame` lleva
`transform: translateZ(0)` **a propósito**. Eso lo convierte en el bloque contenedor de sus
descendientes `position: fixed`, de modo que la navegación inferior, el botón flotante, los
paneles deslizantes y los avisos quedan dentro del marco en lugar de pegarse a los bordes de
la ventana. Por el mismo motivo `#sheet-root` y `#toast-root` van dentro del marco.

El recorte (`overflow: hidden`) se aplica **solo** en escritorio: en móvil convertiría el
marco en contenedor de scroll y la cabecera *sticky* dejaría de funcionar.

### Logo

Copia tu archivo en **`assets/logo-clidanfi.jpeg`** y aparece solo en los cuatro sitios donde
está cableado: cabecera, pantalla de acceso, marca de agua del fondo de escritorio y favicon.
Mientras no exista, se muestra un recuadro punteado con la palabra «LOGO» y la marca de agua
simplemente no se dibuja. Ver `assets/LEER-ME.txt`.

El JPEG no admite transparencia, así que el logo conserva su fondo oscuro: en la cabecera y
en el acceso se ve como un mosaico redondeado, a modo de icono de aplicación. En la marca de
agua no se nota el recuadro porque ese fondo (`#212022`) **es** el `night-800` del degradado.
Si prefieres que se recorte contra el crema, exporta un PNG con transparencia y cambia la
extensión en `index.html` y `js/views-auth.js`.

---

## 6 · Estructura

```
CLIDANFI/
├── index.html                 Shell: marco, cabecera, chip de usuario, nav
├── netlify.toml               Build, cabeceras de seguridad y caché
├── tailwind.config.js         Paleta de marca y tokens
├── css/
│   ├── input.css              Entrada de Tailwind (fuente)
│   ├── tailwind.css           GENERADO
│   └── styles.css             Escritorio, animaciones, formularios, impresión
├── js/
│   ├── env.js                 GENERADO · credenciales
│   ├── env.example.js         Plantilla
│   ├── vendor/supabase.js     GENERADO · cliente UMD desde node_modules
│   ├── supabase-client.js     ◄ ÚNICO punto donde se crea el cliente
│   ├── ui.js                  Formato, iconos SVG, toasts, paneles, imágenes
│   ├── store.js               Catálogos clínicos (sin datos ni persistencia)
│   ├── api.js                 ◄ CAPA DE DATOS + matriz de autorización
│   ├── views-auth.js          Acceso y pantalla de configuración
│   ├── views-therapist.js     Vista fisioterapeuta
│   ├── views-patient.js       Vista paciente
│   └── app.js                 Router + guardia de sesión
├── scripts/
│   ├── check-schema.js        Cruza js/api.js con schema.sql (caza los 404)
│   ├── test-esquema.js        Regresión: detección de esquema desactualizado
│   ├── test-subidas.js        Regresión: subidas de imagen bajo la CSP
│   ├── test-funciones.js      Regresión: importes, agenda, archivos, exclusiones
│   ├── generate-env.js        Variables de entorno → js/env.js (con validación)
│   ├── vendor.js              Copia el cliente de Supabase
│   └── build.js               Build completo → dist/
├── supabase/
│   ├── schema.sql             Tablas, triggers, funciones, RLS
│   └── seed.sql               Datos mínimos
└── assets/                    Aquí va el logo (ver assets/LEER-ME.txt)
```

**Regla de oro:** ninguna vista consulta Supabase por su cuenta. Todo pasa por `API.*`, y el
cliente se crea una sola vez en `supabase-client.js`.

---

## 7 · Funcionalidad

### Fisioterapeuta

| Módulo | Qué hace |
|---|---|
| **Dashboard** | Ingresos de la semana con gráfica por día, comparativo, ticket promedio, KPIs y agenda de hoy. |
| **Agenda** | Citas de hoy / próximos 21 días. Registrar asistencia, reagendar, marcar "no asistió", **cancelar liberando el horario** o eliminar. Avisa si el hueco pisa otra cita. |
| **Agendar** | Con paciente registrado o **con uno nuevo dando solo nombre y teléfono**. Precio propio por cita. |
| **WhatsApp** | Recordatorios y avisos con el mensaje ya redactado: por cita, por paciente, en tanda para los próximos días y al responder solicitudes. |
| **Pacientes** | Lista **ordenada por fecha de última asistencia**. Buscador que ignora acentos. |
| **Ficha** | Resumen · Valoración · Historial · Rutinas. |
| **Valoración inicial** | **13 secciones activables con switch** según la dolencia, sobre un motor de 9 tipos de campo. |
| **Historial** | Línea de tiempo con EVA, fotos desde la cámara y **archivos del expediente (imágenes y PDF)**. |
| **Rutinas** | Catálogo visual de 22 ejercicios. Cada guardado crea una versión **activa y arriba**; el resto es histórico. |
| **Sorteos** | Crear sorteo, **1 boleto automático por asistencia**, participantes, **excluir y readmitir**, sorteo animado y publicación controlada del ganador. |
| **Promociones** | Alta, listado y baja con vigencia. |
| **Cobros** | Precio de la clínica en *Personalizar clínica*, precio pactado por cita, y ambos validados antes de tocar la base. |

Todos los botones de guardar y editar están siempre operativos; los errores del servidor se
muestran como aviso en pantalla, incluidos los de permisos. En **Mi cuenta** se confirma si
el perfil tiene permisos de edición y contra qué proyecto de Supabase está conectado.

### Paciente

Ve **únicamente lo suyo**: próxima cita, estatus de su paquete con anillo de progreso, su
rutina activa con imágenes/series/repeticiones y checklist diario, rutinas anteriores,
promociones vigentes y sus boletos de sorteo con el historial de ganadores.

### Autorregistro público y vitrina

Cualquiera puede crear su cuenta desde la pantalla de acceso. Nace siempre con rol `paciente`
(lo fija el servidor, no el cliente) y entra a una **vitrina comercial**: promociones vigentes,
sorteos en curso, qué incluye el tratamiento y un botón para **solicitar su primera cita**.

Al enviarla, el fisioterapeuta la ve en el dashboard y en *Solicitudes de cita*, desde donde
puede contactarla, descartarla o pulsar **Crear expediente**.

**Vinculación sin duplicados.** Si el correo del registro ya tenía expediente creado por el
fisioterapeuta, la cuenta se enlaza con él en lugar de generar uno nuevo. Ocurre en dos sitios,
ambos en el servidor:

- El trigger `vincular_expediente_por_correo` actúa al confirmarse el correo y engancha el
  expediente más antiguo que tenga esa dirección y siga sin cuenta.
- La función `convertir_solicitud` repite la comprobación al crear el expediente desde el panel.

En cuanto queda vinculado, la persona ve su historial, sus citas y sus ejercicios de siempre:
la vitrina desaparece y el portal pasa a mostrar su expediente real.

### Guardado manual, sin autoguardado

Ni la valoración inicial ni el generador de rutinas guardan nada mientras escribes: todo vive
en el formulario hasta que pulsas **Guardar**. Ese botón:

- recoge **todos** los campos en una sola pasada — texto, número, deslizadores EVA, casillas,
  desplegables, tablas de goniometría y fuerza, y pruebas especiales;
- se bloquea mientras dura la petición para evitar envíos duplicados;
- muestra el resultado bajo el propio botón: verde con el detalle si fue bien, o el **motivo real
  del error** del servidor si falló, **sin salir de la pantalla** para no perder lo capturado;
- avisa si intentas salir con cambios pendientes (al volver, al navegar y al cerrar la pestaña).

### Recordatorios por WhatsApp

No hay integración con la API de negocio de WhatsApp: es de pago y exige un servidor propio.
Lo que hay es lo que funciona en cualquier teléfono desde el primer día — **enlaces `wa.me`
con el mensaje ya escrito**, que abren la conversación del paciente lista para enviar.

- El teléfono se normaliza a formato internacional (`telWhatsApp` en `js/ui.js`): acepta
  `667 123 4567`, `(667)123-4567`, `+52 667 123 4567` o el viejo `044…`, y devuelve vacío
  —sin generar enlace roto— si el número no da para más.
- El texto se puede **editar antes de enviar**, y también copiarse como enlace para quien
  atiende el teléfono desde otro dispositivo.
- Hay plantilla de recordatorio, de confirmación al agendar, de aviso de cancelación, de
  seguimiento y de respuesta a una solicitud de cita.
- **El envío siempre lo confirma una persona.** Es lo que evita que salga un recordatorio a
  quien acaba de cancelar.

Desde *Agenda → Recordatorios por WhatsApp* se despachan en tanda las citas de los próximos
días, marcando cuáles no tienen teléfono utilizable.

### Cancelar no es borrar

Son dos acciones distintas y la diferencia importa:

- **Cancelar** cambia el estatus a `cancelada`, guarda el motivo y la hora, y **libera el
  horario**: la ocupación de la agenda solo cuenta las citas en estado `agendada`. El registro
  se conserva en el historial del paciente y se ofrece avisarle por WhatsApp.
- **Eliminar** la borra del historial y no deja rastro de que ese hueco existió.

### Agendar sin registro previo

Cuando alguien llama para pedir hora y no está en el sistema, *Agendar cita → Paciente nuevo*
crea el expediente con **nombre y teléfono**, nada más. Ese expediente nace marcado con
`expediente_pendiente`, así que:

- aparece con la etiqueta *Historial pendiente* en la lista de pacientes;
- su ficha muestra un aviso en todas las pestañas hasta completarlo;
- no se le inventa un paquete de sesiones contratado (`paquete_total = 0`), que descuadraría
  el conteo.

La marca se retira al guardar la ficha completa o con *Ya está al día*.

### Archivos del expediente

Las fotos de una nota son evidencias de **esa sesión**. Los archivos del expediente son otra
cosa: la radiografía, la resonancia, el informe del traumatólogo o el consentimiento firmado,
que pertenecen al expediente entero.

- Se admiten **imágenes y PDF hasta 20 MB**, y suben **tal cual** —sin recomprimir— porque un
  PDF no sobrevive a la conversión y una radiografía recomprimida pierde el detalle por el que
  se guarda.
- Van al bucket privado `expedientes`. **La URL no se almacena**: se firma en cada lectura y
  caduca, así que un enlace que se escape deja de servir solo.
- Si falla el registro en la tabla, el binario recién subido se retira del bucket.

### Excluir a alguien de una rifa

Quitar a un participante **no puede ser borrarle los boletos**: se emiten solos con cada
asistencia y `sincronizar_boletos` los repondría en el siguiente guardado del sorteo. Por eso
la exclusión se guarda como un hecho aparte, en la tabla `sorteo_excluidos`, que consultan
tanto el trigger de emisión como la sincronización.

Es reversible: al **readmitir** se borra la exclusión y se reponen los boletos de todas sus
asistencias dentro del periodo. Con el ganador ya elegido la lista pasa a solo lectura, porque
a esas alturas quitar gente no cambiaría el resultado.

### La cascada que amarra todo

Registrar una asistencia dispara, en una sola operación:

1. Reordena la lista de pacientes (sube al primer lugar).
2. Descuenta una sesión del paquete.
3. Registra el ingreso, visible en la gráfica del dashboard.
4. Emite **un boleto por cada sorteo activo vigente**, visible de inmediato para el paciente.

Lo hace el trigger `trg_boletos_asistencia`, y `unique (sorteo_id, asistencia_id)` garantiza
la idempotencia desde la propia base de datos.

---

## 8 · Diagnóstico de errores 404

Un 404 de Supabase casi siempre significa una de dos cosas: el cliente pide algo que no
existe con ese nombre, o la base va por detrás del código.

**Antes de desplegar**, `npm run check` cruza cada `.from()`, `.rpc()` y filtro `.eq()` de
`js/api.js` contra `supabase/schema.sql` y avisa de tablas, vistas, funciones o columnas que
no cuadren. Se ejecuta solo dentro de `npm run build`, así que un desajuste **detiene el
despliegue** en lugar de llegar a producción.

**En caliente**, si una consulta encuentra un objeto inexistente (`42P01`, `PGRST202`,
`PGRST205`), la aplicación no se rompe: la funcionalidad que depende de él se desactiva, el
resto sigue trabajando y el dashboard muestra un aviso con el nombre del objeto que falta y
la instrucción para arreglarlo. Es lo que ocurre si añades funciones al código y olvidas
volver a ejecutar `supabase/schema.sql`.

## 9 · Notas técnicas

- **Tailwind compilado**: ~32 KB, sin CDN ni advertencias en consola. Las clases nunca deben
  construirse por interpolación (`bg-${tono}-100` no se detecta al purgar): pásalas completas,
  como en `kpi(icono, valor, label, 'bg-emerald-100 text-emerald-700')`.
- **Sin scripts externos**: el cliente de Supabase se sirve desde el propio dominio, lo que
  permite mantener `script-src 'self'` en la CSP.
- **Cabeceras** en `netlify.toml`: CSP, HSTS, `X-Frame-Options: DENY`, `Permissions-Policy`
  (cámara permitida solo al propio origen, para las fotos de pruebas).
- Router por hash, áreas táctiles ≥ 44 px, `env(safe-area-inset-*)` para el notch y
  `prefers-reduced-motion` respetado.
- Las fotos de evidencias se comprimen en el navegador (máx. 900 px, JPEG 72 %) y van al
  bucket privado `evidencias` con URL firmada.
- Los archivos del expediente (bucket privado `expedientes`) **no** se comprimen ni se
  convierten: un PDF no sobrevive a eso. El límite de 20 MB y los tipos admitidos se imponen
  en el cliente **y** en el propio bucket, para que no dependan del JavaScript.
- Los enlaces de WhatsApp son `wa.me` con el texto codificado; no hay integración con la API
  de negocio ni, por tanto, servidor intermedio que custodiar.
