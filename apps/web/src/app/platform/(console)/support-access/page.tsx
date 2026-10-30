'use client';

import { Alert } from '@kenisha/ui/components/alert';
import { Badge } from '@kenisha/ui/components/badge';
import { Button } from '@kenisha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kenisha/ui/components/card';
import { Input, Select, Textarea } from '@kenisha/ui/components/input';
import { Field } from '@kenisha/ui/components/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kenisha/ui/components/table';
import { type FormEvent, useState } from 'react';
import { LoadState, PageHeader } from '@/components/console-shell';
import type { PlatformSupportRequest } from '@/lib/api/types';
import { usePlatformSession } from '@/lib/auth/session-context';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

/**
 * Break-glass requests (ADR-0003 section 8). Approval happens in the hospital's console;
 * using approved access from this web console is a later enhancement (API: POST
 * /platform/support-access/{id}/token).
 */
export default function PlatformSupportAccessPage() {
  const { session } = usePlatformSession();
  const requests = useApi(() =>
    session.request<PlatformSupportRequest[]>('/platform/support-access'),
  );
  const [hospitalCode, setHospitalCode] = useState('');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [sent, setSent] = useState(false);
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSent(false);
    const result = await action.run(() =>
      session.request('/platform/support-access', {
        method: 'POST',
        body: {
          hospitalCode: hospitalCode.trim().toLowerCase(),
          reason: reason.trim(),
          durationMinutes: Number(minutes),
        },
      }),
    );
    if (result) {
      setSent(true);
      setReason('');
      await requests.reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Support access"
        description="Ask a hospital for temporary, read-only access. The hospital admin decides; every use is logged for them."
      />
      <Card className="mb-6 max-w-2xl">
        <CardHeader>
          <CardTitle>New request</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {action.error ? <Alert variant="destructive">{action.error}</Alert> : null}
            {sent ? (
              <Alert variant="success">
                Request sent. The hospital admin will see it in their console.
              </Alert>
            ) : null}
            <Field id="s-code" label="Hospital code">
              <Input
                id="s-code"
                autoCapitalize="none"
                required
                value={hospitalCode}
                onChange={(e) => setHospitalCode(e.target.value)}
              />
            </Field>
            <Field
              id="s-reason"
              label="Reason"
              hint="Shown to the hospital admin. Include the ticket number. Never include patient details."
            >
              <Textarea
                id="s-reason"
                required
                minLength={20}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Field id="s-minutes" label="Duration">
              <Select id="s-minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="120">2 hours</option>
                <option value="240">4 hours (maximum)</option>
              </Select>
            </Field>
            <div>
              <Button
                type="submit"
                disabled={action.pending || !hospitalCode || reason.trim().length < 20}
              >
                {action.pending ? 'Sending…' : 'Send request'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <LoadState
        loading={requests.loading && !requests.data}
        error={requests.error}
        onRetry={requests.reload}
      />
      {requests.data && requests.data.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hospital</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Access until</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.tenant.name}</TableCell>
                <TableCell>{r.requesterName}</TableCell>
                <TableCell>
                  <Badge variant={r.status === 'APPROVED' ? 'default' : 'outline'}>
                    {r.status.toLowerCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(r.createdAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(r.approvedUntil)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}
