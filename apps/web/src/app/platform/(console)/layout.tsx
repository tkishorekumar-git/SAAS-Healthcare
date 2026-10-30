'use client';

import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console-shell';
import { PlatformSessionProvider, usePlatformSession } from '@/lib/auth/session-context';

function PlatformShell({ children }: { children: ReactNode }) {
  const { me, logout } = usePlatformSession();
  return (
    <ConsoleShell
      product="Kenisha platform"
      subtitle="Super Admin"
      userName={me.displayName}
      nav={[
        { href: '/platform', label: 'Hospitals' },
        { href: '/platform/support-access', label: 'Support access' },
      ]}
      onLogout={() => void logout()}
    >
      {children}
    </ConsoleShell>
  );
}

export default function PlatformConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformSessionProvider>
      <PlatformShell>{children}</PlatformShell>
    </PlatformSessionProvider>
  );
}
