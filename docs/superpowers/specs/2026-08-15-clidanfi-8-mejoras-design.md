# CLIDANFI · Ocho mejoras al sistema de gestión

**Fecha:** 2026-08-15
**Estado:** aprobado, pendiente de plan de implementación

---

## 1 · Qué se pide

Ocho funciones nuevas o ampliadas:

| # | Función | Estado hoy |
|---|---|---|
| 1 | Recordatorio automático un día antes a las 18:00 | No existe |
| 2 | Opciones personalizadas en la valoración | No existe (listas congeladas en `js/store.js`) |
| 3 | Alta, edición y fotos de ejercicios | Tabla lista, interfaz inexistente |
| 4 | Rifas: eliminar por participación, no por persona | Existe lo contrario (`sorteo_excluidos`) |
| 5 | Paquete de sesiones opcional | Formulario lo precarga y lo fuerza |
| 6 | Cancelar cita con quién y por qué | Motivo existe; falta el quién y la obligatoriedad |
| 7 | Marcar falta al paciente | Estado y botón existen; falta explotarlos |
| 8 | Push al fisio 40 min antes de cada sesión | No existe |

## 2 · Punto de partida

Sitio estático (HTML + Tailwind compilado + JavaScript vanilla) con **Supabase como único backend**, desplegado en Netlify. No hay servidor propio, y los recordatorios por WhatsApp son deliberadamente manuales: enlaces `wa.me` que **siempre confirma una persona** antes de enviarse.

Reglas del proyecto que este diseño respeta:

- Ninguna vista consulta Supabase por su cuenta: todo pasa por `API.*`.
- El cliente se crea una sola vez, en `js/supabase-client.js`.
- Las reglas duras se imponen en PostgreSQL, no solo en el formulario.
- `npm run check` cruza `js/api.js` contra `supabase/schema.sql` y **detiene el despliegue** ante un desajuste.

## 3 · Decisiones tomadas

| Decisión | Elección | Por qué |
|---|---|---|
| Canal del recordatorio (#1) | Cola de WhatsApp para el fisio | Llega a todo paciente sin pedirle que instale nada ni pagar la API de negocio; conserva la confirmación humana |
| Destinatario del push | **Solo el fisioterapeuta** | Una persona, un dispositivo. Pedir a cada paciente que instale la PWA condenaría la función al desuso |
| Reloj | Supabase Edge Functions + `pg_cron` | Mantiene «Supabase como único backend»; no obliga a custodiar la `service_role` en Netlify |
| Rifas (#4) | Solo participación individual | Se retira la exclusión por persona |
| Opciones de valoración (#2) | Global, preguntando cada vez | El catálogo crece con el uso, pero sin ensuciarse con valores de un solo caso |
| Catálogo de ejercicios (#3) | La base manda; `store.js` se retira | Una sola fuente de verdad |
| Entrega | Tres etapas, cada una utilizable y desplegable sola | |
| Zona horaria | `America/Mexico_City` (Zacatecas, UTC−6 fijo) | Guardada como dato en `configuracion`, no cableada |

**Consecuencias aceptadas explícitamente:**

- Al retirar `sorteo_excluidos`, sacar a alguien con muchas asistencias pasa a ser boleto por boleto, y su siguiente asistencia le vuelve a emitir boleto. Es lo que significa «por participación».
- El push no llega en iPhone si la app no está agregada a la pantalla de inicio (iOS 16.4+). La cola de WhatsApp es la red de seguridad que no depende del push.

---

# Etapa 1 · Base de datos e interfaz

Sin infraestructura nueva. Utilizable y desplegable por sí sola.

## 1.1 · Cancelación con bitácora (#6)

`citas` gana tres columnas, con `add column if not exists` como el resto del esquema:

| Columna | Tipo | Para qué |
|---|---|---|
| `cancelada_por` | `text` con `check in ('paciente','fisioterapeuta','clinica','otro')` | Quién decidió cancelar |
| `cancelada_por_nombre` | `text` | A quién exactamente, cuando fue un tercero |
| `cancelada_por_usuario` | `uuid references auth.users(id)` | Qué cuenta pulsó el botón. Auditable aunque mañana cambie el personal |

Ya existen `cancelada_en` y `motivo_cancelacion`; se conservan.

La obligatoriedad se impone **en la base**, no solo en el formulario, siguiendo la línea de `citas_precio_no_negativo` y `pagos_monto_no_negativo`:

```sql
alter table citas add constraint citas_cancelacion_documentada
  check (estado <> 'cancelada'
         or (coalesce(motivo_cancelacion, '') <> '' and cancelada_por is not null));
```

**Interfaz** — la hoja de cancelación (`js/views-therapist.js:2124`) pasa a tener:

- selector obligatorio de quién canceló;
- campo de nombre, visible solo si se eligió «otro»;
- motivo obligatorio (texto no vacío tras recortar espacios);
- botón inhabilitado hasta que ambos estén completos.

**Capa de datos** — `API.cancelarCita(id, { quien, quien_nombre, motivo, avisado })` rechaza motivo vacío o `quien` nulo **antes de salir a la red**, y rellena `cancelada_por_usuario` con la sesión activa.

> **Migración:** las citas ya canceladas no cumplen la restricción nueva. El script debe rellenarlas antes de añadirla:
> `update citas set cancelada_por = 'otro', motivo_cancelacion = 'Sin registro (anterior a la bitácora)' where estado = 'cancelada' and (cancelada_por is null or coalesce(motivo_cancelacion,'') = '');`
> Sin este paso, `alter table … add constraint` falla y el esquema deja de ser idempotente.

## 1.2 · Control de faltas (#7)

El estado `no_asistio` y su botón ya existen (`js/views-therapist.js:2029`). Lo que falta es explotarlos.

**Una falta no descuenta sesión del paquete.** Ya es así por construcción: el descuento vive en el trigger `emitir_boletos_por_asistencia`, que solo se dispara al insertar en `asistencias`, y una falta no crea fila de asistencia. **No se cambia nada; se documenta en el esquema** para que nadie lo «arregle» por error más adelante.

Cambios:

- La vista `pacientes_ordenados` gana `total_faltas` y `total_canceladas`, por `lateral join` contra `citas`, igual que ya hace con `ultima_asistencia`.
- Distintivo en la lista de pacientes y en la cabecera de la ficha cuando hay faltas.
- Al marcar la falta se puede añadir una nota opcional, que se guarda en `citas.notas`.
- El historial del paciente pasa a mostrar asistencias, faltas y cancelaciones en la misma línea de tiempo, cada una con su color.

## 1.3 · Paquete opcional (#5)

Nada en el esquema obliga a tener paquete: `paquete_total` admite `0` y el alta exprés ya lo usa. Lo que fuerza el paquete es el formulario, que precarga «Paquete 10 sesiones / 10» (`js/views-therapist.js:1672-1675`).

- Interruptor **«Tiene paquete contratado»**, apagado por defecto en pacientes nuevos y encendido si el paciente ya tiene `paquete_total > 0`.
- Apagado guarda `paquete_total = 0`, `paquete_usadas = 0`, `paquete_nombre = ''`, `paquete_vence = null`, y oculta esos campos.
- La ficha muestra **«Sin paquete · se cobra por sesión»** en lugar de un anillo de progreso «0 de 0» (`js/views-therapist.js:799-807`).
- El portal del paciente hace lo propio (`js/views-patient.js`).

## 1.4 · Rifas por participación individual (#4)

**El problema:** borrar un boleto no es durable. Los emite el trigger `trg_boletos_asistencia` y `sincronizar_boletos` los repone en el siguiente guardado del sorteo. La anulación tiene que ser un hecho aparte — el mismo razonamiento que hoy justifica `sorteo_excluidos`, pero al grano fino de un boleto.

```sql
create table if not exists boletos_anulados (
  sorteo_id     uuid not null references sorteos(id) on delete cascade,
  asistencia_id uuid not null references asistencias(id) on delete cascade,
  motivo        text default '',
  anulado_por   uuid references auth.users(id),
  creado_en     timestamptz not null default now(),
  primary key (sorteo_id, asistencia_id)
);
```

Se ancla a `asistencia_id`, **no** a `boleto_id`: el boleto se borra, y hay que recordar qué participación quedó anulada para no reponerla.

**Cambios en cadena:**

1. `emitir_boletos_por_asistencia` deja de consultar `sorteo_excluidos` y consulta `boletos_anulados`. Una asistencia nueva no tiene lápida, así que emite con normalidad.
2. `sincronizar_boletos` hace lo mismo: el `not exists` del insert y el bloque `del2` pasan a `boletos_anulados`.
3. Función nueva `anular_boleto(p_boleto uuid, p_motivo text)` — solo fisio; en una sola transacción escribe la lápida y borra el boleto.
4. Función nueva `restaurar_boleto(p_sorteo uuid, p_asistencia uuid)` — solo fisio; borra la lápida y reemite el boleto.
5. **Migración antes de retirar:** las filas de `sorteo_excluidos` se convierten en lápidas por cada asistencia de esa persona dentro del periodo del sorteo, y después se retira la tabla. Sin este paso se perderían las exclusiones ya hechas.
6. `js/api.js` pierde `excluirDeSorteo`, `readmitirEnSorteo` y `excluidosDeSorteo` (y sus entradas en la matriz de autorización y en el export). Si se quedan, `npm run check` detiene el despliegue por apuntar a una tabla inexistente.
7. `API.participantesDeSorteo` pasa a devolver, por persona, la lista de boletos **con su `id` y su `asistencia_id`**, no solo el código.
8. Función nueva `API.anuladosDeSorteo(sorteoId)`.

**Interfaz** (`js/views-therapist.js:2493-2615`) — la lista de participantes deja de ser una fila por persona con un botón «quitar». Pasa a ser la persona con **sus boletos listados, cada uno con su ✕**, más una sección de anulados con «restaurar». Con ganador ya elegido la lista sigue siendo de solo lectura, como hoy.

**Documentación** — README §7 «Excluir a alguien de una rifa» se reescribe: ya no describe el comportamiento real.

---

# Etapa 2 · Catálogos editables

## 2.1 · Opciones personalizadas en la valoración (#2)

Las 13 secciones viven congeladas en `js/store.js`. Los tipos de campo con lista son `select`, `checks` y `tests`; `rom` y `mmt` tienen listas de filas (`rows`). Los cinco admiten opciones nuevas.

```sql
create table if not exists valoracion_opciones (
  id          uuid primary key default gen_random_uuid(),
  seccion_key text not null,               -- 'antecedentes'
  campo_key   text not null,               -- 'patologicos'
  valor       text not null,               -- 'Fibromialgia'
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (seccion_key, campo_key, valor)
);
create index if not exists idx_valoracion_opciones on valoracion_opciones(seccion_key, campo_key);
```

RLS: escritura solo fisio (`fisio_total`); lectura para cualquier autenticado.

**Los dos caminos.** Cada lista gana un **«+ Agregar opción»**. Tras escribir el valor, una hoja pregunta *«¿Guardar para futuros pacientes, o solo para este?»*:

- **Para futuros** → fila en `valoracion_opciones`. El renderizador funde las `options` de `Store.SECCIONES_VALORACION` con lo que traiga la tabla para esa sección y campo.
- **Solo para este** → no toca la tabla. El valor se guarda dentro de `valoraciones.datos[seccion][campo]` como cualquier otro.

**La pieza que hace funcionar el segundo camino sin tabla:** el renderizador (`js/views-therapist.js:1216`) debe pintar como opción marcada **cualquier valor guardado que no esté en el catálogo**. Sin eso, reabrir la valoración perdería en silencio lo capturado — inaceptable en un expediente clínico. Aplica a `checks`, `select` y `tests`, y a las filas de `rom` y `mmt`.

**Eliminar una opción global es un apagado suave** (`activo = false`): desaparece de los formularios nuevos y **jamás reescribe valoraciones ya guardadas**.

Funciones nuevas: `API.opcionesValoracion()`, `API.agregarOpcionValoracion(seccion, campo, valor)`, `API.desactivarOpcionValoracion(id)`.

## 2.2 · Ejercicios: alta, edición y fotos (#3)

**La base manda.** `CATALOGO_EJERCICIOS`, `CATEGORIAS_EJERCICIO` y `Store.ejercicio()` se retiran de `js/store.js`; los 22 ejercicios quedan solo como semilla en `schema.sql` (donde ya están, sección 15).

Puntos de uso a migrar: `js/api.js:957` y `js/views-therapist.js` líneas 1355, 1400, 1421, 1475 y 1510. El generador de rutinas pasa a cargar el catálogo de forma asíncrona.

`ejercicios` gana `creado_en` y `actualizado_en`. Las categorías se derivan de las que existan en la base (`select distinct categoria`), con la lista actual como sugerencias y campo libre para inventar una nueva.

**Hueco de permisos que hay que tapar:** el bucket `ejercicios` existe y es público, pero en `schema.sql:658` **solo tiene política de lectura**. No hay `insert`, `update` ni `delete`. Tal como está hoy, el fisio no podría subir ni una foto. Se añaden las tres para `es_fisio()`.

Funciones nuevas: `API.listarEjercicios({ incluirInactivos })`, `API.guardarEjercicio(datos)`, `API.subirFotoEjercicio(id, dataUrl)`, `API.desactivarEjercicio(id)`.

**Borrar un ejercicio es siempre suave** (`activo = false`), nunca físico: `rutina_items.ejercicio_id` lo referencia con clave foránea y un borrado real rompería las rutinas históricas de todos los pacientes que lo tuvieran.

**Fotos** — se comprimen en el navegador igual que las evidencias (máx. 900 px, JPEG 72 %). Al reemplazar una, se borra el objeto anterior del bucket para no acumular basura. `image_url` guarda la URL pública, porque el bucket `ejercicios` es público por diseño (el paciente ve su rutina).

## 2.3 · Borrar evidencias de una nota ya guardada

Comportamiento verificado en el código actual:

- Las evidencias **se acumulan, no se reemplazan**: `API.agregarAdjunto` (`js/api.js:839`) hace `[...(nota.adjuntos || []), nuevo]`, y la subida usa `upsert: false` con ruta de identificador único (`js/api.js:819`). Correcto, no se toca.
- Solo se puede quitar una foto **antes de guardar la nota** (`js/views-therapist.js:2310`, `splice` sobre el arreglo local). Una vez guardada no hay forma de borrar una evidencia suelta: la única salida es eliminar la nota entera.
- `API.eliminarNota` (`js/api.js:843`) borra la fila pero **deja los binarios huérfanos en el bucket `evidencias`**.

Cambios:

- `API.eliminarAdjunto(notaId, adjuntoId)` — quita la entrada del arreglo **y** borra el objeto del bucket. La política `"fisio borra evidencias"` (`schema.sql:654`) ya existe.
- En el historial (`js/views-therapist.js:1047`), cada miniatura de una nota guardada gana su ✕ **con confirmación**: borrar una evidencia clínica no debe ser un toque accidental.
- `API.eliminarNota` barre las rutas de sus adjuntos antes de borrar la fila.

**Criterio, deliberadamente distinto en cada apartado:**

| | Evidencias (notas) | Fotos de ejercicios |
|---|---|---|
| Al agregar | Se acumulan | Reemplaza la anterior |
| Al borrar | Una por una, con confirmación | Se cambia o se quita libremente |
| Por qué | Registro clínico de una sesión: el historial de una lesión es la secuencia completa | Material didáctico: solo importa la foto vigente |

---

# Etapa 3 · PWA, push y recordatorios

La única etapa con infraestructura nueva. Hoy no existe ni `manifest`, ni service worker, ni nada que corra sin el navegador abierto.

## 3.1 · Piezas nuevas en el repositorio

- `manifest.webmanifest` y `sw.js` en la raíz, **añadidos a `scripts/build.js`** (que hoy no los copiaría a `dist/`).
- El service worker atiende **solo** `push` y `notificationclick`. **Sin caché offline, a propósito:** en una app con router por hash, la caché es la vía rápida a que alguien vea una versión vieja tras un despliegue sin entender por qué.
- `netlify.toml:37` necesita `worker-src 'self'` en la CSP. Sin eso el navegador rechaza el service worker en silencio.
- El registro del service worker vive en `js/app.js`, junto a la guardia de sesión.

## 3.2 · Base de datos

```sql
create table if not exists push_suscripciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text default '',
  creado_en   timestamptz not null default now()
);

create table if not exists recordatorios (
  id         uuid primary key default gen_random_uuid(),
  cita_id    uuid not null references citas(id) on delete cascade,
  tipo       text not null check (tipo in ('wa_dia_previo', 'push_40min')),
  estado     text not null default 'pendiente'
             check (estado in ('pendiente', 'enviado', 'omitido')),
  enviado_en timestamptz,
  creado_en  timestamptz not null default now(),
  unique (cita_id, tipo)
);
```

`unique (cita_id, tipo)` es lo que hace el sistema idempotente: si el cron corre dos veces no salen dos recordatorios. Es el mismo recurso que ya usa `unique (sorteo_id, asistencia_id)` en `boletos`.

`configuracion` gana `zona_horaria text not null default 'America/Mexico_City'` — Zacatecas, zona Centro, UTC−6 fijo desde que México suprimió el horario de verano en 2022. Va como dato para que un cambio de sede no exija tocar código.

RLS: ambas tablas solo fisio, salvo que cada usuario pueda insertar y borrar **su propia** suscripción push.

## 3.3 · Los dos relojes (`pg_cron` + `pg_net`)

| Trabajo | Cadencia | Qué hace |
|---|---|---|
| `recordatorios_dia_previo` | Diario, 18:00 local | Crea las filas `wa_dia_previo` de las citas `agendada` de mañana y manda **un push al fisio**: «5 recordatorios listos para enviar» |
| `push_sesion_40min` | Cada 5 minutos | Busca citas `agendada` que arranquen dentro de 38–43 min sin push enviado y avisa al fisio |

La ventana de 38–43 min es deliberadamente ancha: si el cron se retrasa un minuto, el aviso sale igual en vez de perderse.

`pg_cron` programa en UTC. Los trabajos convierten contra `configuracion.zona_horaria` en lugar de cablear el desfase, que se rompería solo ante un cambio de sede o de política horaria.

Requisitos en Supabase: extensiones `pg_cron` y `pg_net` activadas (Database → Extensions).

## 3.4 · Edge Function `enviar-push`

Deno, Web Push sobre VAPID.

- La llave **pública** viaja en `js/env.js` vía `scripts/generate-env.js`, que ya valida variables de entorno.
- La llave **privada** vive solo como secreto de la Edge Function. Nunca toca el repositorio ni `dist/`.
- Una suscripción que devuelva `404` o `410` se borra de `push_suscripciones`: el navegador la revocó y reintentar es ruido.

`scripts/build.js` aborta el despliegue si encuentra un JWT privilegiado en lo publicado. Las llaves VAPID no son JWT, así que no interfieren, pero conviene comprobarlo al integrar.

## 3.5 · Recordatorio de las 18:00 en pantalla (#1)

A las 18:00 la cola queda armada sola. El fisio abre **Agenda → Recordatorios** y ve la lista de mañana. Cada fila:

- **Enviar** → abre `wa.me` con el texto ya redactado y marca `enviado`;
- **Omitir** → marca `omitido`, para quien ya confirmó por otro medio.

Se apoya en la pantalla de tanda que ya existe (README §7), pero **leyendo de `recordatorios`** en vez de recalcular al vuelo: así queda constancia de a quién se avisó y no se manda dos veces.

**Citas que cambian después de armarse la cola.** Es el caso que más importa acertar: sería inaceptable mandar un recordatorio a quien acaba de cancelar. La cola cruza siempre contra el estado **actual** de la cita, no contra el que tenía a las 18:00:

- cita ya no `agendada` → la fila se muestra tachada, con su estado, y **el botón de enviar queda inhabilitado**;
- cita reagendada a otro día → misma regla, con la hora nueva a la vista, para que el fisio decida;
- cita eliminada → la fila desaparece sola, por el `on delete cascade` de `cita_id`.

Los teléfonos inutilizables se siguen marcando como hoy, vía `telWhatsApp` (`js/ui.js`).

## 3.6 · Activación del push (#8)

En **Mi cuenta**, un botón «Activar avisos en este dispositivo»: registra el service worker, pide permiso al navegador y guarda la suscripción. Junto a él, el estado actual y un botón para desactivar.

**Dos límites que la interfaz debe decir en voz alta, no esconder:**

- **En iPhone solo funciona con la app agregada a la pantalla de inicio** (iOS 16.4+). En Android y escritorio funciona sin instalar. Si se detecta iOS sin instalar, se explica el paso en lugar de fallar en silencio.
- Si el teléfono está apagado o sin datos, el aviso llega **cuando vuelva**, tarde. Un push no es una alarma del teléfono. Por eso la cola de WhatsApp de #1 no depende del push.

---

# 4 · Verificación

Cada etapa se da por terminada cuando `npm test` pasa entero — que encadena `check-schema`, `test-esquema`, `test-subidas` y `test-funciones`.

| Etapa | Qué hay que añadir a las pruebas |
|---|---|
| 1 | Cancelar sin motivo o sin quién debe ser rechazado **por la base**. Anular un boleto y correr `sincronizar_boletos`: no debe reponerse. Restaurarlo: debe volver. Una falta no altera `paquete_usadas`. Paciente sin paquete no rompe la ficha |
| 2 | Una opción global aparece en el formulario siguiente. Un valor ad-hoc guardado se vuelve a pintar al reabrir. Desactivar una opción no altera valoraciones pasadas. Desactivar un ejercicio no rompe rutinas que lo usan. Borrar un adjunto retira también el objeto del bucket |
| 3 | `unique (cita_id, tipo)`: correr el cron dos veces no duplica recordatorios. Una cita cancelada tras armarse la cola no se puede enviar. Una suscripción caducada se borra sola. La conversión de zona horaria cae en la hora local correcta |

`npm run check` cruza `js/api.js` contra `supabase/schema.sql`, así que **retirar las tres funciones de exclusión de rifas no es opcional**: si se quedan, el despliegue se detiene.

# 5 · Documentación a actualizar

- **README §7 «Excluir a alguien de una rifa»** — describe un comportamiento que dejará de existir.
- **README §7 «Recordatorios por WhatsApp»** — afirma que no hay servidor intermedio; pasará a haber Edge Functions.
- **README §4** — dice que el catálogo de 22 ejercicios vive en `js/store.js`.
- **README §6 (estructura) y §9 (notas técnicas)** — archivos nuevos y CSP.
- **Cabecera de `supabase/schema.sql`** — tablas nuevas y extensiones requeridas.
- **Puesta en marcha** — `pg_cron`, `pg_net`, llaves VAPID y despliegue de la Edge Function.

# 6 · Orden y dependencias

Las tres etapas son independientes entre sí y cada una es desplegable sola. Dentro de cada una, el esquema va primero: la capa de datos y las vistas dependen de él.

La Etapa 3 es la única que exige pasos manuales fuera del repositorio (activar extensiones, generar llaves VAPID, desplegar la función con el CLI de Supabase); conviene reservarle una ventana propia.
