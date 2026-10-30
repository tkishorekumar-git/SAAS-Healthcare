import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma CLI configuration. Migrations run as the schema owner role (kenisha_migrator);
// the API never uses this URL. `prisma generate` does not need a database.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx scripts/seed.ts',
  },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL,
  },
});
