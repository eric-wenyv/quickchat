/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Claude-inspired minimal sand-white palette
        sand: {
          100: '#FAF9F6', // App primary background (Main chat area)
          200: '#F4F2EC', // Secondary background (Sidebar, input backgrounds)
          300: '#EBE8E0', // Subtle hover states
          400: '#E2DFD8', // Minimalist borders
          500: '#D4D0C8', // Stronger elements / icons
        },
        // Low-contrast dark gray typography
        ink: {
          100: '#8C8C8C', // Muted text / placeholders
          200: '#595959', // Secondary readable text (metadata, timestamps)
          300: '#333333', // Primary body text
          400: '#1A1A1A', // High emphasis / Headings
        }
      },
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
  plugins: [],
}
