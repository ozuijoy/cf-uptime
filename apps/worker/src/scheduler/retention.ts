import type { Env } from '../env';

import { readSettings } from '../settings';
import { acquireLease } from './lock';

const LOCK_NAME = 'retention:check_results';
const LOCK_LEASE_SECONDS = 10 * 60;

// Keep delete batches bounded to avoid long-running SQLite statements.
const DELETE_BATCH_SIZE = 5_000;
const MAX_BATCHES = 40; // 200k rows max per run
const MAX_TOTAL_DELETED = DELETE_BATCH_SIZE * MAX_BATCHES;

// 一次刪一個時間區間（30 天 ≈ 43,200 列／台），避免單一 statement 過大。
const BUCKET_SECONDS = 30 * 86400;

/**
 * 找出「有過期資料」的 monitor，以及它最舊的一列時間。
 * 走 idx_check_results_monitor_time(monitor_id, checked_at)：每台只是往索引最左邊 seek 一次。
 */
const STALE_MONITORS_SQL = `
  SELECT m.id AS monitor_id,
         (SELECT MIN(cr.checked_at)
            FROM check_results cr
           WHERE cr.monitor_id = m.id AND cr.checked_at < ?1) AS oldest_at
    FROM monitors m
   WHERE EXISTS (
           SELECT 1
             FROM check_results cr
            WHERE cr.monitor_id = m.id AND cr.checked_at < ?1
         )
`;

/**
 * 依 monitor + 時間區間刪除。
 * 這是 index range delete：只掃描 [from, to) 這段索引，不會碰整張表。
 */
const DELETE_RANGE_SQL = `
  DELETE FROM check_results
   WHERE monitor_id = ?1
     AND checked_at >= ?2
     AND checked_at < ?3
`;

export async function runRetention(env: Env, controller: ScheduledController): Promise<void> {
  const now = Math.floor((controller.scheduledTime ?? Date.now()) / 1000);

  const acquired = await acquireLease(env.DB, LOCK_NAME, now, LOCK_LEASE_SECONDS);
  if (!acquired) return;

  const settings = await readSettings(env.DB);
  const retentionDays = settings.retention_check_results_days;

  const cutoff = now - retentionDays * 86400;
  if (!Number.isFinite(cutoff) || cutoff <= 0) return;

  // 原本的寫法是：
  //   DELETE FROM check_results WHERE id IN (
  //     SELECT id FROM check_results WHERE checked_at < ?1 ORDER BY checked_at LIMIT 5000)
  // 索引是 (monitor_id, checked_at)，ORDER BY checked_at 用不到排序鍵，
  // 所以「每一批」都要把整張表掃一遍再排序（實測 EXPLAIN：SCAN + USE TEMP B-TREE FOR ORDER BY），
  // 而迴圈最多 40 批 → 每日讀取量是 O(表大小 x 批數)，也就是 O(N^2)。
  // 23 台 monitor、7 天保留（≈23 萬列）時，單次 00:30 的清理就能掃掉數百萬列。
  //
  // 改成「逐台 + 時間區間」刪除後，讀取量 ≈ 實際刪除的列數。
  const { results: stale } = await env.DB.prepare(STALE_MONITORS_SQL)
    .bind(cutoff)
    .all<{ monitor_id: number; oldest_at: number }>();

  let totalDeleted = 0;

  for (const row of stale ?? []) {
    if (totalDeleted >= MAX_TOTAL_DELETED) break;

    let from = Number(row.oldest_at);
    if (!Number.isFinite(from) || from >= cutoff) continue;

    while (from < cutoff && totalDeleted < MAX_TOTAL_DELETED) {
      const to = Math.min(from + BUCKET_SECONDS, cutoff);
      const r = await env.DB.prepare(DELETE_RANGE_SQL)
        .bind(row.monitor_id, from, to)
        .run();

      totalDeleted += r.meta.changes ?? 0;
      from = to;
    }
  }

  console.log(`retention: deleted=${totalDeleted} cutoff=${cutoff} days=${retentionDays}`);
}