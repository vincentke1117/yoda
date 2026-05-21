import { resolve } from 'node:path';
import { lovinspPlugin } from 'lovinsp';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [lovinspPlugin({ bundler: 'vite', pathType: 'absolute' })],
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: false,
  },
  resolve: {
    alias: {
      '@root': resolve(__dirname, '../..'),
    },
  },
});
