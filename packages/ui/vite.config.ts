import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    allowedHosts: ['.ngrok.app', '.ngrok.dev'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
