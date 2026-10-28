# CLIDANFI · Sistema de gestión para clínica de fisioterapia

Aplicación web **mobile-first** con acceso por cuenta y dos roles (Fisioterapeuta / Paciente).
HTML + Tailwind CSS compilado + JavaScript vanilla, con **Supabase como único backend**,
despliegue en **Cloudflare Pages** y un **Worker con Cron Triggers** para los recordatorios
automáticos.

> **No hay modo demostración.** La aplicación siempre habla con Supabase. Si falta
> configuración, muestra una pantalla que dice exactamente qué falta y cómo resolverlo,
> en vez de arrancar con datos falsos que luego no coinciden con la base real.

---

## Puesta en marcha

```bash
npm install                # Tailwind + cliente de Supabase
copy .env.example .env     # (macOS/Linux: cp .env.example .env)
```

Abre `.env` y pega tus credenciales de **Supabase → Project Settings → API**:

```ini
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...     # la anon public key
VAPID_PUBLIC_KEY=                   # opcional, solo para notificaciones push
```

`js/env.js` es un archivo **generado**: lo escribe `scripts/generate-env.js` a partir de
esas variables. Ni `.env` ni `js/env.js` se suben a git.

Después:

```bash
npm run build     # genera dist/
npm run serve     # http://localhost:8080
npm test          # cruce con el esquema + pruebas de regresión
```

---

## 1 · Base de datos

En **SQL Editor → New query → Run**, ejecuta en este orden:

1. `supabase/schema.sql` — tablas, triggers, funciones, RLS y catálogo de ejercicios.
2. `supabase/seed.sql` — datos mínimos (lee las instrucciones de su cabecera antes).

Ambos son idempotentes.

> **Si ya tenías la base montada, vuelve a ejecutar `supabase/schema.sql` completo.**
> Es idempotente y no borra datos: las columnas nuevas se añaden con `add column if not
> exists` y los paquetes ya contratados conservan su saldo. Sin ese paso faltarán el precio
> por cita, la bitácora de cancelación (`cancelada_por`), el registro de faltas, la
> anulación de boletos sueltos, las tablas `archivos`, `sorteo_excluidos`,
> `valoracion_opciones`, `push_suscripciones` y `avisos_enviados`, y los buckets
> `expedientes` y de escritura en `ejercicios`.
>
> La aplicación **no se rompe** sin ellos —degrada y lo avisa en el dashboard—, pero esas
> funciones quedan a medias. Dos casos que conviene conocer:
>
> - un participante excluido de una rifa volvería a entrar al guardar el sorteo;
> - **anular un boleto suelto fallaría con un aviso** en vez de hacerlo en silencio, que es
>   deliberado: una anulación que no se guarda es peor que una que no se intenta.

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

## 2 · Desplegar en Cloudflare Pages

1. Sube el repositorio a GitHub → en Cloudflare, **Workers & Pages → Create → Pages →
   Connect to Git**.
2. Build command `npm run build`, output directory `dist`.
3. En **Settings → Environment variables**:

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
   | `SUPABASE_ANON_KEY` | `eyJhbGciOi...` (la **anon** key) |
   | `VAPID_PUBLIC_KEY` | la pública de `npm run vapid` (solo si quieres avisos push) |

4. **Deploy**. El build genera `dist/js/env.js` con esos valores.
5. En Supabase → **Authentication → URL Configuration**, añade tu dominio de Pages a
   *Site URL* y *Redirect URLs*.

> **Cloudflare no lee `netlify.toml`.** Las cabeceras de seguridad y las reglas de caché
> viven en **`_headers`** y **`_redirects`**, en la raíz del proyecto, y el build las copia
> a `dist/`. Sin ellas el sitio se publica igual de bien —sin CSP, sin HSTS y sin
> `X-Frame-Options`—, y no hay nada visible que lo delate: por eso `scripts/build.js`
> aborta si `_headers` no llega a `dist/`. `netlify.toml` se conserva solo como
> referencia histórica; ya no lo lee nadie.

### Los avisos automáticos van aparte

El sitio de Pages es estático: no puede despertar solo a las 18:00. Los recordatorios
corren en un **Worker con Cron Triggers** que se despliega por separado, desde `worker/`.
Está en la sección 3.

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

## 3 · Avisos automáticos (Cloudflare Worker)

Dos recordatorios, los dos dirigidos **al fisio**:

| Cuándo | Qué manda |
|---|---|
| **18:00** hora de la clínica | Resumen de las citas de mañana, con el mensaje de WhatsApp ya redactado para cada paciente. Un toque y se abre la conversación lista para enviar. |
| **40 min antes** de cada sesión | Aviso con el nombre del paciente y la hora. |

### Por qué no vive en el navegador

Un `setTimeout` necesita la pestaña abierta. A las 18:00 la aplicación suele estar cerrada,
y 40 minutos antes de una sesión el fisio está con otro paciente. El Worker corre en la
infraestructura de Cloudflare sin que haya nadie mirando: es la única pieza del sistema que
no depende de que alguien tenga CLIDANFI abierto.

### Por qué el aviso es al fisio y no al paciente

Mandar WhatsApp automático exige la **API de negocio de Meta**: es de pago, hay que
verificar el número de la clínica y las plantillas se aprueban una por una. En su lugar el
Worker avisa al fisio con los enlaces `wa.me` ya armados, y el envío lo confirma una
persona con un toque. Cuesta cero, funciona desde el primer día y —esto importa más de lo
que parece— **evita que salga un recordatorio automático a quien acaba de cancelar**.

### Puesta en marcha

```bash
cd worker
npm install
npm run vapid                                  # genera el par de claves, una sola vez
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put WORKER_SECRET          # protege el disparo manual
npm run deploy
```

Luego, en `worker/wrangler.toml`, rellena `SUPABASE_URL` y `VAPID_PUBLIC_KEY`, y ajusta
`TZ_CLINICA` (por defecto `America/Mazatlan`), `HORA_RECORDATORIO` y `MINUTOS_ANTES`.

**La `VAPID_PUBLIC_KEY` tiene que ser la misma** en `wrangler.toml` y en las variables de
Cloudflare Pages. Si no coinciden, el navegador se suscribe con una clave y el Worker firma
con otra: el servicio push devuelve 403 y la notificación no llega nunca.

Cada fisio activa los avisos **por aparato**, desde *Mi cuenta → Avisos en este aparato*.
El móvil y el portátil son dos suscripciones distintas y las dos reciben.

```bash
npm run tail                                   # ver cada ejecución del cron en vivo
curl -X POST -H "x-worker-secret: …" https://…/disparar?tipo=dia    # probar sin esperar
```

### Detalles que no se ven

- **La hora local se resuelve con `Intl`, no restando horas.** El cron diario se declara
  *cada hora* y el Worker comprueba si en la clínica son las 18:00. Fijar una hora UTC
  obligaría a corregirla en cada cambio de horario de verano.
- **El aviso de 40 minutos busca en una ventana de ±5 min** aunque el cron corra cada 5. Con
  una ventana exacta, un retraso de segundos en el disparo dejaría una cita sin avisar para
  siempre; que entre en dos pasadas no importa, porque la clave primaria de
  `avisos_enviados` solo deja mandarla una vez. **La idempotencia es de la base, no de un
  `if`.**
- **Una suscripción que devuelve 404/410 se da de baja sola.** Es un navegador desinstalado;
  sin esto se reintentaría en cada pasada para siempre. Un 500, en cambio, **no** la da de
  baja: sería apagarle los avisos al fisio por una caída ajena.
- **El Worker entra con la `service_role` key**, que se salta RLS —es la única forma de leer
  la agenda sin sesión abierta—. Por eso no expone ningún endpoint que devuelva datos de
  pacientes, y esa llave nunca sale de sus secretos.
- **El cifrado Web Push está escrito a mano** (VAPID + `aes128gcm`, RFC 8291/8292) porque
  `web-push` de npm depende del `crypto` de Node y no corre en Workers. `npm run test:worker`
  hace de navegador: genera un par de claves, intercepta el envío y **descifra el cuerpo**.
  Es la única forma de detectarlo, porque un cifrado mal hecho no falla: el servicio push
  responde 201 y la notificación simplemente no aparece.

## 4 · Seguridad: cómo se separa cada rol

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

## 5 · Datos mínimos incluidos

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

## 6 · Diseño

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

## 7 · Estructura

```
CLIDANFI/
├── index.html                 Shell: marco, cabecera, chip de usuario, nav
├── sw.js                      Service worker · recibe las notificaciones push
├── _headers                   Cabeceras de seguridad y caché (Cloudflare Pages)
├── _redirects                 Catch-all a index.html
├── netlify.toml               HISTÓRICO · ya no lo lee nadie
├── .env.example               Plantilla de variables (cópiala a .env)
├── tailwind.config.js         Paleta de marca y tokens
├── css/
│   ├── input.css              Entrada de Tailwind (fuente)
│   ├── tailwind.css           GENERADO
│   └── styles.css             Escritorio, animaciones, formularios, impresión
├── js/
│   ├── env.js                 GENERADO · credenciales
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
│   ├── test-funciones.js      Regresión: importes, agenda, faltas, boletos, ejercicios
│   ├── generate-env.js        Variables de entorno → js/env.js (con validación)
│   ├── vendor.js              Copia el cliente de Supabase
│   └── build.js               Build completo → dist/
├── supabase/
│   ├── schema.sql             Tablas, triggers, funciones, RLS
│   └── seed.sql               Datos mínimos
├── worker/                    ◄ SE DESPLIEGA APARTE (Cloudflare Workers)
│   ├── wrangler.toml          Cron Triggers y variables
│   ├── src/index.js           Los dos recordatorios + hora local de la clínica
│   ├── src/webpush.js         VAPID + cifrado aes128gcm, sin dependencias
│   ├── src/supabase.js        Cliente REST con service_role
│   ├── scripts/generar-vapid.js   Par de claves, una sola vez
│   └── test/webpush.test.js   Descifra el push como lo haría el navegador
└── assets/                    Aquí va el logo (ver assets/LEER-ME.txt)
```

**Regla de oro:** ninguna vista consulta Supabase por su cuenta. Todo pasa por `API.*`, y el
cliente se crea una sola vez en `supabase-client.js`.

---

## 8 · Funcionalidad

### Fisioterapeuta

| Módulo | Qué hace |
|---|---|
| **Dashboard** | Ingresos de la semana con gráfica por día, comparativo, ticket promedio, KPIs y agenda de hoy. |
| **Agenda** | Citas de hoy / próximos 21 días. Registrar asistencia, reagendar, **marcar falta**, **cancelar con bitácora** o eliminar. Avisa si el hueco pisa otra cita. |
| **Agendar** | Con paciente registrado o **con uno nuevo dando solo nombre y teléfono**. Precio propio por cita. |
| **Avisos push** | Resumen de las citas de mañana a las 18:00 y aviso 40 min antes de cada sesión, desde un Worker que no necesita el navegador abierto. |
| **WhatsApp** | Recordatorios y avisos con el mensaje ya redactado: por cita, por paciente, en tanda para los próximos días y al responder solicitudes. |
| **Pacientes** | Lista **ordenada por fecha de última asistencia**. Buscador que ignora acentos. **Paquete de sesiones opcional.** |
| **Ficha** | Resumen · Valoración · Historial · Rutinas, con **control de asistencia y % de cumplimiento**. |
| **Valoración inicial** | **13 secciones activables con switch** según la dolencia, sobre un motor de 9 tipos de campo, y **listas ampliables** con las opciones que haga falta añadir. |
| **Historial** | Línea de tiempo con EVA, fotos desde la cámara y **archivos del expediente (imágenes y PDF)**. |
| **Ejercicios** | Catálogo **editable**: alta, edición, **foto propia** y retirada segura de los que ya están en rutinas entregadas. |
| **Rutinas** | Catálogo visual sobre el catálogo real de la base. Cada guardado crea una versión **activa y arriba**; el resto es histórico. |
| **Sorteos** | Crear sorteo, **1 boleto automático por asistencia**, participantes, **anular una participación suelta**, **excluir y readmitir** a una persona, sorteo animado y publicación controlada del ganador. |
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

### Cancelar, faltar y borrar son tres cosas

- **Cancelar** cambia el estatus a `cancelada` y **libera el horario**. El motivo es
  **obligatorio** y se guarda junto a **quién canceló** (`Paciente` / `Clínica` / `Otro`) y
  **qué usuario lo tecleó** —esto último se toma del perfil en sesión, no se pregunta: si se
  preguntara, cualquiera podría firmar con otro nombre—. Se ofrece avisar por WhatsApp.
- **Marcar falta** deja la cita como `no_asistio`, con su motivo y una marca de
  *justificada*. También libera el horario, pero cuenta distinto.
- **Eliminar** la borra del historial y no deja rastro de que ese hueco existió.

El motivo es obligatorio en la cancelación y no en la falta por una razón práctica: una
falta ya se explica sola —no vino—, mientras que una cancelación sin razón es
indistinguible de un hueco cualquiera tres meses después, que es justo cuando hace falta
saber si el paciente abandonó el tratamiento o si fue la clínica quien movió la agenda.

### Control de asistencia

La ficha muestra asistidas, faltas y cancelaciones, con un porcentaje de cumplimiento.

**Las cancelaciones no bajan el cumplimiento.** Avisar con tiempo es exactamente lo que la
clínica quiere que hagan los pacientes —permite reasignar el hueco—, y penalizarlo
desincentivaría justo esa conducta. El porcentaje se calcula solo sobre asistidas y faltas.

### El paquete de sesiones es opcional

Mucha gente paga sesión por sesión. Antes el formulario venía relleno con «Paquete 10
sesiones» y un 10, así que guardar sin mirar le inventaba al paciente un saldo que nadie
había comprado, y ese saldo descuadraba después el conteo de sesiones restantes.

Ahora es un interruptor apagado por defecto (`paquete_total = 0`), y la ficha de quien no
tiene paquete dice «paga por sesión» en vez de pintar una barra al 0 %, que se leería como
un paquete agotado —lo contrario de lo que pasa—.

### Listas de valoración ampliables

Ninguna lista cerrada aguanta la consulta real: llega un paciente con un antecedente, un
test o un mecanismo de lesión que no está, y la única salida era escribirlo en un campo de
texto donde ya no se puede filtrar ni contar.

Cada lista (`select`, `checks`, `tests`) lleva un botón **+ Otra**. Lo que se añade:

- se guarda en `valoracion_opciones`, **para toda la clínica**, no solo para ese paciente:
  lo que hizo falta una vez casi siempre vuelve a hacer falta;
- **se concatena** al catálogo de `js/store.js`, nunca lo sustituye. Así una actualización
  del código no borra lo añadido, y lo añadido tampoco esconde una opción nueva que llegue
  con el catálogo;
- se inyecta en el DOM sin recargar la pantalla, porque el fisio puede llevar media
  valoración capturada y no hay autoguardado: añadir una opción no puede costar el trabajo
  de los últimos diez minutos.

### Catálogo de ejercicios editable

Desde *Mi cuenta → Catálogo de ejercicios*. Cada clínica trabaja con su material y sus
variantes, y la foto real vale bastante más que una miniatura genérica cuando el paciente
intenta acordarse del ejercicio en su casa, tres días después.

- Las fotos **sí se comprimen** (900 px, JPEG 72 %) y van al bucket público `ejercicios`.
  Al contrario que en el expediente: aquí es material didáctico, y una foto de 8 MB tarda en
  abrirse justo cuando el paciente la necesita, a mitad de su rutina.
- Al reemplazar una foto se retira la anterior del bucket —pero **solo si el guardado salió
  bien**, o el ejercicio quedaría sin imagen y sin forma de recuperarla—.
- **Eliminar uno que ya está en rutinas lo desactiva en vez de borrarlo.** Un borrado real
  dejaría un hueco en las rutinas ya entregadas. El borrado de verdad solo ocurre si no lo
  usa nadie.
- Los ejercicios nuevos nacen con id `ej_…`, nunca `ex_NN`, para no chocar jamás con un id
  que llegue en una actualización del catálogo base.

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

### Quitar de una rifa: dos operaciones distintas

Ninguna de las dos puede ser un `delete`, y por el mismo motivo: **los boletos se emiten
solos con cada asistencia**, así que `sincronizar_boletos` los repondría en el siguiente
guardado del sorteo y la persona volvería a entrar sin que nadie lo pidiera.

**Excluir a la persona** (todos sus boletos, y no se le emiten más) se guarda como un hecho
aparte, en la tabla `sorteo_excluidos`, que consultan tanto el trigger de emisión como la
sincronización.

**Anular UNA participación** —la asistencia que se registró por error, el boleto que salió
duplicado por un doble clic— marca ese boleto con `anulado_en` en lugar de borrarlo. La fila
se queda, el `unique (sorteo_id, asistencia_id)` sigue ocupado, y el `on conflict do
nothing` de la sincronización respeta la marca solo. `realizar_sorteo` ignora los anulados:
si un boleto anulado pudiera salir premiado, la anulación no habría servido de nada.

Las dos son reversibles: **Readmitir** repone los boletos de todas sus asistencias del
periodo, y **Devolver** limpia la marca de un boleto suelto. Con el ganador ya elegido la
lista pasa a solo lectura, porque a esas alturas quitar gente no cambiaría el resultado.

### La cascada que amarra todo

Registrar una asistencia dispara, en una sola operación:

1. Reordena la lista de pacientes (sube al primer lugar).
2. Descuenta una sesión del paquete.
3. Registra el ingreso, visible en la gráfica del dashboard.
4. Emite **un boleto por cada sorteo activo vigente**, visible de inmediato para el paciente.

Lo hace el trigger `trg_boletos_asistencia`, y `unique (sorteo_id, asistencia_id)` garantiza
la idempotencia desde la propia base de datos.

---

## 9 · Diagnóstico de errores 404

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

## 10 · Notas técnicas

- **Tailwind compilado**: ~32 KB, sin CDN ni advertencias en consola. Las clases nunca deben
  construirse por interpolación (`bg-${tono}-100` no se detecta al purgar): pásalas completas,
  como en `kpi(icono, valor, label, 'bg-emerald-100 text-emerald-700')`.
- **Sin scripts externos**: el cliente de Supabase se sirve desde el propio dominio, lo que
  permite mantener `script-src 'self'` en la CSP.
- **Cabeceras** en `_headers` (Cloudflare Pages): CSP, HSTS, `X-Frame-Options: DENY`,
  `Permissions-Policy` (cámara permitida solo al propio origen, para las fotos de pruebas).
  La CSP incluye `worker-src 'self'`: sin eso el navegador bloquea el registro de `/sw.js`
  y las notificaciones no se pueden activar, con un `SecurityError` que no menciona la CSP.
- **El service worker no cachea nada.** Es deliberado: un service worker que sirve archivos
  guardados es la forma más rápida de que el fisio siga viendo la versión de la semana
  pasada tras un despliegue, y aquí eso significaría trabajar sobre una agenda vieja. El
  caché lo gobiernan las cabeceras, donde se puede corregir sin esperar a que caduque nada.
  Vive en la raíz porque un service worker solo controla su propia carpeta hacia abajo.
- Router por hash, áreas táctiles ≥ 44 px, `env(safe-area-inset-*)` para el notch y
  `prefers-reduced-motion` respetado.
- Las fotos de evidencias se comprimen en el navegador (máx. 900 px, JPEG 72 %) y van al
  bucket privado `evidencias` con URL firmada.
- Los archivos del expediente (bucket privado `expedientes`) **no** se comprimen ni se
  convierten: un PDF no sobrevive a eso. El límite de 20 MB y los tipos admitidos se imponen
  en el cliente **y** en el propio bucket, para que no dependan del JavaScript.
- Los enlaces de WhatsApp son `wa.me` con el texto codificado; no hay integración con la API
  de negocio ni, por tanto, servidor intermedio que custodiar.
- **`telWhatsApp` está duplicado** en `js/ui.js` y en `worker/src/index.js`: son dos runtimes
  distintos y el Worker no puede importar un IIFE de navegador. Las dos copias se comprueban
  con los mismos casos (`scripts/test-funciones.js` y `worker/test/webpush.test.js`), que es
  lo que impide que se separen en silencio.
- **La idempotencia de los avisos es de la base**, no del código: la clave primaria
  `(tipo, cita_id)` de `avisos_enviados` es lo que garantiza que un recordatorio salga una
  sola vez aunque el cron de 5 minutos vea la misma cita en varias pasadas.
