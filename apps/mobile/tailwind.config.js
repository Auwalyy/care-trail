/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Same palette as the web app (apps/web/app/globals.css).
      colors: {
        brand: { 50: '#eff6ff', 100: '#dbeafe', 600: '#1d5bcf', 700: '#1a4aa8', 900: '#142f63' },
        teal: { 50: '#effcf9', 600: '#0e8573', 700: '#0d6b5e' },
        canvas: '#f5f7fa',
        surface: '#ffffff',
        border: '#e2e8f0',
        ink: { DEFAULT: '#0f172a', muted: '#475569', subtle: '#64748b' },
        success: { 50: '#ecfdf3', 700: '#15803d' },
        warning: { 50: '#fffbeb', 700: '#b45309' },
        danger: { 50: '#fef2f2', 700: '#b91c1c' },
      },
    },
  },
  plugins: [],
};
