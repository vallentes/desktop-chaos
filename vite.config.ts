/// <reference types="vitest" />
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Dev only (`npm run dev:capture`): lets src/dev/capture.ts save README media into docs/media. */
function captureSink(): Plugin {
  return {
    name: 'capture-sink',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        if (req.method !== 'POST' || !/^[a-z0-9-]+\.(gif|png)$/.test(name)) {
          res.statusCode = 400;
          return res.end('bad request');
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(resolve(__dirname, 'docs/media'), { recursive: true });
          writeFileSync(resolve(__dirname, 'docs/media', name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "capture" ? [captureSink()] : [])],
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
}));
