'use client';

import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from '@kenisha/shared';
import { useId } from 'react';
import type { Branch } from '@/lib/api/types';

/** Checkbox group: accessible multi-select without extra dependencies. */
function CheckboxGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: Array<{ value: T; label: string }>;
  value: T[];
  onChange: (next: T[]) => void;
}) {
  const groupId = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => {
          // Explicit id/htmlFor so every assistive technology announces the option's name.
          const id = `${groupId}-${option.value}`;
          return (
            <div key={option.value} className="flex items-center gap-2 text-sm">
              <input
                id={id}
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={value.includes(option.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, option.value]
                      : value.filter((v) => v !== option.value),
                  )
                }
              />
              <label htmlFor={id}>{option.label}</label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RolePicker({
  value,
  onChange,
}: {
  value: StaffRole[];
  onChange: (next: StaffRole[]) => void;
}) {
  return (
    <CheckboxGroup
      legend="Roles"
      options={STAFF_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
      value={value}
      onChange={onChange}
    />
  );
}

export function BranchPicker({
  branches,
  value,
  onChange,
}: {
  branches: Branch[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const active = branches.filter((b) => b.isActive);
  if (active.length === 0) {
    return <p className="text-sm text-muted-foreground">No active branches yet.</p>;
  }
  return (
    <CheckboxGroup
      legend="Branches (used when staff see assigned branches only)"
      options={active.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
      value={value}
      onChange={onChange}
    />
  );
}
