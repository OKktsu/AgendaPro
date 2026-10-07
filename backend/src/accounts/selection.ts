import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { InvalidCredentialsError } from '../auth/login.js';

export const selectOrganizationSchema = z
  .object({
    selectionToken: z.string().min(1).max(2048),
    organizationId: z.string().uuid(),
  })
  .strict();

export type OrganizationSelection = {
  status: 'organization_selection_required';
  selectionToken: string;
  organizations: Array<{ id: string; name: string; role: 'OWNER' | 'STAFF' }>;
};

// Formato e propósito distintos do JWT operacional: nunca aceito pelo middleware de sessão.
function signature(payload: string, secret: string) {
  return createHmac('sha256', secret)
    .update(`agendapro:organization-selection:${payload}`)
    .digest('base64url');
}

export function signSelectionToken(accountId: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      purpose: 'organization-selection',
      accountId,
      exp: Math.floor(now / 1000) + 300,
    }),
  ).toString('base64url');
  return `selection.${payload}.${signature(payload, secret)}`;
}

export function verifySelectionToken(token: string, secret: string, now = Date.now()): string {
  try {
    const [prefix, payload, supplied, extra] = token.split('.');
    if (prefix !== 'selection' || !payload || !supplied || extra !== undefined) throw new Error();
    const actual = Buffer.from(supplied);
    const expected = Buffer.from(signature(payload, secret));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const value = z
      .object({
        purpose: z.literal('organization-selection'),
        accountId: z.string().uuid(),
        exp: z.number().int(),
      })
      .parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (Math.floor(now / 1000) >= value.exp) throw new Error();
    return value.accountId;
  } catch {
    throw new InvalidCredentialsError();
  }
}
