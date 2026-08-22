/* ==========================================================================
   CLIDANFI · store.js  ·  CATÁLOGOS CLÍNICOS
   Configuración del dominio, no datos de prueba:

     · CATALOGO_EJERCICIOS   catálogo visual del generador de rutinas.
                             Debe mantenerse sincronizado con la tabla
                             `ejercicios` de supabase/schema.sql (mismos id).
     · SECCIONES_VALORACION  motor de la valoración inicial dinámica.

   Aquí no hay persistencia ni datos de ejemplo: los datos viven en Supabase.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. CATÁLOGO DE EJERCICIOS
     `image_url` vacío ⇒ se usa una miniatura SVG generada. Al subir fotos
     reales a Supabase Storage, basta con llenar image_url.
     ====================================================================== */
  const CATALOGO_EJERCICIOS = [
    { id: 'ex_01', nombre: 'Retracción cervical (chin tuck)', categoria: 'Cervical', image_url: '',
      descripcion: 'Lleva el mentón hacia atrás formando "doble papada" sin inclinar la cabeza.',
      cue: 'Mirada al frente. No fuerces.', sets: 3, reps: 10, hold: 5 },
    { id: 'ex_02', nombre: 'Rotación cervical activa', categoria: 'Cervical', image_url: '',
      descripcion: 'Gira la cabeza lentamente a un lado hasta sentir tensión suave, regresa al centro.',
      cue: 'Hombros relajados, sin subirlos.', sets: 2, reps: 12, hold: 3 },
    { id: 'ex_03', nombre: 'Estiramiento de trapecio superior', categoria: 'Cervical', image_url: '',
      descripcion: 'Inclina la oreja hacia el hombro ayudándote con la mano contraria.',
      cue: 'Hombro contrario abajo.', sets: 2, reps: 3, hold: 30 },

    { id: 'ex_04', nombre: 'Rotación externa con banda', categoria: 'Hombro', image_url: '',
      descripcion: 'Codo pegado al costado a 90°, gira el antebrazo hacia afuera contra la banda.',
      cue: 'Rollito de toalla bajo el codo.', sets: 3, reps: 12, hold: 2 },
    { id: 'ex_05', nombre: 'Péndulo de Codman', categoria: 'Hombro', image_url: '',
      descripcion: 'Inclinado hacia adelante, deja colgar el brazo y dibuja círculos suaves.',
      cue: 'El movimiento nace del tronco.', sets: 2, reps: 15, hold: 0 },
    { id: 'ex_06', nombre: 'Elevación escapular en pared', categoria: 'Hombro', image_url: '',
      descripcion: 'Desliza los antebrazos por la pared elevando los brazos sin despegar la espalda.',
      cue: 'No arquees la lumbar.', sets: 3, reps: 10, hold: 2 },

    { id: 'ex_07', nombre: 'Puente de glúteo', categoria: 'Lumbar', image_url: '',
      descripcion: 'Boca arriba con rodillas dobladas, eleva la cadera apretando glúteos.',
      cue: 'Ombligo hacia adentro. No hiperextiendas.', sets: 3, reps: 15, hold: 3 },
    { id: 'ex_08', nombre: 'Gato – camello', categoria: 'Lumbar', image_url: '',
      descripcion: 'En cuatro puntos, alterna arqueo y redondeo de la columna.',
      cue: 'Movimiento lento y respirado.', sets: 2, reps: 12, hold: 2 },
    { id: 'ex_09', nombre: 'Estiramiento en flexión (rodillas al pecho)', categoria: 'Lumbar', image_url: '',
      descripcion: 'Boca arriba, abraza ambas rodillas acercándolas al pecho.',
      cue: 'Zona lumbar pegada al piso.', sets: 2, reps: 3, hold: 30 },

    { id: 'ex_10', nombre: 'Bird-dog', categoria: 'Core', image_url: '',
      descripcion: 'En cuatro puntos, extiende brazo y pierna contrarios manteniendo el tronco quieto.',
      cue: 'Imagina un vaso de agua en la espalda.', sets: 3, reps: 10, hold: 5 },
    { id: 'ex_11', nombre: 'Plancha frontal', categoria: 'Core', image_url: '',
      descripcion: 'Apoyo en antebrazos y puntas de pies, cuerpo en línea recta.',
      cue: 'Glúteos apretados, cadera neutra.', sets: 3, reps: 1, hold: 30 },
    { id: 'ex_12', nombre: 'Plancha lateral con rodillas', categoria: 'Core', image_url: '',
      descripcion: 'De lado, apoya antebrazo y rodillas y eleva la cadera.',
      cue: 'Hombro alineado sobre el codo.', sets: 3, reps: 1, hold: 20 },

    { id: 'ex_13', nombre: 'Abducción de cadera en decúbito lateral', categoria: 'Cadera', image_url: '',
      descripcion: 'Acostado de lado, eleva la pierna superior recta.',
      cue: 'Sin rotar la pelvis hacia atrás.', sets: 3, reps: 15, hold: 2 },
    { id: 'ex_14', nombre: 'Concha (clamshell) con banda', categoria: 'Cadera', image_url: '',
      descripcion: 'De lado con rodillas flexionadas, separa las rodillas contra la banda.',
      cue: 'Pies juntos todo el tiempo.', sets: 3, reps: 12, hold: 2 },

    { id: 'ex_15', nombre: 'Sentadilla en pared', categoria: 'Rodilla', image_url: '',
      descripcion: 'Espalda apoyada en la pared, desliza hasta 60° de flexión y sostén.',
      cue: 'Rodillas alineadas con los pies.', sets: 3, reps: 8, hold: 15 },
    { id: 'ex_16', nombre: 'Extensión de rodilla en silla', categoria: 'Rodilla', image_url: '',
      descripcion: 'Sentado, estira la rodilla hasta la horizontal y baja controlado.',
      cue: 'Aprieta el cuádriceps arriba.', sets: 3, reps: 15, hold: 3 },
    { id: 'ex_17', nombre: 'Step-up en escalón', categoria: 'Rodilla', image_url: '',
      descripcion: 'Sube y baja de un escalón controlando la rodilla de apoyo.',
      cue: 'Sin dejar caer la rodilla hacia adentro.', sets: 3, reps: 12, hold: 0 },

    { id: 'ex_18', nombre: 'Elevación de talones', categoria: 'Tobillo', image_url: '',
      descripcion: 'De pie, sube sobre las puntas de los pies y baja lento.',
      cue: 'Bajada en 3 segundos.', sets: 3, reps: 15, hold: 2 },
    { id: 'ex_19', nombre: 'Dorsiflexión con banda', categoria: 'Tobillo', image_url: '',
      descripcion: 'Sentado, jala la punta del pie hacia ti contra la resistencia.',
      cue: 'Solo mueve el tobillo.', sets: 3, reps: 15, hold: 2 },
    { id: 'ex_20', nombre: 'Equilibrio unipodal', categoria: 'Tobillo', image_url: '',
      descripcion: 'Mantén el equilibrio sobre un pie con apoyo cercano por seguridad.',
      cue: 'Progresa cerrando los ojos.', sets: 3, reps: 3, hold: 30 },

    { id: 'ex_21', nombre: 'Estiramiento de isquiotibiales', categoria: 'Movilidad', image_url: '',
      descripcion: 'Pierna estirada sobre una superficie baja, inclina el tronco desde la cadera.',
      cue: 'Espalda recta, no redondees.', sets: 2, reps: 3, hold: 30 },
    { id: 'ex_22', nombre: 'Rotación torácica en cuadrupedia', categoria: 'Movilidad', image_url: '',
      descripcion: 'Mano en la nuca, abre el codo hacia el techo rotando el tórax.',
      cue: 'La cadera no se mueve.', sets: 2, reps: 10, hold: 3 }
  ];

  const CATEGORIAS_EJERCICIO = ['Cervical', 'Hombro', 'Lumbar', 'Core', 'Cadera', 'Rodilla', 'Tobillo', 'Movilidad'];

  /* ======================================================================
     2. ESQUEMA DE LA VALORACIÓN INICIAL DINÁMICA
     Cada sección se activa/desactiva con una casilla según la dolencia.
     `always: true` ⇒ secciones obligatorias, no se pueden apagar.

     Tipos de campo soportados por el renderer (views-therapist.js):
       text · textarea · number · select · range · checks · rom · mmt · tests
     ====================================================================== */
  const SECCIONES_VALORACION = [
    {
      key: 'general', titulo: 'Ficha de ingreso', icono: 'clipboard', always: true,
      resumen: 'Motivo de consulta y contexto',
      campos: [
        { key: 'motivo', label: 'Motivo de consulta', type: 'textarea', placeholder: '¿Qué le trae a consulta?' },
        { key: 'inicio', label: 'Inicio de los síntomas', type: 'text', placeholder: 'Ej. hace 3 semanas' },
        { key: 'mecanismo', label: 'Mecanismo de lesión', type: 'select',
          options: ['Traumático', 'Sobreuso / repetitivo', 'Insidioso', 'Postquirúrgico', 'Degenerativo', 'Otro'] },
        { key: 'ocupacion', label: 'Ocupación', type: 'text', placeholder: 'Ej. oficinista' },
        { key: 'actividad', label: 'Nivel de actividad física', type: 'select',
          options: ['Sedentario', 'Ligera', 'Moderada', 'Deportista amateur', 'Alto rendimiento'] },
        { key: 'referido', label: 'Médico que refiere', type: 'text', placeholder: 'Opcional' }
      ]
    },
    {
      key: 'antecedentes', titulo: 'Antecedentes', icono: 'heart',
      resumen: 'Patológicos, quirúrgicos y farmacológicos',
      campos: [
        { key: 'patologicos', label: 'Antecedentes patológicos', type: 'checks',
          options: ['Diabetes', 'Hipertensión', 'Cardiopatía', 'Osteoporosis', 'Artritis reumatoide', 'Tiroides', 'Epilepsia', 'Cáncer', 'Ninguno'] },
        { key: 'quirurgicos', label: 'Antecedentes quirúrgicos', type: 'textarea', placeholder: 'Cirugías previas y fechas' },
        { key: 'medicamentos', label: 'Medicamentos actuales', type: 'textarea' },
        { key: 'alergias', label: 'Alergias', type: 'text' },
        { key: 'estudios', label: 'Estudios de gabinete disponibles', type: 'checks',
          options: ['Radiografía', 'Resonancia magnética', 'TAC', 'Ultrasonido', 'Electromiografía', 'Laboratorio'] }
      ]
    },
    {
      key: 'dolor', titulo: 'Evaluación del dolor', icono: 'activity',
      resumen: 'EVA, características e irritabilidad',
      campos: [
        { key: 'eva_reposo', label: 'EVA en reposo', type: 'range', min: 0, max: 10, step: 1, suffix: '/10' },
        { key: 'eva_actividad', label: 'EVA en actividad', type: 'range', min: 0, max: 10, step: 1, suffix: '/10' },
        { key: 'localizacion', label: 'Localización', type: 'text', placeholder: 'Ej. lumbar derecho' },
        { key: 'tipo', label: 'Tipo de dolor', type: 'checks',
          options: ['Punzante', 'Ardoroso', 'Opresivo', 'Eléctrico', 'Sordo', 'Pulsátil'] },
        { key: 'irradiacion', label: 'Irradiación', type: 'text', placeholder: 'Ej. cara posterior de muslo' },
        { key: 'horario', label: 'Predominio horario', type: 'select', options: ['Matutino', 'Vespertino', 'Nocturno', 'Constante'] },
        { key: 'agravantes', label: 'Factores agravantes', type: 'textarea' },
        { key: 'aliviantes', label: 'Factores aliviantes', type: 'textarea' }
      ]
    },
    {
      key: 'postural', titulo: 'Evaluación postural', icono: 'user',
      resumen: 'Vistas anterior, lateral y posterior',
      campos: [
        { key: 'anterior', label: 'Vista anterior', type: 'checks',
          options: ['Cabeza inclinada', 'Hombro elevado', 'Asimetría pélvica', 'Genu valgo', 'Genu varo', 'Pie plano', 'Pie cavo'] },
        { key: 'lateral', label: 'Vista lateral', type: 'checks',
          options: ['Anteriorización cervical', 'Hipercifosis dorsal', 'Hiperlordosis lumbar', 'Rectificación lumbar', 'Anteversión pélvica', 'Retroversión pélvica'] },
        { key: 'posterior', label: 'Vista posterior', type: 'checks',
          options: ['Escápula alada', 'Escoliosis funcional', 'Asimetría de pliegues', 'Valgo de retropié'] },
        { key: 'obs', label: 'Observaciones', type: 'textarea' }
      ]
    },
    {
      key: 'rom', titulo: 'Goniometría (ROM)', icono: 'refresh',
      resumen: 'Rangos articulares en grados',
      campos: [
        { key: 'tabla', label: 'Rango de movimiento activo (°)', type: 'rom',
          rows: ['Flexión hombro', 'Abducción hombro', 'Rot. externa hombro', 'Flexión codo',
                 'Flexión lumbar', 'Extensión lumbar', 'Flexión cadera', 'Flexión rodilla',
                 'Extensión rodilla', 'Dorsiflexión tobillo'] },
        { key: 'obs', label: 'Notas de goniometría', type: 'textarea' }
      ]
    },
    {
      key: 'fuerza', titulo: 'Fuerza muscular', icono: 'dumbbell',
      resumen: 'Escala de Daniels 0 – 5',
      campos: [
        { key: 'tabla', label: 'Balance muscular (0-5)', type: 'mmt',
          rows: ['Deltoides', 'Manguito rotador', 'Bíceps braquial', 'Tríceps braquial',
                 'Abdominales / core', 'Glúteo medio', 'Glúteo mayor', 'Cuádriceps',
                 'Isquiotibiales', 'Tríceps sural'] },
        { key: 'obs', label: 'Notas de fuerza', type: 'textarea' }
      ]
    },
    {
      key: 'esp_cervical', titulo: 'Pruebas especiales · Cervical', icono: 'stethoscope',
      resumen: 'Spurling, distracción, Adson…',
      campos: [{ key: 'tests', label: 'Resultado', type: 'tests',
        options: ['Spurling', 'Distracción cervical', 'Compresión foraminal', 'Test de Adson', 'Test de Sharp-Purser'] }]
    },
    {
      key: 'esp_hombro', titulo: 'Pruebas especiales · Hombro', icono: 'stethoscope',
      resumen: 'Neer, Hawkins, Jobe…',
      campos: [{ key: 'tests', label: 'Resultado', type: 'tests',
        options: ['Neer', 'Hawkins-Kennedy', 'Jobe (lata vacía)', 'Yergason', 'Aprensión anterior', 'Speed'] }]
    },
    {
      key: 'esp_lumbar', titulo: 'Pruebas especiales · Lumbopélvico', icono: 'stethoscope',
      resumen: 'Lasègue, FABER, Schober…',
      campos: [{ key: 'tests', label: 'Resultado', type: 'tests',
        options: ['Lasègue (SLR)', 'Bragard', 'Slump', 'FABER / Patrick', 'Gaenslen', 'Compresión sacroilíaca', 'Schober'] }]
    },
    {
      key: 'esp_rodilla', titulo: 'Pruebas especiales · Rodilla', icono: 'stethoscope',
      resumen: 'Lachman, cajones, McMurray…',
      campos: [{ key: 'tests', label: 'Resultado', type: 'tests',
        options: ['Lachman', 'Cajón anterior', 'Cajón posterior', 'McMurray', 'Estrés en valgo', 'Estrés en varo', 'Aprensión rotuliana'] }]
    },
    {
      key: 'marcha', titulo: 'Análisis de marcha', icono: 'trendingUp',
      resumen: 'Patrón, fases y test de 6 minutos',
      campos: [
        { key: 'patron', label: 'Patrón de marcha', type: 'select',
          options: ['Normal', 'Antiálgica', 'Trendelenburg', 'Steppage', 'Atáxica', 'Espástica', 'En tijera'] },
        { key: 'fases', label: 'Alteraciones por fase', type: 'checks',
          options: ['Contacto inicial alterado', 'Apoyo medio inestable', 'Despegue deficiente', 'Balanceo asimétrico'] },
        { key: 'ayuda', label: 'Auxiliar de marcha', type: 'select',
          options: ['Ninguno', 'Bastón', 'Muletas', 'Andadera', 'Silla de ruedas'] },
        { key: 'cadencia', label: 'Cadencia', type: 'number', suffix: 'pasos/min' },
        { key: 'test6min', label: 'Test de marcha 6 min', type: 'number', suffix: 'metros' },
        { key: 'obs', label: 'Observaciones', type: 'textarea',
          placeholder: 'Adjunta las fotos/video del test desde la pestaña Historial.' }
      ]
    },
    {
      key: 'neuro', titulo: 'Valoración neurológica', icono: 'activity',
      resumen: 'Sensibilidad, reflejos y tensión neural',
      campos: [
        { key: 'sensibilidad', label: 'Sensibilidad', type: 'select',
          options: ['Conservada', 'Hipoestesia', 'Hiperestesia', 'Anestesia', 'Parestesias'] },
        { key: 'dermatoma', label: 'Dermatoma / territorio afectado', type: 'text', placeholder: 'Ej. L5 derecho' },
        { key: 'reflejos', label: 'Reflejos osteotendinosos', type: 'checks',
          options: ['Bicipital normal', 'Tricipital normal', 'Patelar normal', 'Aquíleo normal', 'Hiporreflexia', 'Hiperreflexia'] },
        { key: 'tension', label: 'Pruebas de tensión neural', type: 'tests',
          options: ['Tinel', 'Phalen', 'ULTT mediano', 'Slump'] }
      ]
    },
    {
      key: 'diagnostico', titulo: 'Diagnóstico y plan', icono: 'sparkles', always: true,
      resumen: 'Objetivos, técnicas y pronóstico',
      campos: [
        { key: 'dx', label: 'Diagnóstico fisioterapéutico', type: 'textarea' },
        { key: 'obj_corto', label: 'Objetivos a corto plazo', type: 'textarea' },
        { key: 'obj_largo', label: 'Objetivos a largo plazo', type: 'textarea' },
        { key: 'plan', label: 'Plan de tratamiento', type: 'checks',
          options: ['Terapia manual', 'Electroterapia', 'Ultrasonido', 'Punción seca', 'Vendaje neuromuscular',
                    'Ejercicio terapéutico', 'Crioterapia', 'Termoterapia', 'Educación al paciente'] },
        { key: 'sesiones', label: 'Sesiones estimadas', type: 'number' },
        { key: 'frecuencia', label: 'Frecuencia', type: 'select', options: ['1 × semana', '2 × semana', '3 × semana', 'Diario'] },
        { key: 'pronostico', label: 'Pronóstico', type: 'select', options: ['Excelente', 'Bueno', 'Reservado', 'Malo'] }
      ]
    }
  ];

  /* ======================================================================
     EXPORT
     ====================================================================== */
  /**
   * Opciones del catálogo BASE de un campo de la valoración.
   *
   * Es el punto único donde se resuelve la ruta `seccion.campo`, y lo usan
   * tanto el renderizador —para concatenar las opciones que añadió el fisio—
   * como la API, para no dejar añadir un duplicado de algo que ya venía.
   *
   * Devuelve [] si la sección o el campo no existen, o si ese campo no es de
   * los que tienen lista (un `textarea` no la tiene).
   */
  const opcionesDeCampo = (seccion, campo) => {
    const sec = SECCIONES_VALORACION.find((s) => s.key === seccion);
    if (!sec) return [];
    const c = sec.campos.find((f) => f.key === campo);
    return (c && Array.isArray(c.options)) ? c.options : [];
  };

  /** ¿Este campo admite opciones nuevas? Solo las listas, no los textos. */
  const CAMPOS_AMPLIABLES = ['select', 'checks', 'tests'];

  global.Store = {
    CATALOGO_EJERCICIOS,
    CATEGORIAS_EJERCICIO,
    SECCIONES_VALORACION,
    CAMPOS_AMPLIABLES,
    opcionesDeCampo,
    ejercicio: (id) => CATALOGO_EJERCICIOS.find((e) => e.id === id) || null
  };
})(window);
