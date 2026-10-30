'use client';

import { Button } from '@kenisha/ui/components/button';
import { cn } from '@kenisha/ui/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface NavItem {
  href: string;
  label: string;
}

/** Shared layout for the Hospital Admin and Super Admin consoles. */
export function ConsoleShell({
  product,
  subtitle,
  userName,
  nav,
  onLogout,
  children,
}: {
  product: string;
  subtitle: string;
  userName: string;
  nav: NavItem[];
  onLogout: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || (href.split('/').length > 2 && pathname.startsWith(`${href}/`));

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="border-b bg-muted/40 md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 p-4 md:block">
          <div>
            <p className="text-sm font-semibold text-primary">{product}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <nav aria-label="Main" className="overflow-x-auto px-2 pb-2 md:pb-4">
          <ul className="flex gap-1 md:flex-col">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'block rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-accent',
                    isActive(item.href) && 'bg-accent font-medium text-accent-foreground',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b px-4 py-3">
          <span className="truncate text-sm text-muted-foreground">{userName}</span>
          <Button variant="outline" size="sm" onClick={onLogout}>
            Sign out
          </Button>
        </header>
        <main id="main" className="flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function LoadState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return loading ? (
    <p role="status" className="text-sm text-muted-foreground">
      Loading…
    </p>
  ) : null;
}
