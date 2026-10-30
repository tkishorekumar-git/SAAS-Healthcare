import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth-card';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Activate your account' };

export default function InvitePage() {
  return (
    <AuthCard
      title="Activate your account"
      description="You have been invited to Kenisha Healthcare."
    >
      <Suspense>
        <InviteForm />
      </Suspense>
    </AuthCard>
  );
}
