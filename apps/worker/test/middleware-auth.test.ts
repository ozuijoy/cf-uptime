import { describe, expect, it, vi } from 'vitest';

import { requireAdmin } from '../src/middleware/auth';
import { AppError } from '../src/middleware/errors';

function makeContext(options: {
  token: string | undefined;
  authorization: string | undefined;
}): unknown {
  return {
    env: { ADMIN_TOKEN: options.token },
    req: {
      header(name: string) {
        if (name.toLowerCase() === 'authorization') return options.authorization;
        return undefined;
      },
    },
  };
}

describe('middleware/auth', () => {
  it('allows requests with matching bearer token', async () => {
    const next = vi.fn(async () => undefined);
    const c = makeContext({
      token: 'secret-token',
      authorization: 'Bearer secret-token',
    });

    await requireAdmin(c as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects requests when auth header is missing/invalid', async () => {
    const next = vi.fn(async () => undefined);
    const missingHeader = makeContext({
      token: 'secret-token',
      authorization: undefined,
    });

    await expect(requireAdmin(missingHeader as never, next)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    } satisfies Partial<AppError>);
    expect(next).not.toHaveBeenCalled();

    const wrongToken = makeContext({
      token: 'secret-token',
      authorization: 'Bearer wrong',
    });
    await expect(requireAdmin(wrongToken as never, next)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    } satisfies Partial<AppError>);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns internal error when admin token is not configured', async () => {
    const c = makeContext({
      token: undefined,
      authorization: 'Bearer anything',
    });

    await expect(requireAdmin(c as never, vi.fn())).rejects.toMatchObject({
      status: 500,
      code: 'INTERNAL',
    } satisfies Partial<AppError>);
  });
});
