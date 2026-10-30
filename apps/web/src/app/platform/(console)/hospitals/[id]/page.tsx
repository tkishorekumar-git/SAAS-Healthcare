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
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { LoadState, PageHeader } from '@/components/console-shell';
import type { PlatformTenantDetail } from '@/lib/api/types';
import { usePlatformSession } from '@/lib/auth/session-context';
import { formatDate, formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

export default function HospitalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = usePlatformSession();
  const tenant = useApi(() => session.request<PlatformTenantDetail>(`/platform/tenants/${id}`));
  const [planCode, setPlanCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();

  async function run(
    label: string,
    path: string,
    method: 'POST' | 'PUT',
    body?: unknown,
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setNotice(null);
    const result = await action.run(() =>
      session.request(path, { method, ...(body ? { body } : {}) }),
    );
    if (result) {
      setNotice(label);
      await tenant.reload();
    }
  }

  async function changePlan(event: FormEvent) {
    event.preventDefault();
    await run(`Plan changed to ${planCode.trim()}.`, `/platform/tenants/${id}/plan`, 'PUT', {
      planCode: planCode.trim(),
    });
    setPlanCode('');
  }

  const data = tenant.data;
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/platform" className="text-muted-foreground underline-offset-4 hover:underline">
          ← Hospitals
        </Link>
      </p>
      <PageHeader
        title={data?.name ?? 'Hospital'}
        description={data ? `Code ${data.code} · created ${formatDate(data.createdAt)}` : undefined}
        actions={
          data ? (
            <div className="flex gap-2">
              {data.status === 'ACTIVE' ? (
                <Button
                  variant="destructive"
                  disabled={action.pending}
                  onClick={() =>
                    void run(
                      'Hospital suspended. All its sessions have ended.',
                      `/platform/tenants/${id}/suspend`,
                      'POST',
                      undefined,
                      `Suspend ${data.name}? Every user is signed out immediately and cannot sign in.`,
                    )
                  }
                >
                  Suspend
                </Button>
              ) : null}
              {data.status === 'SUSPENDED' ? (
                <Button
                  disabled={action.pending}
                  onClick={() =>
                    void run('Hospital reactivated.', `/platform/tenants/${id}/reactivate`, 'POST')
                  }
                >
                  Reactivate
                </Button>
              ) : null}
              {data.status === 'ONBOARDING' ? (
                <Button
                  variant="outline"
                  disabled={action.pending}
                  onClick={() =>
                    void run(
                      'A new invitation was sent to the first admin.',
                      `/platform/tenants/${id}/admin-invitation`,
                      'POST',
                    )
                  }
                >
                  Resend admin invitation
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      {action.error ? (
        <Alert variant="destructive" className="mb-4">
          {action.error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      <LoadState loading={tenant.loading && !data} error={tenant.error} onRetry={tenant.reload} />
      {data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Status and usage</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <span className="text-muted-foreground">Status</span>
              <span>
                <Badge variant={data.status === 'SUSPENDED' ? 'destructive' : 'secondary'}>
                  {data.status.toLowerCase()}
                </Badge>
              </span>
              <span className="text-muted-foreground">Plan</span>
              <span>{data.plan?.name ?? '—'}</span>
              <span className="text-muted-foreground">Active branches</span>
              <span>
                {data.usage.activeBranches} / {data.plan?.maxBranches ?? 0}
              </span>
              <span className="text-muted-foreground">Active staff</span>
              <span>
                {data.usage.activeStaff} / {data.plan?.maxStaffUsers ?? 0}
              </span>
              <span className="text-muted-foreground">Pending invitations</span>
              <span>{data.usage.pendingInvitations}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Change plan</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={changePlan} className="flex flex-col gap-3" noValidate>
                <Field
                  id="plan"
                  label="New plan code"
                  hint="Starts a new subscription today; the current one is cancelled."
                >
                  <Input
                    id="plan"
                    value={planCode}
                    onChange={(e) => setPlanCode(e.target.value.toUpperCase())}
                  />
                </Field>
                <div>
                  <Button type="submit" disabled={action.pending || !planCode.trim()}>
                    Change plan
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Subscriptions</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.subscriptions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.planCode}</TableCell>
                      <TableCell>{s.status.toLowerCase()}</TableCell>
                      <TableCell>{formatDate(s.currentPeriodStart)}</TableCell>
                      <TableCell>
                        {s.cancelledAt
                          ? `cancelled ${formatDate(s.cancelledAt)}`
                          : formatDate(s.currentPeriodEnd)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>First-admin invitations</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {data.adminInvitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{i.displayName}</span>
                    <Badge variant="outline">{i.status.toLowerCase()}</Badge>
                    <span className="text-muted-foreground">
                      {i.acceptedAt
                        ? `accepted ${formatDateTime(i.acceptedAt)}`
                        : `sent ${formatDateTime(i.createdAt)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
