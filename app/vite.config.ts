import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-ignore Node-only local Vite plugin
import { runtimePlugin } from './config/runtime.mjs';

export default defineConfig({
  plugins: [runtimePlugin(), react()],
  server: { port: 5183, strictPort: true, watch: { ignored: ['**/.tmp/**'] } },
  build: { outDir: 'dist', sourcemap: true, rollupOptions: { output: {
    manualChunks: { phaser: ['phaser'], react: ['react', 'react-dom'] }
  } } }
});
