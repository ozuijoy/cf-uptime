# 用 Cloudflare Dashboard 部署 CF Uptime（Workers Builds + Pages Git）

> 適用：不想用 GitHub Actions、想直接在 Cloudflare 面板接 Git 自動部署。
> 本文所有指令都在本機驗證過（wrangler 4.61.0、`--dry-run` 成功、14 個 migration 全數套用成功）。

---

## 0. 先講清楚：為什麼不能直接在面板按「Deploy」

專案的 `apps/worker/wrangler.toml` 有三個地方是「CI 才會補上」的：

| 問題 | 後果 |
|---|---|
| `database_id` 是 `00000000-0000-0000-0000-000000000000` | 部署成功但一查就 `D1_ERROR`，或綁到不存在的資料庫 |
| D1 migrations 由 workflow 另外執行 | 表不存在，整個站台空白 |
| 前端的 `VITE_API_BASE` 由 workflow 解析後注入 | Pages 版前端打不到 API |

所以 Dashboard 部署不是「按一顆按鈕」，而是要在**建置指令裡補上這三步**。本 repo 已附指令碼 `scripts/cf/prepare-wrangler.mjs` 幫你做第 1 步。

---

## 1. 建一組「有 D1 許可權」的 API Token（最容易踩的坑）

Workers Builds 預設自動產生的 token 許可權只有：

> Account Settings (read)、Workers Scripts (edit)、Workers KV (edit)、Workers R2 (edit)、Zone Workers Routes (edit)

**沒有 D1。** 所以在 Deploy command 裡跑 `wrangler d1 migrations apply` 會直接 403。請自己建一組：

Cloudflare Dashboard → My Profile → API Tokens → Create Token → Custom token

| 範圍 | 許可權 |
|---|---|
| Account | D1 → **Edit** |
| Account | Workers Scripts → **Edit** |
| Account | Account Settings → **Read** |
| Zone | Workers Routes → Edit（有綁自訂網域才需要） |

建好後，在 Worker → Settings → Build → **API token** 選這一組。

---

## 2. 建 D1 資料庫

Dashboard → Workers & Pages → D1 → Create database → 名稱 `cf-uptime`。

建好後複製 **Database ID**（UUID 格式，例如 `a1b2c3d4-....`）。等等要用。

---

## 3. Worker（Workers Builds）

Workers & Pages → Create → **Worker** → Connect to Git → 選你的 repo。

Settings → **Build** 這樣填：

| 欄位 | 值 |
|---|---|
| Production branch | `main` |
| Root directory | **留空**（留在 repo 根目錄，pnpm workspace 才裝得完整） |
| Build command | `pnpm install --frozen-lockfile` |
| Deploy command | 見下方 |
| Build variables | `D1_ID` = 你的 UUID、`D1_NAME` = `uptimer`、`UPTIMER_DEPLOY_MODE` = `pages` |

Deploy command：

```sh
node scripts/cf/prepare-wrangler.mjs \
  && pnpm --filter @cf-uptime/worker exec wrangler d1 migrations apply "${D1_NAME:-cf-uptime}" --remote --config wrangler.dashboard.toml \
  && pnpm --filter @cf-uptime/worker exec wrangler deploy --config wrangler.dashboard.toml
```

> 這串做的事情＝GitHub Actions 做的三件事：產生設定檔（注入 `database_id`／`migrations_dir`／`SELF` service binding）→ 套 migration → 部署。

部署完，Worker 會拿到 `https://<worker-name>.<你的-subdomain>.workers.dev`。

### 執行階段變數（23 個）

`prepare-wrangler.mjs` 會把 `wrangler.toml` 的 `[vars]` 原封不動帶進 `wrangler.dashboard.toml`（實測 23 個，含 `UPTIMER_SCHEDULED_SHARDED_*` 那組效能開關）。
**不要**在面板上只補一半 —— 少了這些，快照會退回「每分鐘全量重算」，D1 讀取量會直接跳一個數量級（詳見下方第 7 節）。

### Secrets

Settings → Variables & Secrets → Add → **Secret**：

| 名稱 | 用途 |
|---|---|
| `ADMIN_TOKEN` | 後台登入用；越長越好，例如 32 字元隨機字串 |

（有設通知渠道的話，把 Telegram／Discord／Webhook 的 secret 一併加上。）

---

## 4. Pages（前端）

Workers & Pages → Create → **Pages** → Connect to Git → 同一個 repo。

| 欄位 | 值 |
|---|---|
| Framework preset | None（或 Vite） |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @cf-uptime/web build` |
| Build output directory | `apps/web/dist` |
| Root directory | 留空 |

環境變數（Production **和** Preview 都要設）：

| 名稱 | 值 |
|---|---|
| `VITE_API_BASE` | `https://<worker-name>.<subdomain>.workers.dev/api/v1` |
| `VITE_ADMIN_PATH` | 選填，例如 `/37dh3hi2`（把後台路徑藏起來） |
| `PNPM_VERSION` | `10.8.1`（Pages 建置映像用錯版本時再加） |

再到 Pages → Settings → Variables and Secrets 加一個 **Secret**：

| 名稱 | 值 |
|---|---|
| `UPTIMER_API_ORIGIN` | `https://<worker-name>.<subdomain>.workers.dev`（給 `apps/web/public/_worker.js` 做 HTML 預載，少它首屏會慢一拍，但不會壞） |

---

## 5. 部署後驗證清單

依序打這幾個網址（把 `<worker>`、`<pages>` 換成你的）：

```sh
curl -s https://<worker>/api/v1/public/health      # 期望 {"ok":true}
curl -s https://<worker>/api/v1/public/status | head -c 300
curl -s -o /dev/null -w '%{http_code}\n' https://<pages>/            # 期望 200
curl -s -o /dev/null -w '%{http_code}\n' https://<pages>/api/v1/public/health  # 走 _worker.js 代理
```

再看三個地方：

1. Worker → **Logs**：每分鐘應該有一筆 cron invocation（`crons = ["* * * * *"]`）。
2. D1 → `cf-uptime` → Console：
   ```sql
   SELECT COUNT(*) AS rows, MIN(checked_at) AS oldest, MAX(checked_at) AS newest FROM check_results;
   ```
   數字會隨時間長大，代表探測真的有在跑。
3. Dashboard → D1 → Metrics：觀察 `rows read` 曲線（下面第 7 節會用到）。

---

## 6. 常見錯誤對照表

| 症狀 | 原因 | 解法 |
|---|---|---|
| `D1_ERROR: no such table: monitors` | migration 沒跑成功 | 檢查 build token 是否有 **D1 Edit**；看 build log 有沒有 403 |
| `Authentication error [code: 10000]` | token 許可權不足或過期 | 重建 token，並在 Build 設定重新選擇 |
| 頁面載入但資料全空、Console 看到 `API returned HTML` | `VITE_API_BASE` 沒設成絕對網址 | 改成 `https://<worker>/api/v1`，重新部署 Pages |
| `/api/*` 回 404 | Pages 專案沒吃到 `_worker.js`，或 Worker 沒部署 | 確認 Pages build 有產出 `dist/_worker.js` |
| cron 沒動靜 | 產出的設定缺 `[triggers]` | 指令碼會擋；確認 `wrangler.dashboard.toml` 有 `crons = ["* * * * *"]` |
| 部署把面板上手設的變數洗掉 | `wrangler deploy` 以設定檔為準 | 變數改在 `apps/worker/wrangler.toml`，別只在面板改 |

---

## 7. 順帶：23 台 monitor 的 D1 讀取量怎麼來的

你的數字：23 台、30 天 20M 列 → **平均約 66.7 萬列／天**。這不是異常，是這套架構的「常態基線」，來源可以拆成四塊：

| 來源 | 每日列數（估） | 說明 |
|---|---|---|
| 每分鐘 cron 的固定開銷 | ~15 萬～20 萬 | 每分鐘讀 `monitors` + `monitor_state` + lease + fragment，乘 1,440 次 |
| 每日 00:00 重建 runtime 快照 | ~5 萬～23 萬 | `listHeartbeatsByMonitorId` 會把該 monitor 全部保留列讀出來排序（`public/data.ts:355`） |
| 每日 00:30 保留期清理 | ~30 萬～140 萬 | `retention.ts:30` 是「全表掃描＋排序」，最多 40 批 → O(N²) |
| 公開頁面／後台流量 | 其餘 | 每次開 monitor 詳情會掃該區間的 `check_results` |

想確定哪一塊是大頭，跑這一行（不用 CLI，D1 Console 貼上即可）：

```sql
SELECT COUNT(*) AS rows_total,
       COUNT(DISTINCT monitor_id) AS monitors,
       ROUND((MAX(checked_at) - MIN(checked_at)) / 86400.0, 1) AS days_kept,
       ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT monitor_id) / ((MAX(checked_at)-MIN(checked_at))/86400.0), 0) AS checks_per_day_per_monitor
FROM check_results;
```

`checks_per_day_per_monitor` 會直接告訴我你的 interval（1,440＝60 秒、288＝5 分鐘）。把這三個數字貼給我，我可以算出精確的百分比拆解，並把「心跳查詢加時間下限」與「清理改 keyset」這兩處改好。

短期最有效的三個動作（都不用改程式）：

1. `interval_sec` 60 → 300（所有掃描線性 ÷5，清理成本 ÷25）。
2. 保留天數 7 → 3（`settings` 表的 `retention_check_results_days`）。
3. 用 Cache Rule 把 `/api/v1/public/*` 在邊緣快取 30～60 秒。

---

## 8. 附錄：和 GitHub Actions 版的差異

| | GitHub Actions（原本） | Dashboard Workers Builds |
|---|---|---|
| 觸發 | push / 手動 | push |
| 設定檔 | workflow 動態產生 `wrangler.ci.toml` | 指令碼動態產生 `wrangler.dashboard.toml` |
| migrations | 自動 | 自動（但 token 必須有 D1 Edit） |
| Pages | `wrangler pages deploy` | Pages 專案自己的 Git 整合 |
| secrets | `wrangler secret put` | 手動在面板加（一次性） |
| 回滾 | 重跑舊 commit | Worker → Deployments → Rollback |

兩者可以並存，但**不要同時開**：同一分鐘兩邊都部署會互相互蓋版本。