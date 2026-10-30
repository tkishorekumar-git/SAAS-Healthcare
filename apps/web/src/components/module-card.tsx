import type { HealthcareModule } from '@kenisha/shared';
import { Badge } from '@kenisha/ui/components/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@kenisha/ui/components/card';

export interface ModuleCardProps {
  module: HealthcareModule;
  status: string;
}

export function ModuleCard({ module, status }: ModuleCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{module.name}</CardTitle>
          <Badge variant="secondary">{status}</Badge>
        </div>
        <CardDescription>{module.description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
