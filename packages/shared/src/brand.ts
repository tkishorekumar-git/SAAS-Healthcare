/**
 * Nominal ("branded") string types. They stop a tenant ID being passed where a
 * patient ID is expected — a compile-time guard that complements, but never
 * replaces, database-level tenant isolation.
 */
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
export type BranchId = Brand<string, 'BranchId'>;
export type UserId = Brand<string, 'UserId'>;
