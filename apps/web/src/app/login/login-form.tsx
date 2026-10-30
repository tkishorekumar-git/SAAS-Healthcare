'use client';

import { Alert } from '@kenisha/ui/components/alert';
import { Button } from '@kenisha/ui/components/button';
import { Input } from '@kenisha/ui/components/input';
import { Field } from '@kenisha/ui/components/label';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/http';
import type { IssuedTokens } from '@/lib/auth/session-manager';
import { staffSession } from '@/lib/auth/session-manager';
import { rememberHospitalCode, rememberedHospitalCode } from '@/lib/format';
import { useAction } from '@/lib/use-api';

type LoginResponse =
  | { status: 'MFA_REQUIRED'; challengeId: string; expiresInSeconds: number }
  | { status: 'AUTHENTICATED'; tokens: IssuedTokens };

/** Staff sign-in: hospital code + email/mobile + password, then the SMS code (ADR-0003). */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [hospitalCode, setHospitalCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const { pending, error, run, clearError } = useAction();

  useEffect(() => {
    setHospitalCode(params.get('hospital') ?? rememberedHospitalCode());
  }, [params]);

  function signedIn(tokens: IssuedTokens) {
    staffSession.setTokens(tokens);
    rememberHospitalCode(hospitalCode);
    router.replace('/admin');
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    const result = await run(() =>
      apiFetch<LoginResponse>('/auth/staff/login', {
        method: 'POST',
        body: {
          hospitalCode: hospitalCode.trim(),
          identifier: identifier.trim(),
          password,
          client: 'web',
        },
      }),
    );
    // Never keep a password in page state longer than the attempt, successful or not.
    setPassword('');
    if (!result) return;
    if (result.status === 'AUTHENTICATED') {
      signedIn(result.tokens);
    } else {
      setChallengeId(result.challengeId);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    const tokens = await run(() =>
      apiFetch<IssuedTokens>('/auth/staff/mfa/verify', {
        method: 'POST',
        body: { hospitalCode: hospitalCode.trim(), challengeId, code: code.trim(), client: 'web' },
      }),
    );
    if (tokens) signedIn(tokens);
  }

  if (challengeId) {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code by SMS to your registered mobile number. It is valid for 5 minutes.
        </p>
        <Field id="code" label="SMS code" error={error ?? undefined}>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'code-error' : undefined}
          />
        </Field>
        <Button type="submit" disabled={pending || code.length !== 6}>
          {pending ? 'Checking…' : 'Verify and sign in'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setChallengeId(null);
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
      <Field
        id="hospitalCode"
        label="Hospital code"
        hint="Given to you by your hospital, e.g. city-care"
      >
        <Input
          id="hospitalCode"
          autoComplete="organization"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={hospitalCode}
          onChange={(e) => setHospitalCode(e.target.value)}
        />
      </Field>
      <Field id="identifier" label="Email or mobile number">
        <Input
          id="identifier"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
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
      <Button type="submit" disabled={pending || !hospitalCode || !identifier || !password}>
        {pending ? 'Signing in…' : 'Continue'}
      </Button>
    </form>
  );
}
