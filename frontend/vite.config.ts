import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss()],
  define: mode === 'static' ? { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') } : {},
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    restoreMocks: true,
  },
}));
