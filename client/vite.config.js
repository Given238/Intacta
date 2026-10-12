import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Dev proxy target must match the server PORT (server/.env, default 3000).
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), '').VITE_PROXY_TARGET || 'http://localhost:3000'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
        '/socket.io': {
          target,
          ws: true,
        },
      },
    },
  }
})
