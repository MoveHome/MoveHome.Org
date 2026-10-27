import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Route handlers import through the `@/*` tsconfig alias, so tests need it too.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['__tests__/**/*.test.ts'] }
});
