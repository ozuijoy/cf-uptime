import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/snapshots/public-status', () => ({
  toSnapshotPayload: vi.fn(),
  writeStatusSnapshot: vi.fn(),
}));

import { toSnapshotPayload, writeStatusSnapshot } from '../src/snapshots/public-status';
import { refreshPublicStatusSnapshot } from '../src/snapshots/refresh';

describe('snapshots/refresh', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('computes, validates, and persists the snapshot payload', async () => {
    const db = {} as D1Database;
    const rawPayload = { generated_at: 100 };
    const normalized = { generated_at: 100, site_title: 'CF Uptime' };

    vi.mocked(toSnapshotPayload).mockReturnValue(normalized as never);
    vi.mocked(writeStatusSnapshot).mockResolvedValue(undefined);

    const compute = vi.fn(async () => rawPayload);
    await refreshPublicStatusSnapshot({ db, now: 110, compute });

    expect(compute).toHaveBeenCalledTimes(1);
    expect(toSnapshotPayload).toHaveBeenCalledWith(rawPayload);
    expect(writeStatusSnapshot).toHaveBeenCalledWith(db, 110, normalized);
  });

  it('propagates validation/persistence errors to callers', async () => {
    const db = {} as D1Database;
    vi.mocked(toSnapshotPayload).mockImplementation(() => {
      throw new Error('invalid payload');
    });

    await expect(
      refreshPublicStatusSnapshot({
        db,
        now: 1,
        compute: async () => ({}),
      }),
    ).rejects.toThrow('invalid payload');
  });
});
