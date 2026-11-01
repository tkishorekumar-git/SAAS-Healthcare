import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { DEFAULT_API_VERSION } from '../app.constants';
import type { Env } from '../config/env.validation';
import { SafeExceptionFilter } from './safe-exception.filter';

/**
 * Cross-cutting HTTP setup shared by main.ts and the e2e tests, so tests
 * exercise exactly the same security headers, validation and routing as production.
 */
export function configureApp(app: INestApplication, config: ConfigService<Env, true>): void {
  // Behind Caddy the socket peer is the proxy; trust exactly its hops so rate limits and
  // audit logs see the client's address, and clients cannot spoof X-Forwarded-For.
  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) {
    (app as NestExpressApplication).set('trust proxy', proxyHops);
  }
  app.use(helmet());
  // JSON body parser registered here (Nest then skips its own) so that parse errors can be
  // replaced right away: Node's JSON.parse messages quote part of the request body.
  (app as NestExpressApplication).useBodyParser('json', { limit: '100kb' });
  app.use(rejectMalformedBody);
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
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks();
}

function rejectMalformedBody(error: unknown, _req: Request, _res: Response, next: NextFunction) {
  next(
    error instanceof SyntaxError
      ? new BadRequestException('Request body is not valid JSON.')
      : error,
  );
}
