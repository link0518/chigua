module.exports = {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './api.ts',
    './types.ts',
    './components/**/*.{ts,tsx}',
    './store/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: '#f9f7f1',
        ink: '#2c2c2c',
        'border-ink': '#000000',
        pencil: '#555555',
        highlight: '#fff59d',
        alert: '#fca5a5',
        'marker-blue': '#81d4fa',
        'marker-green': '#a5d6a7',
        'marker-purple': '#ce93d8',
        'marker-orange': '#ffcc80',
      },
      fontFamily: {
        hand: ['"Zhi Mang Xing"', '"Patrick Hand"', 'cursive'],
        sans: ['"Noto Sans SC"', 'sans-serif'],
        display: ['"Ma Shan Zheng"', 'cursive'],
      },
      boxShadow: {
        sketch: '2px 2px 0px 0px #000000',
        'sketch-lg': '4px 4px 0px 0px #000000',
        'sketch-hover': '3px 3px 0px 0px #000000',
        'sketch-active': '0px 0px 0px 0px #000000',
        paper: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 2px 2px 0px 0px #000000',
      },
      borderRadius: {
        sketch: '2px 255px 3px 25px / 255px 5px 225px 3px',
        tape: '2px 5px 2px 5px / 20px 2px 20px 2px',
      },
      animation: {
        wiggle: 'wiggle 0.4s ease-in-out',
        float: 'float 3s ease-in-out infinite',
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-2deg)' },
          '50%': { transform: 'rotate(2deg)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')],
};
