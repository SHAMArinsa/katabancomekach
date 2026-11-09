/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory: { DEFAULT: '#FFFFFF', 50: '#FFFFFF', 100: '#FAFAF8', 200: '#F3F4F1', 300: '#E6E8E4' },
        charcoal: { DEFAULT: '#2A2E30', 900: '#1E2224', 800: '#2A2E30', 700: '#3D4346', 600: '#596064', 500: '#7A8185', 400: '#A5ABAE', 300: '#CBD0D2' },
        champagne: { DEFAULT: '#4FA39D', 50: '#EEF7F6', 100: '#D9EFEC', 200: '#B4DDD8', 300: '#86C5BF', 400: '#4FA39D', 500: '#3B8983', 600: '#2E6E69' },
        blush: { DEFAULT: '#F6E9E4', 500: '#C9725B' },
        line: '#E6E8E4',
      },
      fontFamily: {
        display: ['Jost', 'system-ui', 'sans-serif'],
        sans: ['"Nunito Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      letterSpacing: { luxe: '0.12em' },
      boxShadow: { soft: '0 1px 2px rgba(35,33,30,.04), 0 8px 24px -12px rgba(35,33,30,.12)' },
      keyframes: {
        fadeUp: { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'none' } },
      },
      animation: { 'fade-up': 'fadeUp .5s ease-out both' },
    },
  },
  plugins: [],
}
