/** @type {import('tailwindcss').Config} */
module.exports = {
  // Tailwind analiza estos archivos y solo emite las clases que encuentre.
  // Por eso las clases NUNCA deben construirse por interpolación
  // (`bg-${tono}-100` no se detecta): se pasan siempre completas.
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4',
          400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e',
          800: '#115e59', 900: '#134e4a', 950: '#042f2e'
        },
        ink: {
          50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
          500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a'
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
