'use client';

import { Alert } from '@kenisha/ui/components/alert';
import { Button } from '@kenisha/ui/components/button';
import { Card, CardContent } from '@kenisha/ui/components/card';
import { Input, Select } from '@kenisha/ui/components/input';
import { Field } from '@kenisha/ui/components/label';
import { type FormEvent, useEffect, useState } from 'react';
import { LoadState, PageHeader } from '@/components/console-shell';
import type { TenantOverview } from '@/lib/api/types';
import { useStaffSession } from '@/lib/auth/session-context';
import { useAction, useApi } from '@/lib/use-api';

export default function SettingsPage() {
  const { session } = useStaffSession();
  const tenant = useApi(() => session.request<TenantOverview>('/tenant'));
  const [name, setName] = useState('');
  const [branchScopeMode, setBranchScopeMode] =
    useState<TenantOverview['branchScopeMode']>('TENANT_WIDE');
  const [staffMfaMode, setStaffMfaMode] = useState<TenantOverview['staffMfaMode']>('ALL_STAFF');
  const [saved, setSaved] = useState(false);
  const action = useAction();

  useEffect(() => {
    if (tenant.data) {
      setName(tenant.data.name);
      setBranchScopeMode(tenant.data.branchScopeMode);
      setStaffMfaMode(tenant.data.staffMfaMode);
    }
  }, [tenant.data]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const result = await action.run(() =>
      session.request<TenantOverview>('/tenant', {
        method: 'PATCH',
        body: { name: name.trim(), branchScopeMode, staffMfaMode },
      }),
    );
    if (result) {
      setSaved(true);
      await tenant.reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Changes take effect at the next sign-in or page load."
      />
      <LoadState
        loading={tenant.loading && !tenant.data}
        error={tenant.error}
        onRetry={tenant.reload}
      />
      {tenant.data ? (
        <Card className="max-w-2xl">
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
              {action.error ? <Alert variant="destructive">{action.error}</Alert> : null}
              {saved ? <Alert variant="success">Settings saved.</Alert> : null}
              <Field id="name" label="Hospital name">
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field
                id="scope"
                label="Branch access"
                hint="With 'assigned branches', staff other than Hospital Admin and Management see only the branches they are assigned to."
              >
                <Select
                  id="scope"
                  value={branchScopeMode}
                  onChange={(e) =>
                    setBranchScopeMode(e.target.value as TenantOverview['branchScopeMode'])
                  }
                >
                  <option value="TENANT_WIDE">All staff see all branches</option>
                  <option value="ASSIGNED_BRANCHES">Staff see assigned branches only</option>
                </Select>
              </Field>
              <Field
                id="mfa"
                label="SMS code at sign-in"
                hint="Hospital Admin and Management always need the SMS code. Requiring it for everyone is safer."
              >
                <Select
                  id="mfa"
                  value={staffMfaMode}
                  onChange={(e) =>
                    setStaffMfaMode(e.target.value as TenantOverview['staffMfaMode'])
                  }
                >
                  <option value="ALL_STAFF">Required for all staff (recommended)</option>
                  <option value="ADMINS_ONLY">Required for admins only</option>
                </Select>
              </Field>
              <div>
                <Button type="submit" disabled={action.pending || name.trim().length < 2}>
                  {action.pending ? 'Saving…' : 'Save settings'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
