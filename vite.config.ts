import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative base so the built bundle works from file:// inside Electron.
  base: './',
  plugins: [react()],
  optimizeDeps: {
    // PGlite ships its own WASM loader; pre-bundling breaks it.
    exclude: ['@electric-sql/pglite'],
  },
  build: { target: 'es2022' },
})
