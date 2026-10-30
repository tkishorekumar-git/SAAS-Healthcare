import { defineConfig } from 'tsup';

// CommonJS for the NestJS API. The generated Prisma client is bundled from src/generated;
// its runtime (@prisma/client) and the pg driver stay external dependencies.
export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2023',
});
