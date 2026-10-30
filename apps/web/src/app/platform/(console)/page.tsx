'use client';

import { Alert } from '@kenisha/ui/components/alert';
import { Badge } from '@kenisha/ui/components/badge';
import { Button } from '@kenisha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kenisha/ui/components/card';
import { Input } from '@kenisha/ui/components/input';
import { Field } from '@kenisha/ui/components/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kenisha/ui/components/table';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { LoadState, PageHeader } from '@/components/console-shell';
import type { PlatformTenantSummary } from '@/lib/api/types';
import { usePlatformSession } from '@/lib/auth/session-context';
import { useAction, useApi } from '@/lib/use-api';

const STATUS_VARIANT = {
  ACTIVE: 'secondary',
  ONBOARDING: 'default',
  SUSPENDED: 'destructive',
} as const;

function OnboardForm({ onDone }: { onDone: () => void }) {
  const { session } = usePlatformSession();
  const [form, setForm] = useState({
    code: '',
    name: '',
    planCode: 'STARTER',
    adminName: '',
    adminPhone: '',
    adminEmail: '',
  });
  const [created, setCreated] = useState<string | null>(null);
  const { pending, error, run } = useAction();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { adminEmail, ...rest } = form;
    const result = await run(() =>
      session.request<{ code: string }>('/platform/tenants', {
        method: 'POST',
        body: {
          ...rest,
          code: rest.code.trim().toLowerCase(),
          ...(adminEmail.trim() ? { adminEmail: adminEmail.trim() } : {}),
        },
      }),
    );
    if (result) {
      setCreated(result.code);
      setForm({
        code: '',
        name: '',
        planCode: form.planCode,
        adminName: '',
        adminPhone: '',
        adminEmail: '',
      });
      onDone();
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Onboard a hospital</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
          {error ? (
            <Alert variant="destructive" className="md:col-span-2">
              {error}
            </Alert>
          ) : null}
          {created ? (
            <Alert variant="success" className="md:col-span-2">
              {created} created. The first admin has been sent an SMS invitation (valid 72 hours).
            </Alert>
          ) : null}
          <Field
            id="t-code"
            label="Hospital code"
            hint="Lower-case, used to sign in, e.g. city-care"
          >
            <Input
              id="t-code"
              autoCapitalize="none"
              required
              value={form.code}
              onChange={set('code')}
            />
          </Field>
          <Field id="t-name" label="Hospital name">
            <Input id="t-name" required value={form.name} onChange={set('name')} />
          </Field>
          <Field id="t-plan" label="Plan code" hint="STARTER, PROFESSIONAL or ENTERPRISE">
            <Input id="t-plan" required value={form.planCode} onChange={set('planCode')} />
          </Field>
          <Field id="t-admin" label="First admin's name">
            <Input id="t-admin" required value={form.adminName} onChange={set('adminName')} />
          </Field>
          <Field
            id="t-phone"
            label="First admin's mobile"
            hint="International format, e.g. +919876543210"
          >
            <Input
              id="t-phone"
              type="tel"
              required
              value={form.adminPhone}
              onChange={set('adminPhone')}
            />
          </Field>
          <Field id="t-email" label="First admin's email (optional)">
            <Input id="t-email" type="email" value={form.adminEmail} onChange={set('adminEmail')} />
          </Field>
          <div className="md:col-span-2">
            <Button
              type="submit"
              disabled={pending || !form.code || !form.name || !form.adminName || !form.adminPhone}
            >
              {pending ? 'Creating…' : 'Create hospital and invite admin'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function HospitalsPage() {
  const { session } = usePlatformSession();
  const tenants = useApi(() => session.request<PlatformTenantSummary[]>('/platform/tenants'));
  const [onboarding, setOnboarding] = useState(false);

  return (
    <>
      <PageHeader
        title="Hospitals"
        description="Usage is shown as counts only — the platform cannot see staff or patient data."
        actions={
          <Button onClick={() => setOnboarding((v) => !v)}>
            {onboarding ? 'Close' : 'Onboard hospital'}
          </Button>
        }
      />
      {onboarding ? <OnboardForm onDone={() => void tenants.reload()} /> : null}
      <LoadState
        loading={tenants.loading && !tenants.data}
        error={tenants.error}
        onRetry={tenants.reload}
      />
      {tenants.data ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hospital</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Branches</TableHead>
              <TableHead className="text-right">Staff</TableHead>
              <TableHead className="text-right">Invited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.data.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell>
                  <Link
                    href={`/platform/hospitals/${tenant.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {tenant.name}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">{tenant.code}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[tenant.status]}>
                    {tenant.status.toLowerCase()}
                  </Badge>
                </TableCell>
                <TableCell>{tenant.plan?.name ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {tenant.usage.activeBranches}
                  {tenant.plan ? ` / ${tenant.plan.maxBranches}` : ''}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {tenant.usage.activeStaff}
                  {tenant.plan ? ` / ${tenant.plan.maxStaffUsers}` : ''}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {tenant.usage.pendingInvitations}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}
