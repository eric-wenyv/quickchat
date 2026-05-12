import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'selector',
  theme: {
    extend: {
      boxShadow: {
        // Specific shadow variable for input hover/focus state
        'input-hover': '0 2px 12px -2px rgba(0, 0, 0, 0.08), 0 4px 24px -4px rgba(0, 0, 0, 0.04)',
        // Extremely restrained panel shadows for popups/dropdowns
        'panel': '0 4px 32px -4px rgba(0, 0, 0, 0.06)',
      },
      fontFamily: {
        // High-quality typography baseline
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      }
    },
  },
  plugins: [typography],
}
