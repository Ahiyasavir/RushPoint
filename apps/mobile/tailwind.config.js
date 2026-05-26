const { hairlineWidth } = require('nativewind/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Slot type colours — referenced as static strings in components
        'slot-green':  '#22c55e',
        'slot-orange': '#f97316',
        'slot-gold':   '#eab308',
        // App background
        'app-bg': '#07070a',
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      boxShadow: {
        'glow-green':  '0 0 18px 2px rgba(34,197,94,0.35)',
        'glow-orange': '0 0 18px 2px rgba(249,115,22,0.35)',
        'glow-gold':   '0 0 18px 2px rgba(234,179,8,0.35)',
      },
    },
  },
  plugins: [],
};
