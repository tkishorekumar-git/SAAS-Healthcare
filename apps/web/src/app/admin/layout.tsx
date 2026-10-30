'use client';

import type { Permission } from '@kenisha/shared';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavItem } from '@/components/console-shell';
import { StaffSessionProvider, useStaffSession } from '@/lib/auth/session-context';
import { roleList } from '@/lib/format';

const NAV: Array<NavItem & { permission: Permission }> = [
  { href: '/admin', label: 'Overview', permission: 'tenant:read' },
  { href: '/admin/staff', label: 'Staff', permission: 'staff:read' },
  { href: '/admin/invitations', label: 'Invitations', permission: 'staff:read' },
  { href: '/admin/branches', label: 'Branches', permission: 'branch:read' },
  { href: '/admin/settings', label: 'Settings', permission: 'tenant:settings' },
  { href: '/admin/support-access', label: 'Support access', permission: 'support_access:manage' },
  { href: '/admin/audit', label: 'Audit log', permission: 'audit:read' },
];

function AdminShell({ children }: { children: ReactNode }) {
  const { me, logout } = useStaffSession();
  const nav = NAV.filter((item) => me.permissions.includes(item.permission));
  return (
    <ConsoleShell
      product="Kenisha Healthcare"
      subtitle="Hospital administration"
      userName={`${me.displayName} · ${roleList(me.roles)}`}
      nav={nav}
      onLogout={() => void logout()}
    >
      {children}
    </ConsoleShell>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <StaffSessionProvider>
      <AdminShell>{children}</AdminShell>
    </StaffSessionProvider>
  );
}
