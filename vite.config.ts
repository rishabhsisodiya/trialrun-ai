import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.TRIALRUN_PORT ?? 4477);

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': `http://127.0.0.1:${SERVER_PORT}` },
  },
});
