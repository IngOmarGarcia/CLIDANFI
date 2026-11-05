# CLIDANFI sin conexión

La aplicación instalada utiliza un service worker para sus recursos e IndexedDB
para los datos clínicos. La preparación inicial requiere conexión y una sesión
válida. Su progreso y la última preparación completa aparecen en Mi cuenta →
Almacenamiento y archivos sin conexión. Cerrar la aplicación durante una primera
preparación puede dejar información pendiente de descargar.

## Cuenta y dispositivo

Las copias y la cola se separan por usuario y rol. Reiniciar o cerrar el navegador
no las elimina. Se conserva la sesión previamente iniciada para arrancar sin red;
cerrar sesión impide volver a entrar sin autenticarse con conexión. No se almacena
la contraseña y no se implementa un PIN adicional. En dispositivos compartidos se
debe cerrar la sesión y utilizar el bloqueo del dispositivo.

Los permisos del servidor se siguen comprobando con RLS al sincronizar. Un cambio
de permisos remoto no puede conocerse mientras el dispositivo está desconectado.

## Información disponible

La preparación recorre los pacientes permitidos y guarda agenda, expedientes,
notas, valoraciones, historiales y otros datos utilizados por las pantallas.
Los PDF generados en Drive no se descargan como sustituto del texto clínico.
Los archivos adjuntos de los últimos siete días se descargan automáticamente.
Los archivos anteriores se pueden descargar por intervalos de meses o todos con
un solo botón. El tamaño se consulta a partir de sus metadatos, sin descargar el
contenido. Cuando no se conoce se muestra un mínimo o «tamaño por calcular».
Las copias descargadas permanecen hasta que el usuario las retire. La semana es
una ventana de descarga automática, no una regla de borrado automático.

La agenda sin conexión es una copia de la última información recibida. Crear o
modificar citas, asistencias, pagos, configuración y las demás operaciones no
incluidas en la cola requieren conexión.

Se pueden crear pacientes, notas, valoraciones y adjuntos, y editar
valoraciones previamente disponibles. El contenido de las notas guardadas no se
puede editar; únicamente se puede corregir su fecha de atención. Se guardan primero en IndexedDB, incluso
con conexión. La cola mantiene identificadores estables para evitar duplicados
si se pierde la respuesta del servidor. Los conflictos se conservan, se muestran
en el perfil y permiten exportar el trabajo o guardar la edición como un registro
nuevo conservando el registro del servidor.

## Descargas y limpieza

El espacio ocupado usa la estimación del navegador para todo el sitio en ese
dispositivo, incluidas las cuentas y la aplicación. Si no está disponible, estima
los datos de la cuenta. Los conteos de descargados y por descargar corresponden
solo a la cuenta activa. Los archivos por subir están en una cola
separada y nunca se eliminan mediante la limpieza de descargas.

Retirar archivos por fechas solo elimina sus binarios locales. Una marca evita
volver a descargarlos automáticamente. Su texto, metadatos, copias remotas y
copias de otros dispositivos se conservan. La descarga manual retira esa marca.

Se puede solicitar almacenamiento persistente desde el perfil. La decisión final
pertenece al navegador. Borrar los datos del sitio, ciertos procesos de limpieza,
la desinstalación o la pérdida del dispositivo pueden eliminar información no
sincronizada. No se garantiza la sincronización con la aplicación cerrada.

## Actualizaciones y validación

En instalaciones que ya habilitaron el editor de notas, aplicar
`supabase/desactivar-edicion-notas.sql` al publicar para retirar también el permiso
del endpoint anterior. La corrección de fecha conserva su operación independiente.

El build genera una lista y una versión de recursos. La nueva aplicación se
activa tras cerrar las pestañas de la versión anterior, para evitar mezclar
recursos o interrumpir formularios. En localhost se actualiza sin esa espera y
se prioriza la red; sin conexión continúa disponible la copia preparada.

El aviso de conexión es verde durante cuatro segundos al abrir o reconectar.
Sin conexión permanece amarillo y muestra la última conexión conocida: «Hoy»,
«Ayer», el día completo si fue esta semana, o la fecha para registros anteriores.

Pruebas: `npm run test:offline`, `npm test`, `npm run build` y después
`npm run test:offline-browser`. La prueba del navegador utiliza Edge instalado,
un servidor local y datos simulados; no escribe en Supabase ni Drive. Las capturas
se guardan en `output/offline-review/`. Falta verificar con dispositivos físicos
y una cuenta de pruebas antes del despliegue de producción.
