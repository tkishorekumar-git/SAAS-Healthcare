// NestJS services: base rules plus Jest globals for spec files.
import globals from 'globals';
import base from './base.js';

export default [
  ...base,
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },
];
