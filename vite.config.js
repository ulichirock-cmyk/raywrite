import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7777',
      '/assets': 'http://localhost:7777',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
