import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.PORT || 3000);

export default defineConfig({
  base: './',
  envPrefix: ['VITE_', 'REACT_APP_'],
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port,
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const normalized = id.replaceAll('\\', '/');
          if (normalized.includes('/react/') || normalized.includes('/react-dom/')) return 'react-vendor';
          if (normalized.includes('/lucide-react/')) return 'ui-icons';
          if (normalized.includes('/@supabase/')) return 'supabase-vendor';
          if (normalized.includes('/exceljs/')) return 'exceljs';
          return 'vendor';
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: './src/setupTests.js',
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    css: true,
  },
});
