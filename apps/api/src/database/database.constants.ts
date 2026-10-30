/** Injection token for the raw Prisma client. Only DatabaseModule may inject it. */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

/** Prisma client logged in as kenisha_platform. Only DatabaseModule may inject it. */
export const PLATFORM_PRISMA_CLIENT = Symbol('PLATFORM_PRISMA_CLIENT');
