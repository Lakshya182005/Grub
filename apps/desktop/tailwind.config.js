/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0B0E14',
        accent: '#7C8CF8',
        'text-main': '#E6E9F2',
        muted: '#8A93A6',
        hairline: '#1C2230',
        card: '#121620',
        'card-hover': '#181E2C',
        speaking: '#34D399'
      },
      letterSpacing: {
        chip: '0.08em'
      }
    }
  },
  plugins: []
}
