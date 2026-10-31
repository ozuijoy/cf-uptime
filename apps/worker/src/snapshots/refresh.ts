import { toSnapshotPayload, writeStatusSnapshot } from './public-status';

// Compute and persist the public status snapshot.
//
// The `compute` callback should return the exact API payload (PublicStatusResponse).
export async function refreshPublicStatusSnapshot(opts: {
  db: D1Database;
  now: number;
  compute: () => Promise<unknown>;
}): Promise<void> {
  const payload = toSnapshotPayload(await opts.compute());
  await writeStatusSnapshot(opts.db, opts.now, payload);
}
