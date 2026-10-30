// Real-database e2e: the API connects as kenisha_app to the throwaway database created
// by db/global-setup.ts.
import './support/auth-env';

const appUrl = process.env.KENISHA_E2E_APP_URL;
if (!appUrl) {
  throw new Error('KENISHA_E2E_APP_URL missing — run via `pnpm test:e2e:db`');
}
process.env.DATABASE_URL = appUrl;
process.env.PLATFORM_DATABASE_URL = process.env.KENISHA_E2E_PLATFORM_URL;
