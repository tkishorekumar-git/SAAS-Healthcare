import { Badge } from '@kenisha/ui/components/badge';
import { fetchApiHealth } from '@/lib/api-health';
import { serverEnv } from '@/lib/env.server';

/** Server component: checks API liveness from the Next.js server, not the browser. */
export async function ApiStatus() {
  const result = await fetchApiHealth(serverEnv.API_INTERNAL_URL);

  if (!result.reachable) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="destructive">API offline</Badge>
        Start it with <code className="font-mono">pnpm dev:api</code>
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Badge>API online</Badge>
      {result.health.service} v{result.health.version} ({result.health.environment})
    </p>
  );
}
