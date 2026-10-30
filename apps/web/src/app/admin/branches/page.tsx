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
import { type FormEvent, useState } from 'react';
import { LoadState, PageHeader } from '@/components/console-shell';
import type { Branch } from '@/lib/api/types';
import { useCan, useStaffSession } from '@/lib/auth/session-context';
import { useAction, useApi } from '@/lib/use-api';

type BranchForm = {
  code: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
};
const EMPTY: BranchForm = {
  code: '',
  name: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  phone: '',
};

function BranchEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: BranchForm;
  onSave: (form: BranchForm) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [pending, setPending] = useState(false);
  const set = (key: keyof BranchForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const ok = await onSave(form);
    setPending(false);
    if (ok) setForm(EMPTY);
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
      <Field id="b-code" label="Code" hint="Upper-case letters, digits or -, e.g. BLR-02">
        <Input
          id="b-code"
          required
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
        />
      </Field>
      <Field id="b-name" label="Name">
        <Input id="b-name" required value={form.name} onChange={set('name')} />
      </Field>
      <Field id="b-address" label="Address (optional)" className="md:col-span-2">
        <Input id="b-address" value={form.addressLine1} onChange={set('addressLine1')} />
      </Field>
      <Field id="b-city" label="City">
        <Input id="b-city" required value={form.city} onChange={set('city')} />
      </Field>
      <Field id="b-state" label="State">
        <Input id="b-state" required value={form.state} onChange={set('state')} />
      </Field>
      <Field id="b-postal" label="PIN code (optional)">
        <Input id="b-postal" value={form.postalCode} onChange={set('postalCode')} />
      </Field>
      <Field id="b-phone" label="Phone (optional)">
        <Input id="b-phone" type="tel" value={form.phone} onChange={set('phone')} />
      </Field>
      <div className="flex gap-2 md:col-span-2">
        <Button
          type="submit"
          disabled={pending || !form.code || !form.name || !form.city || !form.state}
        >
          {pending ? 'Saving…' : 'Save branch'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Only send fields that have a value; empty optional fields are left out. */
function payload(form: BranchForm) {
  return Object.fromEntries(
    Object.entries(form)
      .map(([k, v]) => [k, v.trim()])
      .filter(([, v]) => v !== ''),
  );
}

export default function BranchesPage() {
  const { session } = useStaffSession();
  const can = useCan();
  const branches = useApi(() => session.request<Branch[]>('/branches'));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const action = useAction();
  const canManage = can('branch:manage');

  async function save(path: string, method: 'POST' | 'PATCH', form: BranchForm) {
    const result = await action.run(() => session.request(path, { method, body: payload(form) }));
    if (result) {
      setAdding(false);
      setEditing(null);
      await branches.reload();
      return true;
    }
    return false;
  }

  async function toggle(branch: Branch) {
    const verb = branch.isActive ? 'deactivate' : 'reactivate';
    if (branch.isActive && !window.confirm(`Deactivate ${branch.name}? Its history is kept.`))
      return;
    await action.run(() => session.request(`/branches/${branch.id}/${verb}`, { method: 'POST' }));
    await branches.reload();
  }

  return (
    <>
      <PageHeader
        title="Branches"
        description="Locations of this hospital. Branches are deactivated, never deleted."
        actions={
          canManage ? (
            <Button onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Add branch'}</Button>
          ) : null
        }
      />
      {action.error ? (
        <Alert variant="destructive" className="mb-4">
          {action.error}
        </Alert>
      ) : null}
      {adding ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New branch</CardTitle>
          </CardHeader>
          <CardContent>
            <BranchEditor
              initial={EMPTY}
              onSave={(form) => save('/branches', 'POST', form)}
              onCancel={() => setAdding(false)}
            />
          </CardContent>
        </Card>
      ) : null}
      <LoadState
        loading={branches.loading && !branches.data}
        error={branches.error}
        onRetry={branches.reload}
      />
      {branches.data ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.data.map((branch) => [
              <TableRow key={branch.id}>
                <TableCell className="font-mono text-xs">{branch.code}</TableCell>
                <TableCell className="font-medium">{branch.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {branch.city}, {branch.state}
                </TableCell>
                <TableCell>
                  <Badge variant={branch.isActive ? 'secondary' : 'outline'}>
                    {branch.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                {canManage ? (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(editing === branch.id ? null : branch.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={action.pending}
                        onClick={() => void toggle(branch)}
                      >
                        {branch.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>,
              editing === branch.id ? (
                <TableRow key={`${branch.id}-edit`}>
                  <TableCell colSpan={5}>
                    <BranchEditor
                      initial={{
                        code: branch.code,
                        name: branch.name,
                        addressLine1: branch.addressLine1 ?? '',
                        city: branch.city,
                        state: branch.state,
                        postalCode: branch.postalCode ?? '',
                        phone: branch.phone ?? '',
                      }}
                      onSave={(form) => save(`/branches/${branch.id}`, 'PATCH', form)}
                      onCancel={() => setEditing(null)}
                    />
                  </TableCell>
                </TableRow>
              ) : null,
            ])}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}
