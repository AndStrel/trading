import { z } from 'zod/v4';

export const sandboxBootstrapKey = 'execution.sandbox_bootstrap_v1';
export const sandboxAccountKey = 'execution.sandbox_account_id';
export const sandboxEndpoint = 'https://sandbox-invest-public-api.tbank.ru/rest';

const prepared = z.object({
  version: z.literal(1), endpoint: z.literal(sandboxEndpoint), phase: z.literal('ready'),
  nonce: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  name: z.string(), accountId: z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/),
});

/** No legacy adoption, uncertain write reconciliation, creation or funding here. */
export function readPreparedSandbox(raw: string | null, runtimeAccountId: string | null, configuredAccountId?: string) {
  try {
    const value = prepared.parse(JSON.parse(raw ?? 'null'));
    if (value.name !== `daily-pilot-${value.nonce}` || value.accountId !== runtimeAccountId
      || (configuredAccountId !== undefined && configuredAccountId !== value.accountId)) throw new Error();
    return value;
  } catch { throw new Error('Separately prepared sandbox account is not confirmed; keep execution killed'); }
}
