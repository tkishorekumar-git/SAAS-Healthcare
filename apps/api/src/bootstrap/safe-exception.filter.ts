import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Last line of defence against leaking data through errors (ADR-0005 section 1).
 *
 * - Our own HttpExceptions keep their messages: they are written by us and never contain PHI.
 * - Framework "Cannot GET /path" 404s would echo the URL; they become a plain "Not found".
 * - Anything else (database errors, JSON parse errors, bugs) gets a fixed body. The log line
 *   carries an error ID, the error's class name and a database error code — never its message,
 *   which can quote the offending values (for example a unique-constraint violation).
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status === HttpStatus.NOT_FOUND && isRouteNotFound(body)) {
        response.status(status).json({ statusCode: status, message: 'Not found' });
        return;
      }
      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    const clientStatus = clientErrorStatus(exception);
    if (clientStatus !== undefined) {
      // e.g. malformed JSON from the body parser: its message quotes part of the body.
      response.status(clientStatus).json({ statusCode: clientStatus, message: 'Bad request' });
      return;
    }

    const errorId = randomUUID();
    this.logger.error(
      `Unhandled ${describeError(exception)} (errorId=${errorId})`,
      stackFrames(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      errorId,
    });
  }
}

function isRouteNotFound(body: string | object): boolean {
  const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
  return typeof message === 'string' && /^Cannot [A-Z]+ /.test(message);
}

function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' && value >= 400 && value < 500 ? value : undefined;
}

/** Class name and (for database errors) the error code. Never the message. */
export function describeError(exception: unknown): string {
  if (!(exception instanceof Error)) return 'non-error exception';
  const code = (exception as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)
    ? `${exception.name} [${code}]`
    : exception.name;
}

/** The stack without its first line, which repeats the message. Frames hold no data. */
function stackFrames(exception: unknown): string | undefined {
  if (!(exception instanceof Error) || !exception.stack) return undefined;
  return exception.stack
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n');
}
