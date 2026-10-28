# CLIDANFI · Diseño responsivo de escritorio

**Fecha:** 2026-08-25
**Estado:** aprobado

## Problema

La interfaz se muestra como una pantalla de celular centrada incluso en PC. En pantallas
≥900 px el marco se convierte en un dispositivo sobre fondo oscuro con marca de agua. Eso
**no es un descuido**: es una decisión deliberada, documentada en el README §288. Este
diseño la revierte para las pantallas con sesión iniciada.

El compromiso central: **en móvil no cambia nada**. Es el criterio de aceptación, no un
deseo.

## Dónde vive la restricción de ancho

Solo cinco sitios, lo que hace que el ensanchado sea quirúrgico:

| Sitio | Qué es | Destino |
|---|---|---|
| `index.html:45` | `.app-frame` | Ancho completo con sesión; marco solo sin sesión |
| `index.html:83` | `#bottom-nav` | Oculto en `lg:`, sustituido por barra lateral |
| `js/ui.js:393` | Panel deslizante | *Sheet* en móvil, diálogo centrado en `lg:` |
| `js/views-therapist.js:29` | Botón flotante | Anclado a la esquina del área de contenido |
| `js/views-therapist.js:70` | Barra de acciones fija | Se ensancha con el contenido |

## Dos estados del shell

`app.js` ya conoce el estado de sesión y añade una clase al `<body>`.

- **Sin sesión** → el marco actual: fondo oscuro, marca de agua, tarjeta de 480 px.
  No se toca.
- **Con sesión y ≥1024 px** → sin fondo oscuro, sin marca de agua, sin bisel. Barra
  lateral izquierda + contenido a ancho completo.
- **Por debajo de 1024 px** → idéntico a hoy en ambos estados.

## Puntos de corte

| Ancho | Sin sesión | Con sesión |
|---|---|---|
| `<768` | Móvil, sin cambios | Móvil, sin cambios |
| `768–899` | Móvil, sin cambios | Nav inferior; rejillas a 2 columnas, contenedor más ancho |
| `900–1023` | **Marco de dispositivo** (como hoy) | Ancho completo, **sin marco**, nav inferior aún |
| `≥1024` (`lg:`) | **Marco de dispositivo** (como hoy) | Ancho completo, barra lateral, nav inferior fuera |
| `≥1536` | — | Tope de ~1600 px para que las líneas de texto sigan siendo legibles |

El umbral de 900 px que hoy activa el marco **se conserva tal cual para la pantalla de
acceso**. Lo que cambia es que, con sesión iniciada, ese mismo umbral deja de activar el
marco y pasa a activar el ancho completo. Entre 900 y 1023 px hay por tanto un estado
intermedio deliberado: ancho completo pero todavía con nav inferior, porque una barra
lateral de 220 px en 950 px de pantalla deja el contenido más estrecho que ahora.

## Un contenedor, no dieciséis

Las 16 raíces de vista repiten `px-4 pt-4`. En lugar de editarlas una por una, `app.js`
envuelve el contenido en un `.view-container` que resuelve ancho y márgenes en un solo
sitio. Solo las vistas que necesitan rejilla se tocan individualmente.

`.view-container` debe ser un `div` liso: cualquier `overflow` propio convertiría a
`#view-root` en contenedor de scroll en móvil y rompería las cabeceras *sticky*.

## Layout por vista

| Vista | En PC |
|---|---|
| Dashboard | Tarjetas → `md:2` / `xl:3` columnas; gráfica de ingresos en fila propia |
| Agenda | Tarjetas apiladas → tabla (Hora · Paciente · Servicio · Estado · acciones) |
| Pacientes | Dos paneles (ver abajo) |
| Ficha | `xl:grid-cols-[360px_1fr]`: resumen a la izquierda, pestañas a la derecha |
| Valoración | Campos en `lg:2` columnas; tablas de goniometría a ancho completo |
| Rutinas | Catálogo `sm:2 lg:3 xl:4` |
| Sorteos | `lg:2` |
| Vistas de paciente (4) | Ensanchado y rejillas; sin dos paneles |

## Dos paneles en Pacientes, sin tocar el enrutador

Las rutas `#/t/pacientes` y `#/t/paciente/:id` se quedan como están. Lo único que cambia es
qué pinta la vista cuando hay sitio:

- `lg:`+ con `#/t/paciente/:id` → lista a la izquierda, ficha a la derecha.
- `lg:`+ con `#/t/pacientes` → lista a la izquierda, «Elige un paciente» a la derecha.
- Por debajo de `lg:` → pantallas separadas, igual que hoy.

Los enlaces profundos y el botón de atrás siguen funcionando porque la URL no cambia de
forma. El enrutador no se toca.

## El riesgo principal

`.app-frame` lleva `transform: translateZ(0)` a propósito: convierte el marco en bloque
contenedor de sus descendientes `position: fixed`, de modo que nav, sheets, botón flotante
y avisos quedan dentro del marco en vez de pegarse a la ventana.

Al retirar el marco en escritorio, esos elementos pasan a anclarse a la ventana. Es lo que
queremos, pero es un cambio de comportamiento silencioso que afecta a cuatro piezas a la
vez. Si algo se descoloca en escritorio, empezar por aquí.

**Invariante que no se toca:** en móvil `#view-root` no puede volverse contenedor de
scroll, o las cabeceras *sticky* dejan de funcionar (README §288).

## Verificación

No hay infraestructura de pruebas de navegador. Se comprueba con capturas a **390 / 768 /
1280 / 1920 px**.

Criterio de aceptación obligatorio: **a 390 px la interfaz queda igual que antes del
cambio**. Cualquier diferencia visible en móvil es un fallo, no un efecto secundario
aceptable.

`npm run build` debe seguir en verde.

## Etapas

Cada una desplegable por separado:

1. **Shell** — barra lateral, ancho completo, sheets/FAB/avisos, `.view-container`.
   Todo se ve ancho, aún en una columna.
2. **Rejillas** — siete vistas del fisio y cuatro del paciente.
3. **Dos paneles** en Pacientes.

## Fuera de alcance

- La zona horaria, el push y el correo: son trabajo aparte, ya en curso.
- Rediseño visual (paleta, tipografía, componentes). Esto es solo layout.
- Vistas de paciente con dos paneles.
