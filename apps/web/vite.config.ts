import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The UI ships as one self-contained HTML file, served as-is by the server.
export default defineConfig({
  root: resolve(__dirname, 'ui'),
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    rollupOptions: { input: resolve(__dirname, 'ui/ui.html') },
  },
});
