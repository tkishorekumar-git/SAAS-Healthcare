'use client';

import { Alert } from '@kenisha/ui/components/alert';
import { Badge } from '@kenisha/ui/components/badge';
import { Button } from '@kenisha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kenisha/ui/components/card';
import { LoadState, PageHeader } from '@/components/console-shell';
import type { SupportAccessRequest } from '@/lib/api/types';
import { useStaffSession } from '@/lib/auth/session-context';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

function statusOf(request: SupportAccessRequest): {
  label: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
} {
  if (request.status === 'APPROVED') {
    return request.active
      ? { label: 'Access active', variant: 'destructive' }
      : { label: 'Ended', variant: 'outline' };
  }
  return {
    REQUESTED: { label: 'Waiting for you', variant: 'default' as const },
    REJECTED: { label: 'Rejected', variant: 'outline' as const },
    REVOKED: { label: 'Revoked', variant: 'outline' as const },
  }[request.status];
}

/** Break-glass approvals (ADR-0003 section 8): Kenisha support can only enter if you agree. */
export default function SupportAccessPage() {
  const { session } = useStaffSession();
  const requests = useApi(() =>
    session.request<SupportAccessRequest[]>('/support-access-requests'),
  );
  const action = useAction();

  async function decide(request: SupportAccessRequest, verb: 'approve' | 'reject' | 'revoke') {
    const prompts = {
      approve: `Allow ${request.requesterName} read-only access for ${request.requestedMinutes} minutes, starting now?`,
      reject: `Reject the request from ${request.requesterName}?`,
      revoke: `End ${request.requesterName}'s access now?`,
    };
    if (!window.confirm(prompts[verb])) return;
    await action.run(() =>
      session.request(`/support-access-requests/${request.id}/${verb}`, { method: 'POST' }),
    );
    await requests.reload();
  }

  return (
    <>
      <PageHeader
        title="Support access"
        description="Kenisha support can see your hospital's administrative data only if you approve, for a limited time, read-only. Every page they open appears in your audit log."
      />
      {action.error ? (
        <Alert variant="destructive" className="mb-4">
          {action.error}
        </Alert>
      ) : null}
      <LoadState
        loading={requests.loading && !requests.data}
        error={requests.error}
        onRetry={requests.reload}
      />
      {requests.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No support access requests.</p>
      ) : null}
      <div className="flex flex-col gap-4">
        {requests.data?.map((request) => {
          const status = statusOf(request);
          return (
            <Card key={request.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{request.requesterName}</CardTitle>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                <CardDescription>
                  Requested {formatDateTime(request.createdAt)} · {request.requestedMinutes} minutes
                  {request.active ? ` · until ${formatDateTime(request.approvedUntil)}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm whitespace-pre-wrap">{request.reason}</p>
                {request.status === 'REQUESTED' ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={action.pending}
                      onClick={() => void decide(request, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.pending}
                      onClick={() => void decide(request, 'reject')}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
                {request.active ? (
                  <div>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={action.pending}
                      onClick={() => void decide(request, 'revoke')}
                    >
                      End access now
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
