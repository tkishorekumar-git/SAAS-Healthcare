import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SERVICE_VERSION } from '../app.constants';

/** Serves Swagger UI at /{prefix}/docs and the OpenAPI JSON at /{prefix}/docs-json. */
export function setupSwagger(app: INestApplication, globalPrefix: string): void {
  const config = new DocumentBuilder()
    .setTitle('Kenisha Healthcare API')
    .setDescription(
      'Multi-tenant healthcare platform API. All data in non-production is synthetic.',
    )
    .setVersion(SERVICE_VERSION)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document);
}
