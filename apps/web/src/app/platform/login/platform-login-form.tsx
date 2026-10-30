'use client';

import { Alert } from '@kenisha/ui/components/alert';
import { Button } from '@kenisha/ui/components/button';
import { Input } from '@kenisha/ui/components/input';
import { Field } from '@kenisha/ui/components/label';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api/http';
import { type IssuedTokens, platformSession } from '@/lib/auth/session-manager';
import { useAction } from '@/lib/use-api';

/** Super Admin sign-in: email + password, then the authenticator app code (ADR-0003 I6). */
export function PlatformLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const { pending, error, run, clearError } = useAction();

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    const result = await run(() =>
      apiFetch<{ mfaToken: string }>('/platform/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      }),
    );
    setPassword('');
    if (result) setMfaToken(result.mfaToken);
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    const tokens = await run(() =>
      apiFetch<IssuedTokens>('/platform/auth/totp/verify', {
        method: 'POST',
        body: { mfaToken, code: code.trim() },
      }),
    );
    if (tokens) {
      platformSession.setTokens(tokens);
      router.replace('/platform');
    }
  }

  if (mfaToken) {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code from your authenticator app.
        </p>
        <Field id="code" label="Authenticator code" error={error ?? undefined}>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            aria-invalid={Boolean(error)}
          />
        </Field>
        <Button type="submit" disabled={pending || code.length !== 6}>
          {pending ? 'Checking…' : 'Verify and sign in'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setMfaToken(null);
            setCode('');
            clearError();
          }}
        >
          Start again
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="flex flex-col gap-4" noValidate>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Field id="email" label="Email">
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field id="password" label="Password">
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={pending || !email || !password}>
        {pending ? 'Signing in…' : 'Continue'}
      </Button>
    </form>
  );
}
