import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Static marketing site — plain Vite build, no backend, no env secrets.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 8192,
  },
})
