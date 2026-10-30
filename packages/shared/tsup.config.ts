import { defineConfig } from 'tsup';

// Dual CJS (NestJS) + ESM (Next.js) output with type declarations.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
