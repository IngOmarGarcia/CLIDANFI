# Conservación de valoraciones y respaldo en Drive

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

## Activación (pendiente; no se ha desplegado)

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

Cada versión se guarda como un PDF legible con nombre:
`Nombre paciente - DD-MM-AAAA HH-mm-ss - Valoración inicial.pdf`.
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
