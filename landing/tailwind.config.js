/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7ff',
          100: '#dbedff',
          200: '#bfdcff',
          300: '#93c3ff',
          400: '#609eff',
          500: '#3b7dff',
          600: '#1f58f5',
          700: '#1844dc',
          800: '#1a3ab2',
          900: '#1a368c',
          950: '#152255',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
