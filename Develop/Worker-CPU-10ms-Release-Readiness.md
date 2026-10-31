# Worker CPU <10ms Release Readiness Notes

> 記錄日期：2026-04-29
> 更新日期：2026-04-30
> 適用範圍：CF Uptime Worker 在 Cloudflare Free Plan `10ms CPU` 限制下的已釋出方案
> Main release：PR #77 + PR #78
> Release HEAD：`96f40b2 Merge pull request #78 from VrianCao/release/worker-cpu-10ms-flags`
> Dev/Main：已同步至 `96f40b2`
> Production Tail：已透過

---

## 1. 結論摘要

本輪 controlled Dev 長 Tail 與 production post-release Tail 均已透過嚴格標準：

```txt
BAD_OR_GE10 count=0
```

最終長 Tail 檔案：

```txt
tmp/perf-10ms/dev-tail-deep-split-iter5-final-long-20260429140817.jsonl
```

取樣規模：

```txt
1200s tail after warmup
722 Worker events parsed
```

所有采樣 invocation path 的 CPU 都嚴格 `<10ms`，沒有出現 `10ms` 或更高樣本。

最終 public route parity 也透過：

```txt
/api/v1/public/homepage          200, 26 monitors
/api/v1/public/status            200, 26 monitors
/api/v1/public/homepage-artifact 200, 26 monitors, preload_html present
```

homepage/status 仍保持靜態 / 預計算路徑，沒有把 live compute 作為主方案。

Production post-release parity：

```txt
/api/v1/public/homepage          200, 6 monitors
/api/v1/public/status            200, 6 monitors
/api/v1/public/homepage-artifact 200, 6 monitors, preload_html present
```

---

## 2. 最終長 Tail 資料

Tail 檔案：

```txt
tmp/perf-10ms/dev-tail-deep-split-iter5-final-long-20260429140817.jsonl
```

總體：

```txt
objects=722
BAD_OR_GE10 count=0
```

路徑統計：

| Invocation path                                          |   n | p95 | p99 | max | ge10 | over10 |
| -------------------------------------------------------- | --: | --: | --: | --: | ---: | -----: |
| cron wrapper `* * * * *`                                 |  20 | 8ms | 8ms | 9ms |    0 |      0 |
| `POST /api/v1/internal/scheduled/check-batch`            | 260 | 4ms | 4ms | 4ms |    0 |      0 |
| `POST /api/v1/internal/continue/sharded-public-snapshot` | 422 | 4ms | 5ms | 6ms |    0 |      0 |
| `POST /api/v1/internal/write/runtime-update-fragments`   |  20 | 1ms | 1ms | 1ms |    0 |      0 |

未出現以下異常 / 回退訊號：

```txt
refresh/homepage: 0
Subrequest depth: 0
canceled: 0
HTTP 500: 0
failed: 0
error_name: 0
timed out: 0
falling back inline: 0
internal sharded homepage runtime seed failed: 0
```

### 2.1 Production post-release Tail

Tail 檔案：

```txt
tmp/perf-10ms/prod-tail-release-issue24-20260429154407.jsonl
```

總體：

```txt
objects=110
BAD_OR_GE10 count=0
```

| Invocation path                                          |   n | p95 | p99 | max | ge10 |
| -------------------------------------------------------- | --: | --: | --: | --: | ---: |
| cron wrapper `* * * * *`                                 |   7 | 6ms | 6ms | 6ms |    0 |
| `POST /api/v1/internal/scheduled/check-batch`            |  21 | 3ms | 3ms | 5ms |    0 |
| `POST /api/v1/internal/continue/sharded-public-snapshot` |  75 | 2ms | 3ms | 4ms |    0 |
| `POST /api/v1/internal/write/runtime-update-fragments`   |   7 | 1ms | 1ms | 1ms |    0 |

---

## 3. 最終釋出 Flags

> 這組 flags 已在 `apps/worker/wrangler.toml` 中作為 Free Plan CPU 釋出基線啟用。後續如調整任一項，必須重新 Tail 驗證。

### 3.1 基礎排程引數

```toml
UPTIMER_INTERNAL_SCHEDULED_BATCH_SIZE = "2"
```

經驗：

- `2` 是目前 Dev 實測最穩的基礎 batch size。
- batch size `1` 曾增加 wrapper overhead。
- batch size `3/4` 曾把 CPU 壓回 check-batch children。

### 3.2 Released Free Plan CPU profile flags

```toml
UPTIMER_PUBLIC_MONITOR_UPDATE_FRAGMENT_WRITES = "1"
UPTIMER_SCHEDULED_RUNTIME_FRAGMENT_REFRESH = "1"

UPTIMER_PUBLIC_SHARDED_FRAGMENT_SEED = "1"
UPTIMER_SCHEDULED_SHARDED_FRAGMENT_SEED = "1"
UPTIMER_PUBLIC_SHARDED_ASSEMBLER = "1"
UPTIMER_SCHEDULED_SHARDED_ASSEMBLER = "1"
UPTIMER_PUBLIC_SHARDED_SNAPSHOT_PUBLISH = "1"
UPTIMER_SCHEDULED_SHARDED_PUBLISH = "1"

UPTIMER_PUBLIC_HOMEPAGE_ARTIFACT_FRAGMENT_WRITES = "1"
UPTIMER_SHARDED_ASSEMBLER_MODE = "json"
UPTIMER_SCHEDULED_SHARDED_SKIP_HOMEPAGE_REFRESH = "1"
UPTIMER_SCHEDULED_SHARDED_CONTINUATION = "1"

UPTIMER_SHARDED_FRAGMENT_SEED_BATCH_SIZE = "4"
UPTIMER_SHARDED_RUNTIME_UPDATE_BATCH_SIZE = "5"

UPTIMER_INTERNAL_SCHEDULED_CHECK_BATCH_TIMEOUT_MS = "75000"
UPTIMER_INTERNAL_CHECK_BATCH_FRAGMENT_WRITE_SPLIT = "1"
UPTIMER_INTERNAL_CHECK_BATCH_TRUST_SCHEDULER_LEASE = "1"

UPTIMER_SCHEDULED_REFRESH_LOGS = "0"
```

### 3.3 Explicitly disabled / not part of release profile

```toml
# Rejected due CPU outliers.
UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED = "0"

# Diagnostics remain off in release measurements.
UPTIMER_SHARDED_CONTINUATION_DIAGNOSTICS = "0"
UPTIMER_INTERNAL_CHECK_BATCH_DIAGNOSTICS = "0"

# Not used in release profile.
UPTIMER_INTERNAL_SCHEDULED_BATCH_CONCURRENCY = "0"
```

---

## 4. 關鍵經驗

### 4.1 成功方向：靜態 / 預計算 + D1 fragments + continuation

最終方案保留 homepage/status 靜態 / 預計算模型：

- public homepage/status 不走 live-compute 主路徑。
- `public_snapshots` 存最終可讀快照。
- `public_snapshot_fragments` 存 envelope / monitor fragments / artifact monitor fragments。
- cron 只負責小步排程。
- 大任務拆成多次 internal continuation。

這個方向有效降低單次 invocation CPU 峰值。

### 4.2 Raw JSON assembler 是必要最佳化

Validated assembler 曾測到約 `15-16ms`，不適合作為最終 scheduled path。

最終使用：

```toml
UPTIMER_SHARDED_ASSEMBLER_MODE = "json"
```

經驗：

- monitor fragments 在寫入前已經按 schema/serializer 生成。
- raw JSON assembly 避免全量物件 parse/validate/stringify 的 CPU 峰值。
- 之前 short samples 中 raw mode max 約 `4ms`。

### 4.3 Trusted scheduler lease 是 check-batch 長尾的核心修復

關鍵 flag：

```toml
UPTIMER_INTERNAL_CHECK_BATCH_TRUST_SCHEDULER_LEASE = "1"
```

效果：

- 之前失敗長 Tail：check-batch max `31ms`。
- 最終長 Tail：check-batch max `4ms`。

原因：

- controlled scheduled batches 已由 top-level scheduler lease + deterministic unique chunking 保證正常情況下不重疊。
- child check-batch 再獲取 batch lock / monitor locks 會增加多次 D1 操作和 CPU/D1 jitter。
- trusted scheduler lease mode 在 gated 條件下跳過這些額外鎖。

風險：

- 該模式依賴 scheduler-level lease 和 unique chunking。
- 不應預設開啟。
- release rollout 時需要明確只在 scheduled service batch path 使用，並保留 fallback/default-off。

### 4.4 Runtime update fragment writes 需要 split + bulk

最終釋出 profile 包含：

```toml
UPTIMER_INTERNAL_CHECK_BATCH_FRAGMENT_WRITE_SPLIT = "1"
UPTIMER_PUBLIC_MONITOR_UPDATE_FRAGMENT_WRITES = "1"
UPTIMER_SCHEDULED_RUNTIME_FRAGMENT_REFRESH = "1"
UPTIMER_SHARDED_RUNTIME_UPDATE_BATCH_SIZE = "5"
```

經驗：

- 每個 check-batch child 直接寫 runtime update fragments 會增加 wrapper/child overhead。
- 改為 scheduler 收集 compact runtime updates 後 bulk 調一次 writer 更穩。
- runtime refresh continuation 分頁，避免單次處理過多 update fragments。

最終長 Tail：

```txt
POST /api/v1/internal/write/runtime-update-fragments:
  n=20
  max=1ms
```

### 4.5 homepage artifact 需要預渲染 monitor fragments

最終釋出 profile 包含：

```toml
UPTIMER_PUBLIC_HOMEPAGE_ARTIFACT_FRAGMENT_WRITES = "1"
```

經驗：

- `homepage:artifact` 不能在單次 invocation 裡渲染全部 monitor card HTML。
- 每個 monitor 的 preload card HTML 應在 fragment seed 階段預生成。
- artifact publish 只拼接已預渲染 fragments。
- fragments 缺失 / stale / invalid 時必須拒絕釋出壞 artifact。

相關保護：

- missing/stale/invalid artifact monitor fragments 返回 `missing_artifact_fragments` skip。
- 不釋出不完整 artifact。

### 4.6 `homepage:artifact` freshness 需要用 `updated_at` 保活

Iteration 4 發現 public parity blocker：

```txt
/api/v1/public/homepage-artifact -> 503
```

原因：

- sharded artifact continuation 判斷 artifact row generation 已 current。
- 但 public artifact reader 按 body `generated_at` 判定 freshness。
- artifact body generation 可舊於當前 status/homepage runtime generation，導致 artifact 存在但被視為過期。

修復：

- current artifact continuation touch `homepage:artifact.updated_at`。
- artifact readers 對 artifact rows 使用 `updated_at` 計算 freshness。
- body/snapshot 仍按 stored `generated_at` 做一致性驗證。

相關 commits：

```txt
395fe53 fix(worker): keep current homepage artifact warm
93cfdb1 fix(worker): serve touched homepage artifacts
```

### 4.7 正常 scheduled logs 應可關閉

最終釋出 profile 包含：

```toml
UPTIMER_SCHEDULED_REFRESH_LOGS = "0"
```

經驗：

- 普通 scheduled summary / continuation logs 增加 hot path overhead。
- warnings/errors 仍保留。
- diagnostics flags 不應在最終 CPU 取樣中開啟。

---

## 5. 被拒絕的方案

### 5.1 `UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED`

該 flag 曾嘗試讓 homepage fragments 從 runtime snapshot 重新整理，以提升 homepage/artifact body generation freshness。

相關 commits：

```txt
6afa702 perf(worker): seed homepage fragments from runtime snapshot
2a79fe9 fix(worker): keep runtime homepage seed generation stable
```

測試結果失敗：

```txt
tmp/perf-10ms/dev-tail-deep-split-iter4-stable-runtime-seed-20260429134817.jsonl
BAD_OR_GE10 count=4
continuation max=15ms
exact 10ms samples=3
```

結論：

```txt
不要把 UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED 放入正式釋出 profile。
```

該 flag 仍應保持 default-off。它可能作為未來最佳化實驗保留，但不是當前 release profile。

### 5.2 更小 / 更大 check batch size

經驗：

- batch size `1`：wrapper overhead 變差。
- batch size `3/4`：child check-batch CPU 變差。
- 當前釋出 profile 維持：

```toml
UPTIMER_INTERNAL_SCHEDULED_BATCH_SIZE = "2"
```

### 5.3 Monolithic homepage refresh

仍不適合作為 scheduled sharded path：

```txt
POST /api/v1/internal/refresh/homepage
```

經驗：

- 它太容易超過 10ms CPU。
- 最終方案明確使用：
  - sharded fragments
  - raw assembly
  - pre-rendered artifact monitor fragments
  - continuation

---

## 6. 重要證據時間線

### 6.1 失敗 baseline

```txt
tmp/perf-10ms/dev-tail-artifact-final-soak-20260429105720.jsonl
BAD_OR_GE10 count=4
cron max=12ms
check-batch exact 10ms
```

```txt
tmp/perf-10ms/dev-tail-artifact-final-concurrency1-long-20260429112012.jsonl
BAD_OR_GE10 count=4
check-batch max=31ms
cron max=24ms
continuation max=16ms
```

### 6.2 Trusted scheduler lease short pass

```txt
tmp/perf-10ms/dev-tail-deep-split-iter2-trust-lease-20260429114722.jsonl
BAD_OR_GE10 count=0
cron max=6ms
check-batch max=3ms
continuation max=4ms
writer max=1ms
```

### 6.3 Medium pass

```txt
tmp/perf-10ms/dev-tail-deep-split-iter3-medium-20260429115803.jsonl
BAD_OR_GE10 count=0
cron max=8ms
check-batch max=4ms
continuation max=5ms
writer max=1ms
```

### 6.4 Iteration 4 rehearsal pass

```txt
tmp/perf-10ms/dev-tail-deep-split-iter4-rehearsal-20260429124702.jsonl
BAD_OR_GE10 count=0
cron max=7ms
check-batch max=4ms
continuation max=6ms
writer max=1ms
```

### 6.5 Rejected runtime homepage seed failure

```txt
tmp/perf-10ms/dev-tail-deep-split-iter4-stable-runtime-seed-20260429134817.jsonl
BAD_OR_GE10 count=4
continuation max=15ms
```

### 6.6 Final profile rehearsal pass

```txt
tmp/perf-10ms/dev-tail-deep-split-iter4-final-candidate-20260429135630.jsonl
BAD_OR_GE10 count=0
cron max=7ms
check-batch max=4ms
continuation max=4ms
writer max=1ms
```

### 6.7 Final long pass

```txt
tmp/perf-10ms/dev-tail-deep-split-iter5-final-long-20260429140817.jsonl
BAD_OR_GE10 count=0
cron max=9ms
check-batch max=4ms
continuation max=6ms
writer max=1ms
```

---

## 7. Verification 已透過

本輪相關 commits 後透過：

```bash
pnpm --filter @cf-uptime/worker typecheck
pnpm --filter @cf-uptime/worker lint
pnpm --filter @cf-uptime/worker test
pnpm --filter @cf-uptime/worker test:cron
```

最終 full worker / cron：

```txt
worker test: 47 files / 459 tests passed
test:cron: 42 tests passed
```

Web UI/UX earlier verification：

```bash
pnpm --filter @cf-uptime/web typecheck
pnpm --filter @cf-uptime/web lint
pnpm --filter @cf-uptime/web build
```

UI/UX QC 修復已完成，public API / preload behavior 未被最終 CPU 工作破壞。

---

## 8. 當前 commit / Dev 狀態

當前本地 / Dev HEAD：

```txt
2a79fe9 fix(worker): keep runtime homepage seed generation stable
```

重要 commits：

```txt
99efb7a perf(worker): trust scheduler lease for check batches
395fe53 fix(worker): keep current homepage artifact warm
6afa702 perf(worker): seed homepage fragments from runtime snapshot
93cfdb1 fix(worker): serve touched homepage artifacts
2a79fe9 fix(worker): keep runtime homepage seed generation stable
```

說明：

- `2a79fe9` 包含 runtime homepage seed flag 程式碼，但該 flag 是 default-off。
- 最終 release profile 不啟用 `UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED`。
- Dev CI / Deploy green。
- 未 push `origin`。

---

## 9. Release 後運維事項

### 9.1 已採用的釋出方式

PR #77 先合入已驗證程式碼與 release readiness 文件；PR #78 再將已驗證 Free Plan CPU profile 寫入 `apps/worker/wrangler.toml`，使預設部署使用同一組實測透過的 flags。

### 9.2 後續 Production rollout / 變更仍必須 Tail 驗證

後續任何影響 release profile flags、scheduled path、public snapshot path 的變更，都不能只依賴 Dev 結果。Production 開啟或調整後至少需要：

```txt
BAD_OR_GE10 count=0
no exact 10ms
no refresh/homepage fallback
no Subrequest depth
no HTTP 500
public parity OK
```

### 9.3 哪些 flags 可考慮未來預設化

已釋出但仍需謹慎的關鍵 flags：

- `UPTIMER_SHARDED_ASSEMBLER_MODE=json`
- `UPTIMER_INTERNAL_CHECK_BATCH_FRAGMENT_WRITE_SPLIT=1`
- `UPTIMER_INTERNAL_CHECK_BATCH_TRUST_SCHEDULER_LEASE=1`
- `UPTIMER_PUBLIC_HOMEPAGE_ARTIFACT_FRAGMENT_WRITES=1`

其中最高風險是：

```txt
UPTIMER_INTERNAL_CHECK_BATCH_TRUST_SCHEDULER_LEASE
```

因為它跳過 child lock，依賴 scheduler lease 和 deterministic chunking。

### 9.4 哪些必須保持禁用

```txt
UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED
UPTIMER_SHARDED_CONTINUATION_DIAGNOSTICS
UPTIMER_INTERNAL_CHECK_BATCH_DIAGNOSTICS
UPTIMER_INTERNAL_SCHEDULED_BATCH_CONCURRENCY
```

---

## 10. Release checklist 結果

- [x] Main repo 透過 PR 合併（#77、#78），未直接 push `master`。
- [x] Dev repo 已同步到 Main release HEAD。
- [x] D1 migration `0012_public_snapshot_fragments.sql` 已隨部署應用。
- [x] Production `.toml` 使用已驗證 flags，未包含臨時 diagnostics。
- [x] Final release flags 中不包含 `UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED`。
- [x] Production Tail 已執行。
- [x] Tail 結果 `BAD_OR_GE10 count=0`。
- [x] Public route parity 已驗證：
  - [x] `/api/v1/public/homepage`
  - [x] `/api/v1/public/status`
  - [x] `/api/v1/public/homepage-artifact`

---

## 11. Rollback 建議

若 production rollout 出現 CPU `>=10ms` 或 public route parity 問題，優先按以下順序回滾 flags：

1. 關閉 rejected/experimental flags（尤其確認 runtime seed 未啟用）：

```toml
UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED = "0"
```

2. 關閉 trusted scheduler lease：

```toml
UPTIMER_INTERNAL_CHECK_BATCH_TRUST_SCHEDULER_LEASE = "0"
```

3. 關閉 sharded publish / continuation，回到較保守路徑：

```toml
UPTIMER_SCHEDULED_SHARDED_CONTINUATION = "0"
UPTIMER_SCHEDULED_SHARDED_PUBLISH = "0"
UPTIMER_PUBLIC_SHARDED_SNAPSHOT_PUBLISH = "0"
```

4. 恢復 baseline scheduled batch size：

```toml
UPTIMER_INTERNAL_SCHEDULED_BATCH_SIZE = "2"
```

---

## 12. Final statement

基於 Dev controlled long Tail 與 production post-release Tail：

```txt
tmp/perf-10ms/dev-tail-deep-split-iter5-final-long-20260429140817.jsonl
BAD_OR_GE10 count=0

tmp/perf-10ms/prod-tail-release-issue24-20260429154407.jsonl
BAD_OR_GE10 count=0
```

當前釋出基線已在取樣範圍內滿足：

```txt
所有 sampled invocation path CPU 嚴格 <10ms
```

Issue #24 已透過 PR #77/#78 final close。後續若改動 CPU profile、scheduled path 或 public snapshot path，必須重新 Tail 驗證。
