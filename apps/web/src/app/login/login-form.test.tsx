import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffSession } from '@/lib/auth/session-manager';
import { LoginForm } from './login-form';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('hospital=demo-aarogya'),
}));

function respond(...bodies: Array<{ status?: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const { status = 200, body } of bodies) {
    fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fillCredentials() {
  fireEvent.change(screen.getByLabelText('Email or mobile number'), {
    target: { value: 'doctor@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'Monsoon-Ledger-47-Banyan' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('LoginForm', () => {
  beforeEach(() => {
    replace.mockReset();
    staffSession.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('prefills the hospital code from the link', async () => {
    render(<LoginForm />);
    await waitFor(() => expect(screen.getByLabelText('Hospital code')).toHaveValue('demo-aarogya'));
  });

  it('asks for the SMS code, then signs in to the console as a web client', async () => {
    const fetchMock = respond(
      {
        body: {
          status: 'MFA_REQUIRED',
          challengeId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
          expiresInSeconds: 300,
        },
      },
      {
        body: {
          accessToken: 'access-1',
          accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        },
      },
    );
    render(<LoginForm />);
    await waitFor(() => expect(screen.getByLabelText('Hospital code')).toHaveValue('demo-aarogya'));
    fillCredentials();

    const codeInput = await screen.findByLabelText('SMS code');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    fireEvent.change(codeInput, { target: { value: '12a3456' } });
    expect(codeInput).toHaveValue('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin'));
    await expect(staffSession.getToken()).resolves.toBe('access-1');

    const [, loginInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(loginInit.body))).toMatchObject({
      hospitalCode: 'demo-aarogya',
      client: 'web',
    });
    expect(loginInit.credentials).toBe('include');
  });

  it('shows the server’s generic error and stays on the form', async () => {
    respond({ status: 401, body: { message: 'Invalid hospital code or login details.' } });
    render(<LoginForm />);
    await waitFor(() => expect(screen.getByLabelText('Hospital code')).toHaveValue('demo-aarogya'));
    fillCredentials();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid hospital code or login details.',
    );
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});
