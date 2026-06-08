/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { getHttpsServerOptions } from 'office-addin-dev-certs';

export default defineConfig(async () => {
  const httpsOptions = await getHttpsServerOptions();
  return {
    plugins: [react()],
    server: {
      port: 3000,
      https: httpsOptions,
    },
    preview: {
      port: 3000,
      https: httpsOptions,
    },
    build: {
      rollupOptions: {
        input: {
          taskpane: 'taskpane.html',
        },
      },
      outDir: 'dist',
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
