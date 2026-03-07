import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:5000'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          map: ['maplibre-gl', '@deck.gl/layers', '@deck.gl/mapbox', '@mapbox/mapbox-gl-draw'],
          state: ['@tanstack/react-query', 'zustand'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
      },
    },
  },
})
