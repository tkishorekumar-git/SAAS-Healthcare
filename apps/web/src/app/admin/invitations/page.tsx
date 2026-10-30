'use client';

import { Alert } from '@kenisha/ui/components/alert';
import { Badge } from '@kenisha/ui/components/badge';
import { Button } from '@kenisha/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kenisha/ui/components/table';
import { LoadState, PageHeader } from '@/components/console-shell';
import type { Invitation } from '@/lib/api/types';
import { useCan, useStaffSession } from '@/lib/auth/session-context';
import { formatDateTime, roleList } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

const STATUS: Record<
  Invitation['status'],
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  PENDING: { label: 'Pending', variant: 'default' },
  EXPIRED: { label: 'Expired', variant: 'destructive' },
  ACCEPTED: { label: 'Accepted', variant: 'secondary' },
  REVOKED: { label: 'Revoked', variant: 'outline' },
};

export default function InvitationsPage() {
  const { session } = useStaffSession();
  const can = useCan();
  const invitations = useApi(() => session.request<Invitation[]>('/staff-invitations'));
  const action = useAction();
  const canManage = can('staff:manage');

  async function act(invitation: Invitation, verb: 'resend' | 'revoke') {
    if (
      verb === 'revoke' &&
      !window.confirm(`Cancel the invitation for ${invitation.displayName}?`)
    )
      return;
    await action.run(() =>
      session.request(`/staff-invitations/${invitation.id}/${verb}`, { method: 'POST' }),
    );
    await invitations.reload();
  }

  return (
    <>
      <PageHeader
        title="Invitations"
        description="Invitation links are valid for 72 hours and can be used once."
      />
      {action.error ? (
        <Alert variant="destructive" className="mb-4">
          {action.error}
        </Alert>
      ) : null}
      <LoadState
        loading={invitations.loading && !invitations.data}
        error={invitations.error}
        onRetry={invitations.reload}
      />
      {invitations.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invitations yet.</p>
      ) : null}
      {invitations.data && invitations.data.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.data.map((invitation) => {
              const open = invitation.status === 'PENDING' || invitation.status === 'EXPIRED';
              return (
                <TableRow key={invitation.id}>
                  <TableCell className="font-medium">
                    {invitation.displayName}
                    {invitation.invitedBy === 'KENISHA' ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (set up by Kenisha)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{invitation.phoneE164}</TableCell>
                  <TableCell>{roleList(invitation.roles)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS[invitation.status].variant}>
                      {STATUS[invitation.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {open ? formatDateTime(invitation.expiresAt) : '—'}
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      {open ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={action.pending}
                            onClick={() => void act(invitation, 'resend')}
                          >
                            Resend
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={action.pending}
                            onClick={() => void act(invitation, 'revoke')}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}
