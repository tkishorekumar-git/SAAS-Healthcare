import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth-card';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Staff sign in' };

export default function LoginPage() {
  return (
    <AuthCard
      title="Staff sign in"
      description="For hospital staff. Patients use the Kenisha mobile app."
      footer={
        <>
          Kenisha team?{' '}
          <Link className="underline" href="/platform/login">
            Platform sign in
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
