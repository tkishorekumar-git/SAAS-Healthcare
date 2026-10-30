'use client';

import { Badge } from '@kenisha/ui/components/badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kenisha/ui/components/table';
import { LoadState, PageHeader } from '@/components/console-shell';
import type { AuditEvent, StaffMember } from '@/lib/api/types';
import { useCan, useStaffSession } from '@/lib/auth/session-context';
import { formatDateTime, humanize } from '@/lib/format';
import { useApi } from '@/lib/use-api';

export default function AuditPage() {
  const { session } = useStaffSession();
  const can = useCan();
  const events = useApi(() => session.request<AuditEvent[]>('/audit-events'));
  // Names make the log readable; the log itself only stores IDs.
  const staff = useApi(() =>
    can('staff:read') ? session.request<StaffMember[]>('/staff') : Promise.resolve([]),
  );
  const names = new Map((staff.data ?? []).map((s) => [s.userId, s.displayName]));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Security events in this hospital. Entries cannot be edited or deleted."
      />
      <LoadState
        loading={events.loading && !events.data}
        error={events.error}
        onRetry={events.reload}
      />
      {events.data ? (
        <Table>
          <TableCaption>Latest 100 events</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.data.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                </TableCell>
                <TableCell>{humanize(event.action)}</TableCell>
                <TableCell>
                  <Badge variant={event.outcome === 'SUCCESS' ? 'secondary' : 'destructive'}>
                    {event.outcome === 'SUCCESS' ? 'Success' : 'Failed'}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {event.action.startsWith('SUPPORT_ACCESS_USED')
                    ? 'Kenisha support'
                    : event.actorUserId
                      ? (names.get(event.actorUserId) ?? 'Staff member')
                      : 'Unknown'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}
