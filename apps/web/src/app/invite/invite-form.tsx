'use client';

import { ROLE_LABELS, type StaffRole } from '@kenisha/shared';
import { Alert } from '@kenisha/ui/components/alert';
import { Button } from '@kenisha/ui/components/button';
import { Input } from '@kenisha/ui/components/input';
import { Field } from '@kenisha/ui/components/label';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/http';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

interface InvitationPreview {
  hospitalName: string;
  displayName: string;
  roles: StaffRole[];
  phone: string;
  expiresAt: string;
}

/** Invitation link landing page: shows who it is for, then the invitee sets a password. */
export function InviteForm() {
  const params = useSearchParams();
  // Read once, then drop the one-time token from the address bar and browser history.
  const [hospitalCode] = useState(() => params.get('hospital') ?? '');
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const accept = useAction();

  const preview = useApi(() =>
    apiFetch<InvitationPreview>('/auth/invitations/inspect', {
      method: 'POST',
      body: { hospitalCode, token },
    }),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await accept.run(() =>
      apiFetch('/auth/invitations/accept', {
        method: 'POST',
        body: { hospitalCode, token, password },
      }),
    );
    if (ok !== undefined) {
      setDone(true);
      setPassword('');
      setConfirm('');
    }
  }

  if (preview.loading) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking your invitation…
      </p>
    );
  }
  if (preview.error || !preview.data) {
    return (
      <Alert variant="destructive">{preview.error ?? 'This invitation link is invalid.'}</Alert>
    );
  }
  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="success">Your account is ready. Sign in with your new password.</Alert>
        <Button asChild>
          <Link href={`/login?hospital=${encodeURIComponent(hospitalCode)}`}>Go to sign in</Link>
        </Button>
      </div>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/50 p-3 text-sm">
        <dt className="text-muted-foreground">Hospital</dt>
        <dd>{preview.data.hospitalName}</dd>
        <dt className="text-muted-foreground">Name</dt>
        <dd>{preview.data.displayName}</dd>
        <dt className="text-muted-foreground">Role</dt>
        <dd>{preview.data.roles.map((r) => ROLE_LABELS[r]).join(', ')}</dd>
        <dt className="text-muted-foreground">Mobile</dt>
        <dd>{preview.data.phone}</dd>
        <dt className="text-muted-foreground">Expires</dt>
        <dd>{formatDateTime(preview.data.expiresAt)}</dd>
      </dl>
      {accept.error ? <Alert variant="destructive">{accept.error}</Alert> : null}
      <Field
        id="password"
        label="Choose a password"
        hint="At least 12 characters. A short sentence works well."
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field
        id="confirm"
        label="Repeat the password"
        error={mismatch ? 'The passwords do not match.' : undefined}
      >
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch}
        />
      </Field>
      <Button
        type="submit"
        disabled={accept.pending || password.length < 12 || password !== confirm}
      >
        {accept.pending ? 'Activating…' : 'Activate my account'}
      </Button>
    </form>
  );
}
