import { HEALTHCARE_MODULES } from '@kenisha/shared';
import { Button } from '@kenisha/ui/components/button';
import Link from 'next/link';
import { ApiStatus } from '@/components/api-status';
import { ModuleCard } from '@/components/module-card';

// The API status is checked on every request, never cached at build time.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">
          Preview · administration available, clinical modules coming
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">Kenisha Healthcare</h1>
        <p className="max-w-2xl text-muted-foreground">
          Multi-tenant healthcare platform for hospitals and clinics in India and international
          markets. Clinical modules are not enabled yet.
        </p>
        <ApiStatus />
        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild>
            <Link href="/login">Staff sign in</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/platform/login">Kenisha platform</Link>
          </Button>
        </div>
      </header>

      <section aria-labelledby="modules-heading" className="flex flex-col gap-4">
        <h2 id="modules-heading" className="text-xl font-semibold">
          Product modules
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {HEALTHCARE_MODULES.map((module) => (
            <ModuleCard key={module.key} module={module} status="Planned" />
          ))}
        </div>
      </section>
    </main>
  );
}
