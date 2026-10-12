import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the same build works on GitHub Pages sub-paths and inside the Android WebView.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});
