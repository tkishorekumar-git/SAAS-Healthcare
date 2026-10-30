// E2E tests must be deterministic and must not touch a developer's database. Port 1 refuses
// connections immediately, so readiness reports the database as down. Real-database
// behaviour is covered by test:e2e:db and the packages/database integration tests.
import './support/auth-env';

process.env.DATABASE_URL =
  'postgresql://kenisha_app:e2e-unused-password@127.0.0.1:1/kenisha_e2e?schema=kenisha';
process.env.PLATFORM_DATABASE_URL =
  'postgresql://kenisha_platform:e2e-unused-password@127.0.0.1:1/kenisha_e2e?schema=kenisha';
