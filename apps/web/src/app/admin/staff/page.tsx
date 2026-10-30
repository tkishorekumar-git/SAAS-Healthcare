'use client';

import type { StaffRole } from '@kenisha/shared';
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
import { BranchPicker, RolePicker } from '@/components/pickers';
import type { Branch, StaffMember } from '@/lib/api/types';
import { useCan, useStaffSession } from '@/lib/auth/session-context';
import { roleList } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

function InviteForm({ branches, onDone }: { branches: Branch[]; onDone: () => void }) {
  const { session } = useStaffSession();
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  const { pending, error, run } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() =>
      session.request('/staff-invitations', {
        method: 'POST',
        body: {
          displayName: displayName.trim(),
          phone: phone.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          roles,
          branchIds,
        },
      }),
    );
    if (result) {
      setSent(displayName.trim());
      setDisplayName('');
      setPhone('');
      setEmail('');
      setRoles([]);
      setBranchIds([]);
      onDone();
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Invite a staff member</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
          {error ? (
            <Alert variant="destructive" className="md:col-span-2">
              {error}
            </Alert>
          ) : null}
          {sent ? (
            <Alert variant="success" className="md:col-span-2">
              Invitation sent to {sent}. It is valid for 72 hours.
            </Alert>
          ) : null}
          <Field id="invite-name" label="Full name">
            <Input
              id="invite-name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field
            id="invite-phone"
            label="Mobile number"
            hint="International format, e.g. +919876543210"
          >
            <Input
              id="invite-phone"
              type="tel"
              autoComplete="off"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field id="invite-email" label="Email (optional)" className="md:col-span-2">
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div className="md:col-span-2">
            <RolePicker value={roles} onChange={setRoles} />
          </div>
          <div className="md:col-span-2">
            <BranchPicker branches={branches} value={branchIds} onChange={setBranchIds} />
          </div>
          <div className="md:col-span-2">
            <Button
              type="submit"
              disabled={pending || !displayName || !phone || roles.length === 0}
            >
              {pending ? 'Sending…' : 'Send invitation'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EditStaff({
  member,
  branches,
  onDone,
}: {
  member: StaffMember;
  branches: Branch[];
  onDone: () => void;
}) {
  const { session } = useStaffSession();
  const [roles, setRoles] = useState<StaffRole[]>(member.roles);
  const [branchIds, setBranchIds] = useState<string[]>(member.branchIds);
  const { pending, error, run } = useAction();

  async function save() {
    const ok = await run(async () => {
      if (JSON.stringify([...roles].sort()) !== JSON.stringify([...member.roles].sort())) {
        await session.request(`/staff/${member.userId}/roles`, { method: 'PUT', body: { roles } });
      }
      if (JSON.stringify([...branchIds].sort()) !== JSON.stringify([...member.branchIds].sort())) {
        await session.request(`/staff/${member.userId}/branches`, {
          method: 'PUT',
          body: { branchIds },
        });
      }
      return true;
    });
    if (ok) onDone();
  }

  return (
    <div className="flex flex-col gap-4 rounded-md bg-muted/40 p-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <RolePicker value={roles} onChange={setRoles} />
      <BranchPicker branches={branches} value={branchIds} onChange={setBranchIds} />
      <p className="text-xs text-muted-foreground">
        Changing roles signs this person out of every device.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={pending || roles.length === 0}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const { session, me } = useStaffSession();
  const can = useCan();
  const staff = useApi(() => session.request<StaffMember[]>('/staff'));
  const branches = useApi(() => session.request<Branch[]>('/branches'));
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const action = useAction();
  const canManage = can('staff:manage');

  const branchNames = new Map((branches.data ?? []).map((b) => [b.id, b.code]));

  async function act(member: StaffMember, verb: 'disable' | 'enable' | 'unlock') {
    if (
      verb === 'disable' &&
      !window.confirm(`Disable ${member.displayName}? They will be signed out everywhere.`)
    )
      return;
    await action.run(() => session.request(`/staff/${member.userId}/${verb}`, { method: 'POST' }));
    await staff.reload();
  }

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone who can sign in to this hospital."
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/admin/invitations">Pending invitations</Link>
              </Button>
              <Button onClick={() => setInviting((v) => !v)}>
                {inviting ? 'Close' : 'Invite staff'}
              </Button>
            </div>
          ) : null
        }
      />
      {inviting && canManage ? (
        <InviteForm branches={branches.data ?? []} onDone={() => void staff.reload()} />
      ) : null}
      {action.error ? (
        <Alert variant="destructive" className="mb-4">
          {action.error}
        </Alert>
      ) : null}
      <LoadState
        loading={staff.loading && !staff.data}
        error={staff.error}
        onRetry={staff.reload}
      />
      {staff.data ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Branches</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.data.map((member) => {
              const self = member.userId === me.userId;
              return [
                <TableRow key={member.userId}>
                  <TableCell className="font-medium">
                    {member.displayName}
                    {self ? (
                      <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div>{member.phoneE164}</div>
                    {member.email ? <div className="text-xs">{member.email}</div> : null}
                  </TableCell>
                  <TableCell>{roleList(member.roles)}</TableCell>
                  <TableCell>
                    {member.branchIds.map((id) => branchNames.get(id) ?? '?').join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={member.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                        {member.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                      </Badge>
                      {member.locked ? <Badge variant="destructive">Locked</Badge> : null}
                    </div>
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      {self ? null : (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setEditing(editing === member.userId ? null : member.userId)
                            }
                          >
                            Edit
                          </Button>
                          {member.locked ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={action.pending}
                              onClick={() => void act(member, 'unlock')}
                            >
                              Unlock
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={action.pending}
                            onClick={() =>
                              void act(member, member.status === 'ACTIVE' ? 'disable' : 'enable')
                            }
                          >
                            {member.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>,
                editing === member.userId ? (
                  <TableRow key={`${member.userId}-edit`}>
                    <TableCell colSpan={6}>
                      <EditStaff
                        member={member}
                        branches={branches.data ?? []}
                        onDone={() => {
                          setEditing(null);
                          void staff.reload();
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ) : null,
              ];
            })}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}
