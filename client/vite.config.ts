import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dashboard proxies /api to the server in development.
 *
 * Same-origin in dev matches how it is served in production (nginx in front of
 * both), which means no CORS special-casing that only exists locally and no
 * "works on my machine" difference in how credentials are sent.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/public': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
