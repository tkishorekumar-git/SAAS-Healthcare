import { type ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { SafeExceptionFilter, describeError } from './safe-exception.filter';

const CANARY = 'Zenobia Quillfeather +919876500001';

function run(exception: unknown) {
  const result: { status?: number; body?: unknown } = {};
  const response = {
    headersSent: false,
    status(code: number) {
      result.status = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new SafeExceptionFilter().catch(exception, host);
  return result;
}

describe('SafeExceptionFilter', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps our own error messages', () => {
    expect(run(new BadRequestException('Branch name is required.'))).toEqual({
      status: 400,
      body: { statusCode: 400, message: 'Branch name is required.', error: 'Bad Request' },
    });
  });

  it('does not echo the path of an unknown route', () => {
    const result = run(new NotFoundException(`Cannot GET /api/v1/patients/${CANARY}`));
    expect(result).toEqual({ status: 404, body: { statusCode: 404, message: 'Not found' } });
  });

  it('hides database and other unexpected errors from the response and the log', () => {
    const dbError = Object.assign(
      new Error(`duplicate key value violates unique constraint: (phone)=(${CANARY})`),
      { name: 'DatabaseError', code: '23505' },
    );
    const result = run(dbError);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('Zenobia');
    expect(result.body).toMatchObject({ message: 'Internal server error' });
    expect(logged.join('\n')).toContain('DatabaseError [23505]');
    expect(logged.join('\n')).not.toContain('Zenobia');
    expect(logged.join('\n')).not.toContain('9876500001');
  });

  it('turns client errors from middleware into a generic message', () => {
    const parseError = Object.assign(new SyntaxError(`Unexpected token in "${CANARY}"`), {
      status: 400,
    });
    expect(run(parseError)).toEqual({
      status: 400,
      body: { statusCode: 400, message: 'Bad request' },
    });
  });

  it('describes errors by class and code only', () => {
    expect(describeError(new TypeError(CANARY))).toBe('TypeError');
    expect(describeError(Object.assign(new Error(CANARY), { code: 'P2002' }))).toBe(
      'Error [P2002]',
    );
    expect(describeError(CANARY)).toBe('non-error exception');
  });
});
