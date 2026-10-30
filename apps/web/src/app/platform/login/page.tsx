import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { PlatformLoginForm } from './platform-login-form';

export const metadata: Metadata = { title: 'Platform sign in' };

export default function PlatformLoginPage() {
  return (
    <AuthCard
      title="Kenisha platform"
      description="For Kenisha staff only. Requires an authenticator app."
      footer={
        <>
          Hospital staff?{' '}
          <Link className="underline" href="/login">
            Staff sign in
          </Link>
        </>
      }
    >
      <PlatformLoginForm />
    </AuthCard>
  );
}
