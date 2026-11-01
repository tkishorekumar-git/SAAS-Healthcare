import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteForm } from './invite-form';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`hospital=omega-demo&token=${'t'.repeat(43)}`),
}));

const preview = {
  hospitalName: 'Omega Demo Hospital',
  displayName: 'Synthetic Doctor',
  roles: ['DOCTOR'],
  phone: '******0002',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

describe('InviteForm', () => {
  beforeEach(() => {
    window.history.pushState(null, '', `/invite?hospital=omega-demo&token=${'t'.repeat(43)}`);
    vi.spyOn(window.history, 'replaceState');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows who the invitation is for, then activates the account', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(
        Response.json({ hospitalCode: 'omega-demo', displayName: 'Synthetic Doctor' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<InviteForm />);

    expect(await screen.findByText('Omega Demo Hospital')).toBeInTheDocument();
    expect(screen.getByText('Doctor')).toBeInTheDocument();
    expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/invite');
    expect(screen.getByText('******0002')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Activate my account' });
    fireEvent.change(screen.getByLabelText('Choose a password'), {
      target: { value: 'Monsoon-Ledger-47-Banyan' },
    });
    fireEvent.change(screen.getByLabelText('Repeat the password'), {
      target: { value: 'Monsoon-Ledger-47' },
    });
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Repeat the password'), {
      target: { value: 'Monsoon-Ledger-47-Banyan' },
    });
    fireEvent.click(submit);

    expect(await screen.findByText(/Your account is ready/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      '/login?hospital=omega-demo',
    );
    const [, acceptInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(acceptInit.body))).toMatchObject({
      hospitalCode: 'omega-demo',
      password: 'Monsoon-Ledger-47-Banyan',
    });
  });

  it('explains an invalid or expired link', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { message: 'This invitation link is invalid or has expired.' },
            { status: 404 },
          ),
        ),
    );
    render(<InviteForm />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('invalid or has expired'),
    );
    expect(screen.queryByLabelText('Choose a password')).not.toBeInTheDocument();
  });
});
