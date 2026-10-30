import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment. Importing this from a client component fails the
 * build, so these values can never be bundled into browser JavaScript.
 */
const serverEnvSchema = z.object({
  API_INTERNAL_URL: z.url().default('http://localhost:4000'),
});

export const serverEnv = serverEnvSchema.parse({
  API_INTERNAL_URL: process.env.API_INTERNAL_URL,
});
