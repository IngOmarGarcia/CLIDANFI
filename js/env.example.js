/* ==========================================================================
   CLIDANFI · env.example.js  →  plantilla de configuración
   --------------------------------------------------------------------------
   `js/env.js` es un archivo GENERADO. No lo edites a mano ni lo subas a git
   (está en .gitignore).

   · En Netlify lo genera `scripts/generate-env.js` durante el build a partir
     de las variables de entorno del sitio.
   · En local, cópialo tú:

         cp js/env.example.js js/env.js      (Windows: copy js\env.example.js js\env.js)

     y rellena los valores de tu proyecto.

   SOBRE LA SEGURIDAD DE LA ANON KEY
   ---------------------------------
   La `anon key` es PÚBLICA por diseño: viaja al navegador en cualquier app
   web de Supabase y no es un secreto. Lo que protege los datos NO es ocultar
   esta llave, sino las políticas RLS de `supabase/schema.sql`.

   Usar variables de entorno sirve para no dejar credenciales escritas en el
   repositorio y para cambiar de proyecto (staging/producción) sin tocar código.

   ⚠ NUNCA pongas aquí la `service_role key`: esa sí ignora RLS y daría acceso
     total a la base de datos a cualquiera que abra el navegador.
   ========================================================================== */
window.CLIDANFI_ENV = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: ''
};
