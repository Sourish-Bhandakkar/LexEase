import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/clauses': 'http://localhost:8000',
      '/documents': 'http://localhost:8000',
      '/adaptive-learning': 'http://localhost:8000',
    },
    watch: {
      usePolling: true
    }
  }
})
