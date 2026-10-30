'use client';

import { HEALTHCARE_MODULES } from '@kenisha/shared';
import { Badge } from '@kenisha/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kenisha/ui/components/card';
import { LoadState, PageHeader } from '@/components/console-shell';
import type { TenantOverview } from '@/lib/api/types';
import { useStaffSession } from '@/lib/auth/session-context';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 100;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {used} of {max}
        </span>
      </div>
      <div
        className="mt-1 h-2 rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { session, me } = useStaffSession();
  const { data, error, loading, reload } = useApi(() => session.request<TenantOverview>('/tenant'));

  return (
    <>
      <PageHeader title={data?.name ?? 'Overview'} description={`Signed in as ${me.displayName}`} />
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Plan</CardTitle>
              <CardDescription>
                {data.plan.name ?? 'No active plan'}
                {data.plan.currentPeriodEnd
                  ? ` · renews ${formatDate(data.plan.currentPeriodEnd)}`
                  : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!data.plan.canGrow ? (
                <p className="text-sm text-destructive">
                  New staff and branches cannot be added until the subscription is in good standing.
                </p>
              ) : null}
              <Usage
                label="Active branches"
                used={data.usage.activeBranches}
                max={data.plan.maxBranches}
              />
              <Usage
                label="Staff accounts (incl. pending invitations)"
                used={data.usage.activeStaff + data.usage.pendingInvitations}
                max={data.plan.maxStaffUsers}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Modules</CardTitle>
              <CardDescription>Included in your plan</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {HEALTHCARE_MODULES.map((module) => {
                  const enabled = data.plan.enabledModules.includes(module.key);
                  return (
                    <li
                      key={module.key}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span>{module.name}</span>
                      <Badge variant={enabled ? 'default' : 'outline'}>
                        {enabled ? 'Included' : 'Not included'}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Security settings</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Hospital code: </span>
                <code>{data.code}</code>
              </p>
              <p>
                <span className="text-muted-foreground">Branch access: </span>
                {data.branchScopeMode === 'TENANT_WIDE'
                  ? 'All staff see all branches'
                  : 'Staff see assigned branches only'}
              </p>
              <p>
                <span className="text-muted-foreground">SMS code at sign-in: </span>
                {data.staffMfaMode === 'ALL_STAFF' ? 'All staff' : 'Admins only'}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
