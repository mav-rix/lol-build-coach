import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The Live Client Data API serves HTTPS with a self-signed Riot cert on the
// machine running the game. Proxying through the dev server avoids both the
// certificate error and CORS. On WSL2 without mirrored networking, set
// LIVE_CLIENT_HOST to the Windows host IP and LIVE_CLIENT_PORT to the
// portproxy listen port (see README) — the forward can't listen on 2999
// itself or it steals the port from the game.
//
// The LCU bridge (champ-select) is our own Node service; it serves plain HTTP,
// so /lcu proxies over http. LCU_HOST/LCU_PORT mirror the same WSL setup.
const winHost = process.env.LIVE_CLIENT_HOST ?? '127.0.0.1'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    proxy: {
      '/liveclientdata': {
        target: `https://${winHost}:${process.env.LIVE_CLIENT_PORT ?? '2999'}`,
        secure: false,
        changeOrigin: true,
      },
      '/lcu': {
        target: `http://${process.env.LCU_HOST ?? winHost}:${
          process.env.LCU_PORT ?? '2998'
        }`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/lcu/, ''),
      },
    },
  },
})
