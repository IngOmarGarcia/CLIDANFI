# Conservación de valoraciones y respaldo en Drive

## Estadísticas e informes generales de citas

Las gráficas de agenda y ficha cuentan solo citas `completada`, por fecha de
atención en `America/Mexico_City`. La ficha muestra años, meses del año elegido
y última sesión completada. Sus estadísticas se consultan únicamente en el
sistema, sin generar documentos individuales en Drive. En la agenda, las barras
abren el listado de pacientes únicos con su cantidad de sesiones en ese periodo.
Las semanas parciales se limitan al mes seleccionado.

Al publicar el Worker, se guardan PDF mensuales (una vez cerrado el mes)
y anuales (una vez cerrado el año) en `Reportes generales`. Incluyen
totales por semana del mes o por mes del año y gráfico de barras, sin nombres, identificadores ni listas
de pacientes. Se recuperan también los periodos cerrados desde la primera cita
completada existente, incluidos periodos sin sesiones entre medias.

Las barras de la interfaz se cargan al entrar en pantalla una sola vez por periodo
y paciente durante la visita. Después conservan un brillo suave, pausado fuera
de pantalla. El listado se ordena por cantidad de sesiones y lleva barras detrás
del nombre. `prefers-reduced-motion` muestra los valores inmediatamente y elimina
el movimiento. Los PDF permanecen estáticos.

Cada periodo tiene una clave estable en Drive. Los reintentos reutilizan el
archivo; si se corrige una cita histórica, el PDF del periodo afectado se actualiza
conservando el ID y el enlace. Las ejecuciones sin cambios no generan archivos.
Se procesan hasta dos informes por pasada con el presupuesto que quede después
de respaldar expedientes. `[drive].informes` informa guardados, actualizados,
errores o trabajo diferido. No requiere otra migración SQL.

## Hallazgos

El código no contiene borrados mensuales de valoraciones. La consulta muestra
solo la última valoración por paciente, sin filtro de mes. El formulario edita
esa fila: anteriormente no existía un historial de su contenido. Además,
eliminar un paciente borra sus valoraciones mediante ON DELETE CASCADE.
Esto no permite atribuir las filas faltantes a una causa sin revisar producción.

`supabase/diagnostico-valoraciones.sql` contiene consultas de solo lectura para
contar filas por mes y revisar triggers y políticas. Revisar también las tareas
de pg_cron, filtros activos del Table Editor, proyecto/esquema seleccionado,
logs de borrado y respaldos anteriores. No ejecutar seed.sql para recuperar datos.

## Activación del respaldo de valoraciones

1. Exportar la base actual. Ejecutar `supabase/valoraciones-respaldo.sql` en SQL
   Editor. Es transaccional y repetible. Conserva las filas actuales, captura
   cada guardado futuro en la misma transacción y bloquea DELETE de valoraciones,
   incluyendo el que procede de eliminar un paciente. Desactivar pacientes en
   lugar de eliminarlos. No protege contra un administrador que ejecute TRUNCATE,
   borre tablas o desactive los triggers.
2. En Google Cloud habilitar Drive API y crear un cliente OAuth de aplicación
   web. Autorizar con **clidanfi@gmail.com**, alcance
   `https://www.googleapis.com/auth/drive.file`, acceso offline y consentimiento.
   Obtener el refresh token usando ese mismo cliente. No enviar tokens por chat.
   Revisar el estado de publicación del consentimiento: en modo Testing los
   refresh tokens pueden caducar; configurar el proyecto para uso permanente.
3. Guardar en secretos del Worker, desde `worker/`:

   ```powershell
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put GOOGLE_REFRESH_TOKEN
   ```

   También necesita el secreto existente `SUPABASE_SERVICE_ROLE_KEY`.
   Nunca poner esas credenciales en js/env.js ni en Git.
4. Opcional: configurar `GOOGLE_DRIVE_FOLDER_ID` con una carpeta accesible para
   ese cliente OAuth (seleccionada/autorizada con Drive Picker o creada por la
   propia aplicación). Sin carpeta, crea los respaldos en Mi unidad.
5. Publicar frontend y Worker solamente cuando el propietario lo autorice.
   El cron existente procesa hasta diez versiones por ejecución; reintenta
   errores tras quince minutos, sin impedir guardar la valoración en Supabase.
   Los avisos push y el respaldo se ejecutan de forma independiente.

## Resultado y verificación

### Carpetas por paciente

El Worker guarda todos los PDF y adjuntos del expediente en una carpeta con el
nombre del paciente. Reutiliza una carpeta existente si hay una sola coincidencia
exacta visible para el cliente OAuth y un solo paciente con ese nombre. Después
la identifica por `appProperties.clidanfi_paciente` (UUID), por lo que las ediciones
y los cambios de nombre no dispersan los respaldos en carpetas distintas.
Si no hay carpeta, la crea en `GOOGLE_DRIVE_FOLDER_ID` o en Mi unidad.
Los nombres duplicados o carpetas vinculadas a otro paciente dejan el respaldo
pendiente con un error, para resolver la asociación sin mezclar expedientes.

Al publicar el Worker, las copias antiguas se organizan progresivamente (hasta
dos por ejecución, cuando hay presupuesto después de las subidas). Se mueve el
mismo archivo usando `addParents` y `removeParents`: mantiene su ID y enlace.
Solo se procesan archivos con metadatos de CLIDANFI, sin deducir la identidad
del paciente a partir del nombre del archivo. El resultado aparece en
`[drive].carpetas`. No hace falta otra migración de Supabase.

Con el alcance `drive.file`, las carpetas creadas manualmente deben estar
autorizadas para el mismo cliente OAuth (por ejemplo, seleccionadas con Drive
Picker); la app no puede detectar una carpeta que Google no le permite ver.
Verificar esa visibilidad antes de activar para evitar crear una carpeta paralela.
No se amplían los permisos OAuth ni se modifica la compartición desde el Worker.

Referencias: [carpetas y movimientos](https://developers.google.com/workspace/drive/api/guides/folder),
[búsqueda por propiedades](https://developers.google.com/workspace/drive/api/guides/search-files).

Cada versión se guarda como un PDF legible con nombre:
`HC Nombre paciente - DD-MM-AA HH-mm-ss.pdf`.
Las ediciones llevan ` - Actualizado` antes de la fecha.
El nombre usa la fecha de cada guardado en Ciudad de México; la hora distingue
ediciones. El UUID se conserva en metadatos privados, sin aparecer en el nombre.
Los respaldos anteriores adoptan el nuevo nombre automáticamente.
Incluye nombre, identificadores, fecha del guardado, secciones y datos clínicos.
Las fechas dentro del documento se muestran en hora de Ciudad de México.
Los JSON anteriores se convierten automáticamente en PDF conservando el ID y
el enlace del archivo en Drive. No requiere otra migración de Supabase.
Cada edición crea una copia adicional; no sobrescribe respaldos anteriores.
La cuenta autorizada se verifica antes de procesar. Los archivos no se comparten
públicamente. Un identificador privado permite recuperar una subida anterior
cuando falla la confirmación en Supabase, evitando duplicados en reintentos.

Crear y editar una valoración de prueba, esperar el cron y comprobar dos
versiones en Supabase y Drive. Revisar `[drive]` en logs del Worker y las columnas
`drive_archivo_id`, `intentos`, `ultimo_error` y `reintentar_en` de
`valoraciones_versiones`. El historial de la ficha muestra el estado de respaldo.
Un fallo de autorización aparece en logs y deja la cola intacta.

Esto conserva información existente y futura. No recupera filas ya eliminadas:
para ellas se necesita una copia anterior o recuperación disponible en Supabase.

Referencias oficiales:
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/guides/properties
- https://developers.google.com/identity/protocols/oauth2/web-server#offline

## Ampliación a todos los documentos del expediente

**Orden de instalación:** ejecutar `supabase/documentos-respaldo.sql` en el SQL
Editor del mismo proyecto, después de `valoraciones-respaldo.sql`. Luego publicar
el Worker y el frontend. La migración es transaccional, repetible y no borra datos.
El frontend nuevo utiliza `guardar_rutina_completa`: no publicarlo antes del SQL.
El Worker conserva el respaldo de historias incluso si aún falta esta migración;
en ese caso informa el error de la nueva cola en `[drive].documentos.error`.

Se incluyen fichas, notas de evolución, rutinas completas con ejercicios e
indicaciones y recibos como PDF. Las citas están excluidas. Los estudios, informes, consentimientos
y demás archivos del expediente conservan sus bytes y extensión originales.
También se copian por separado las fotos de las evoluciones desde `evidencias`.
Los enlaces externos de una nota se conservan como referencias en el PDF, sin
descargar recursos de servidores externos. El catálogo de ejercicios y la marca
de la clínica no son documentos de pacientes ni forman parte de esta cola.

Ejemplos (hora de Ciudad de México):

- `HC Omar García - Actualizado - 19-10-26 20-00-00.pdf`
- `Evol. Omar García - 19-10-26 20-00-00.pdf`
- `Rutina Omar García - Actualizado - 19-10-26 20-05-00.pdf`
- `Estudio Omar García - Rodilla - 19-10-26 20-10-00.jpg`
- `Evid. Omar García - Movilidad - 19-10-26 20-15-00.jpg`

La primera instalación encola también los documentos existentes. Las versiones
anteriores a instalar la ampliación solo pueden recuperarse si ya había otra
copia. El historial nuevo es independiente de las filas originales y queda
restringido a fisioterapeutas para lectura; únicamente el Worker procesa la cola.
Cada edición crea un archivo distinto. Los reintentos recuperan PDFs y adjuntos
ya subidos por su identificador privado; una nota solo se confirma como respaldada
cuando también terminaron sus adjuntos. El cron procesa diez documentos por
ejecución, además de diez historias; una cola inicial grande tarda varias pasadas.

Los archivos ya respaldados se renombran automáticamente, hasta seis por pasada,
sin cambiar sus enlaces. La versión más antigua de cada historia es la inicial;
las posteriores reciben `Actualizado`. No se comparte ningún archivo públicamente.
Para instalaciones anteriores, ejecutar `supabase/excluir-citas-respaldo.sql`
desactiva el trigger de citas y cancela su cola sin tocar la agenda. El Worker
también las excluye, cancela las subidas pendientes y manda a la papelera de
Drive las copias de citas que ya se habían subido, tres por ejecución.
Cada ejecución reserva margen de subpeticiones de Cloudflare: los documentos
y adjuntos que no caben continúan en el próximo cron sin duplicar lo ya subido.

Verificar después de instalar y publicar:

```powershell
node scripts/audit-respaldos.cjs
```

Consultar `documentos_versiones`: `origen`, `numero`, `drive_archivo_id`,
`intentos`, `ultimo_error` y `reintentar_en`. Revisar los logs `[drive]` del Worker.
Los binarios se leen de Storage durante el cron: no borrar el objeto original
antes de terminar su respaldo. Las fotos o archivos que ya faltaban en Storage
no se pueden reconstruir desde sus metadatos.
