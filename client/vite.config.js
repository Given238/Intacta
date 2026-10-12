import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// Silero VAD (voice activity detection) assets, self-hosted under /vad/ (no CDN): the audio worklet,
// the v5 model and the onnxruntime-web wasm files. lib/voiceInput.js points MicVAD at /vad/.
const vadAssets = viteStaticCopy({
  targets: [
    { src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', dest: 'vad', rename: { stripBase: true } },
    { src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx', dest: 'vad', rename: { stripBase: true } },
    { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs}', dest: 'vad', rename: { stripBase: true } },
  ],
})

// Dev proxy target must match the server PORT (server/.env, default 3000).
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), '').VITE_PROXY_TARGET || 'http://localhost:3000'
  return {
    plugins: [react(), tailwindcss(), vadAssets],
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
