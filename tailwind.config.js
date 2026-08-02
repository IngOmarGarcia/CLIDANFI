/** @type {import('tailwindcss').Config} */
module.exports = {
  // Tailwind analiza estos archivos y solo emite las clases que encuentre.
  // Por eso las clases NUNCA deben construirse por interpolación
  // (`bg-${tono}-100` no se detecta): se pasan siempre completas.
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      /* Paleta muestreada del propio logotipo (assets/logo-clidanfi.jpeg):
           rojo   #921f23   ·   crema #ded6ca   ·   fondo #212022          */
      colors: {
        // Rojo clínico · color corporativo y de acción
        brand: {
          50:  '#fdf3f3', 100: '#fbe3e4', 200: '#f6cbcd', 300: '#eda3a7',
          400: '#de6f76', 500: '#c94750', 600: '#ad2830', 700: '#921f23',
          800: '#7a1d21', 900: '#661d20', 950: '#380c0e'
        },
        // Beige / crema · fondos y superficies cálidas
        cream: {
          50:  '#fdfbf8', 100: '#f8f4ed', 200: '#efe9df', 300: '#ded6ca',
          400: '#c9bda9', 500: '#b3a288', 600: '#98866c', 700: '#7c6d58',
          800: '#655849', 900: '#52483d'
        },
        // Neutros cálidos · texto, bordes y tarjetas
        ink: {
          50: '#faf9f7', 100: '#f2f1ee', 200: '#e4e2dd', 300: '#cdcac2', 400: '#a3a09a',
          500: '#78756f', 600: '#5b5852', 700: '#43413c', 800: '#2c2a28', 900: '#1c1b1a'
        },
        // Fondo oscuro del marco de escritorio · night-800 es el fondo del logo,
        // así que la marca de agua se funde con la página sin recortes visibles.
        night: {
          700: '#2a292b', 800: '#212022', 900: '#171618', 950: '#0d0c0e'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.04), 0 4px 16px -4px rgba(15,23,42,.08)',
        lift: '0 8px 30px -8px rgba(15,23,42,.18)'
      },
      borderRadius: { xl2: '1.25rem' },
      spacing: { 4.5: '1.125rem', 18: '4.5rem' }
    }
  },
  plugins: []
};
