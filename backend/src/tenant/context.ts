/** Identidade de tenant obtida exclusivamente após autenticação. */
export type TenantContext = Readonly<{
  userId: string;
  organizationId: string;
  role: 'OWNER' | 'STAFF';
}>;
