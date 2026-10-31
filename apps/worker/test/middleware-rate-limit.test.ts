import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/middleware/errors';
import { requireAdminRateLimit } from '../src/middleware/rate-limit';

let ipSuffix = 10;
function nextIp(): string {
  ipSuffix += 1;
  return `198.51.100.${ipSuffix}`;
}

function makeContext(options: {
  adminRateLimitMax?: string;
  adminRateLimitWindowSec?: string;
  cfConnectingIp?: string;
  xForwardedFor?: string;
}): {
  c: unknown;
  header: ReturnType<typeof vi.fn>;
} {
  const responseHeaders = new Map<string, string>();

  const header = vi.fn((name: string, value: string) => {
    responseHeaders.set(name, value);
  });

  const c = {
    env: {
      ADMIN_RATE_LIMIT_MAX: options.adminRateLimitMax,
      ADMIN_RATE_LIMIT_WINDOW_SEC: options.adminRateLimitWindowSec,
    },
    req: {
      header(name: string) {
        const key = name.toLowerCase();
        if (key === 'cf-connecting-ip') return options.cfConnectingIp;
        if (key === 'x-forwarded-for') return options.xForwardedFor;
        return undefined;
      },
    },
    header,
    // Useful in assertions if we need direct access.
    __responseHeaders: responseHeaders,
  };

  return { c, header };
}

describe('middleware/rate-limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-18T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('allows first request and blocks once request budget is exhausted', async () => {
    const { c, header } = makeContext({
      adminRateLimitMax: '1',
      adminRateLimitWindowSec: '60',
      cfConnectingIp: nextIp(),
    });
    const next = vi.fn(async () => undefined);

    await requireAdminRateLimit(c as never, next);
    expect(next).toHaveBeenCalledTimes(1);

    await expect(requireAdminRateLimit(c as never, next)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    } satisfies Partial<AppError>);
    expect(header).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
  });

  it('resets the bucket after the configured window', async () => {
    const { c } = makeContext({
      adminRateLimitMax: '1',
      adminRateLimitWindowSec: '1',
      cfConnectingIp: nextIp(),
    });
    const next = vi.fn(async () => undefined);

    await requireAdminRateLimit(c as never, next);
    await vi.advanceTimersByTimeAsync(1_100);
    await requireAdminRateLimit(c as never, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('uses X-Forwarded-For fallback and clamps invalid env values to safe minimums', async () => {
    const { c } = makeContext({
      // Both clamp to min=1, so second request should be rate-limited.
      adminRateLimitMax: '0',
      adminRateLimitWindowSec: '0',
      xForwardedFor: `${nextIp()}, 203.0.113.99`,
    });
    const next = vi.fn(async () => undefined);

    await requireAdminRateLimit(c as never, next);
    await expect(requireAdminRateLimit(c as never, next)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    } satisfies Partial<AppError>);
  });

  it('uses unknown client key when no forwarding headers exist and allows count below max', async () => {
    const { c } = makeContext({
      adminRateLimitMax: '2',
      adminRateLimitWindowSec: '60',
    });
    const next = vi.fn(async () => undefined);

    await requireAdminRateLimit(c as never, next);
    await requireAdminRateLimit(c as never, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('clears stale bucket map when it grows beyond safety cap', async () => {
    const next = vi.fn(async () => undefined);
    const reusableIp = nextIp();

    const makeFloodContext = (ip: string) =>
      makeContext({
        adminRateLimitMax: '1',
        adminRateLimitWindowSec: '600',
        cfConnectingIp: ip,
      }).c;

    // Fill > MAX_BUCKETS with active (non-expired) entries.
    await requireAdminRateLimit(makeFloodContext(reusableIp) as never, next);
    for (let i = 0; i < 5_001; i += 1) {
      await requireAdminRateLimit(makeFloodContext(nextIp()) as never, next);
    }

    // Trigger cleanup path; since all entries are still active, map.clear() should run.
    await requireAdminRateLimit(makeFloodContext(nextIp()) as never, next);

    // If clear() happened, this IP should no longer be rate-limited.
    await expect(requireAdminRateLimit(makeFloodContext(reusableIp) as never, next)).resolves.toBe(
      undefined,
    );
  });
});
