/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1430, strictPort: true, host: 'localhost' },
  build: {
    target: ['es2021', 'chrome105', 'safari15'],
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        overlay: resolve(__dirname, 'overlay.html'),
        widget: resolve(__dirname, 'widget.html'),
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
