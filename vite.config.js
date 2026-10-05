import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import adzoneApi from './vite-api-plugin.mjs';

export default defineConfig({
  plugins: [react(), adzoneApi()],
  // Your existing "img" folder (demo/img/...) is served as-is at the site root,
  // e.g. demo/img/logo/logo.png -> https://.../logo/logo.png
  // (see src/data/services.js and index.html for matching "/logo/..." paths)
  publicDir: 'img',
  server: {
    port: 5173,
    open: true,
  },
});
