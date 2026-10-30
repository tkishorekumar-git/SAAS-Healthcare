export const HEALTHCARE_MODULE_KEYS = [
  'HOSPITAL',
  'CHRONIC_CARE',
  'MATERNAL',
  'PEDIATRIC',
] as const;

export type HealthcareModuleKey = (typeof HEALTHCARE_MODULE_KEYS)[number];

export interface HealthcareModule {
  key: HealthcareModuleKey;
  name: string;
  description: string;
}

/** Product modules, each sold as part of a tenant's subscription. */
export const HEALTHCARE_MODULES: readonly HealthcareModule[] = [
  {
    key: 'HOSPITAL',
    name: 'Hospital Management',
    description: 'Branches, staff, OPD/IPD, appointments, billing, lab and pharmacy operations.',
  },
  {
    key: 'CHRONIC_CARE',
    name: 'Chronic Disease Management',
    description: 'Long-term care plans and monitoring for diabetes, hypertension and more.',
  },
  {
    key: 'MATERNAL',
    name: 'Maternal & Pregnancy Care',
    description: 'Antenatal visits, risk screening, delivery planning and postnatal follow-up.',
  },
  {
    key: 'PEDIATRIC',
    name: 'Newborn & Pediatric Care',
    description: 'Growth, development and immunisation tracking from birth to 10 years.',
  },
];
