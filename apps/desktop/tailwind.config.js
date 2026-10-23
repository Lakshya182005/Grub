/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0b0e14',
        card: '#131823',
        rail: '#0f141d',
        accent: {
          cyan: '#38bdf8',
          blue: '#3b82f6',
          violet: '#8b5cf6',
          emerald: '#10b981'
        }
      }
    }
  },
  plugins: []
}
