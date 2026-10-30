import { HEALTHCARE_MODULES } from '@kenisha/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModuleCard } from './module-card';

describe('ModuleCard', () => {
  it('renders the module name, description and status', () => {
    const hospital = HEALTHCARE_MODULES[0]!;
    render(<ModuleCard module={hospital} status="Planned" />);

    expect(screen.getByText(hospital.name)).toBeInTheDocument();
    expect(screen.getByText(hospital.description)).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
  });
});
