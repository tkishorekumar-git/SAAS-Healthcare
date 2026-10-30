import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { DEFAULT_API_VERSION } from '../app.constants';
import type { Env } from '../config/env.validation';

/**
 * Cross-cutting HTTP setup shared by main.ts and the e2e tests, so tests
 * exercise exactly the same security headers, validation and routing as production.
 */
export function configureApp(app: INestApplication, config: ConfigService<Env, true>): void {
  app.use(helmet());
  // Reads the HttpOnly refresh-token cookie on /auth/refresh (web clients).
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix(config.get('API_GLOBAL_PREFIX', { infer: true }));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: DEFAULT_API_VERSION });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
