# 本地測試流程

本文件介紹如何在本地環境中執行和測試 CF Uptime 專案。

## 目錄

1. [環境要求](#環境要求)
2. [安裝依賴](#安裝依賴)
3. [配置環境變數](#配置環境變數)
4. [一鍵初始化並啟動（推薦）](#一鍵初始化並啟動推薦)
5. [初始化資料庫（手動）](#初始化資料庫手動)
6. [快速注入測試資料（手動）](#快速注入測試資料手動)
7. [啟動開發伺服器（手動）](#啟動開發伺服器手動)
8. [測試 API 介面](#測試-api-介面)
9. [自動化測試（90%場景覆蓋）](#自動化測試90場景覆蓋)
10. [程式碼質量檢查](#程式碼質量檢查)
11. [常見問題](#常見問題)

---

## 環境要求

| 工具     | 版本要求   | 說明                   |
| -------- | ---------- | ---------------------- |
| Node.js  | >= 22.14.0 | JavaScript 執行時      |
| pnpm     | >= 10.8.1  | 包管理器               |
| Wrangler | 最新版     | Cloudflare Workers CLI |

### 安裝 pnpm

```bash
npm install -g pnpm@10.8.1
```

### 安裝 Wrangler

```bash
npm install -g wrangler
```

---

## 安裝依賴

在專案根目錄執行：

```bash
pnpm install
```

這將安裝所有工作區（apps/web、apps/worker、packages/\*）的依賴。

---

## 配置環境變數

### Worker 環境變數

1. 複製示例檔案：

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
```

2. 編輯 `apps/worker/.dev.vars`，設定管理員令牌：

```
ADMIN_TOKEN=your-secure-token-here
```

> **注意**：`.dev.vars` 檔案已在 `.gitignore` 中，不會被提交到版本控制。

---

## 一鍵初始化並啟動（推薦）

在專案根目錄執行：

```bash
pnpm dev
```

該命令會自動完成：

- Worker 本地資料庫 migration（`apps/worker`）
- 本地種子資料注入（覆蓋常見狀態與事件場景）
- 並行啟動 Worker 與 Web 開發伺服器

預設地址：

- Worker: `http://localhost:8787`
- Web: `http://localhost:5173`

---

## 初始化資料庫（手動）

CF Uptime 使用 Cloudflare D1（SQLite）資料庫。本地開發時，Wrangler 會自動建立本地資料庫。

### 建立本地資料庫並執行遷移

```bash
cd apps/worker
wrangler d1 migrations apply cf-uptime --local
```

### 驗證資料庫

```bash
wrangler d1 execute cf-uptime --local --command="SELECT name FROM sqlite_master WHERE type='table';"
```

應該看到以下表：

- monitors
- monitor_state
- check_results
- outages
- incidents
- incident_updates
- incident_monitors
- maintenance_windows
- maintenance_window_monitors
- notification_channels
- notification_deliveries
- settings
- locks
- monitor_daily_rollups
- public_snapshots

---

## 快速注入測試資料（手動）

為了覆蓋本地聯調中最常見的狀態組合（`up/down/maintenance/paused/unknown`）與事件場景，Worker 提供了本地種子資料指令碼：

```bash
cd apps/worker
pnpm seed:local
```

該指令碼會在保留 ID 區間 `900001-900099` 內寫入演示資料（不會覆蓋你手工建立的普通 ID 資料），包含：

- 6 個 monitors（HTTP/TCP）
- 對應 `monitor_state` 與近 60 條心跳資料
- 進行中 outage + 已恢復 outage
- 未解決/已解決 incidents 及 updates
- active/upcoming maintenance windows
- 30 天 rollup（用於 status page uptime bar 與 analytics）

可用下面命令快速確認：

```bash
wrangler d1 execute cf-uptime --local --command="SELECT id,name,type,target FROM monitors WHERE id BETWEEN 900001 AND 900099 ORDER BY id;"
```

---

## 啟動開發伺服器（手動）

需要同時啟動前端和後端伺服器。建議使用兩個終端視窗。

### 終端 1：啟動 Worker（後端）

```bash
cd apps/worker
pnpm dev
```

Worker 將在 `http://localhost:8787` 啟動。

### 終端 2：啟動 Web（前端）

```bash
cd apps/web
pnpm dev
```

前端將在 `http://localhost:5173` 啟動，API 請求會自動代理到 Worker。

---

## 測試 API 介面

### 公開 API（無需認證）

#### 獲取所有監控狀態

```bash
curl http://localhost:8787/api/v1/public/status
```

> **加速機制（Public status snapshot）**：Worker 會把 `/api/v1/public/status` 的結果寫入 `public_snapshots` 表。
> 並在後續請求中優先讀取快照（最大滯後 60s，通常 <= 30s）。

驗證快照是否生成：

```bash
wrangler d1 execute cf-uptime --local --command="SELECT key, generated_at, updated_at, LENGTH(body_json) AS bytes FROM public_snapshots;"
```

#### 獲取單個監控的延遲資料

```bash
curl http://localhost:8787/api/v1/public/monitors/{id}/latency
```

#### 獲取單個監控的可用性資料

```bash
curl http://localhost:8787/api/v1/public/monitors/{id}/uptime
```

#### 獲取事件列表（未解決置頂）

```bash
curl "http://localhost:8787/api/v1/public/incidents?limit=20"
```

### 管理員 API（需要認證）

所有管理員 API 需要在請求頭中攜帶 `Authorization: Bearer <ADMIN_TOKEN>`。

#### 建立監控

```bash
curl -X POST http://localhost:8787/api/v1/admin/monitors \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{
    "name": "Example Site",
    "type": "http",
    "target": "https://example.com",
    "interval_sec": 60,
    "timeout_ms": 5000
  }'
```

#### 獲取所有監控

```bash
curl http://localhost:8787/api/v1/admin/monitors \
  -H "Authorization: Bearer your-secure-token-here"
```

#### 獲取 Settings

```bash
curl http://localhost:8787/api/v1/admin/settings \
  -H "Authorization: Bearer your-secure-token-here"
```

#### 更新 Settings（PATCH）

```bash
curl -X PATCH http://localhost:8787/api/v1/admin/settings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{
    "site_title": "My Status",
    "site_description": "Public status page",
    "site_timezone": "Asia/Shanghai",
    "retention_check_results_days": 14,
    "state_failures_to_down_from_up": 3,
    "state_successes_to_up_from_down": 2,
    "admin_default_overview_range": "7d",
    "admin_default_monitor_range": "30d",
    "uptime_rating_level": 4
  }'
```

#### 更新監控

```bash
curl -X PATCH http://localhost:8787/api/v1/admin/monitors/{id} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{
    "name": "Updated Name",
    "interval_sec": 120
  }'
```

#### 刪除監控

```bash
curl -X DELETE http://localhost:8787/api/v1/admin/monitors/{id} \
  -H "Authorization: Bearer your-secure-token-here"
```

### 通知（Webhook）

#### 建立通知渠道（自定義模板 + 魔法變數）

下面示例會：

- 使用 `payload_type: json`
- 用 `message_template` 生成可複用的 `{{message}}`
- 用 `payload_template` 自定義最終傳送給 webhook 的 JSON 結構

```bash
curl -X POST http://localhost:8787/api/v1/admin/notification-channels \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{
    "name": "My Webhook",
    "type": "webhook",
    "config_json": {
      "url": "https://example.com/webhook",
      "method": "POST",
      "timeout_ms": 5000,
      "payload_type": "json",
      "message_template": "[{{event}}] {{monitor.name}} => {{state.status}}\\n$MSG",
      "payload_template": {
        "text": "{{message}}",
        "event": "{{event}}",
        "event_id": "{{event_id}}",
        "monitor": {
          "id": "{{monitor.id}}",
          "name": "{{monitor.name}}",
          "target": "{{monitor.target}}"
        }
      },
      "enabled_events": ["monitor.down", "monitor.up"]
    }
  }'
```

#### 傳送 test webhook（會走模板渲染；event 固定為 test.ping）

```bash
curl -X POST http://localhost:8787/api/v1/admin/notification-channels/{id}/test \
  -H "Authorization: Bearer your-secure-token-here"
```

#### payload_type = param（GET/POST 都可；會把 payload_template 展平成 query params）

```bash
curl -X POST http://localhost:8787/api/v1/admin/notification-channels \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{
    "name": "QueryParam Webhook",
    "type": "webhook",
    "config_json": {
      "url": "https://example.com/webhook",
      "method": "GET",
      "payload_type": "param",
      "payload_template": {
        "event": "{{event}}",
        "monitor": "{{monitor.name}}",
        "msg": "{{message}}"
      }
    }
  }'
```

#### payload_type = x-www-form-urlencoded

```bash
curl -X POST http://localhost:8787/api/v1/admin/notification-channels \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{
    "name": "Form Webhook",
    "type": "webhook",
    "config_json": {
      "url": "https://example.com/webhook",
      "method": "POST",
      "payload_type": "x-www-form-urlencoded",
      "payload_template": {
        "event": "{{event}}",
        "msg": "{{message}}"
      }
    }
  }'
```

> 魔法變數規則（簡版）：
>
> - 支援 `{{path.to.field}}` 和陣列索引 `{{arr[0].x}}`
> - 相容 `$MSG`（會替換為渲染後的 message）
> - `{{message}}` 是渲染後的最終訊息；`{{default_message}}` 是系統預設訊息

### 測試定時任務

Wrangler 支援手動觸發 cron 任務：

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

### Scheduler CPU 壓測

對 `runScheduledTick` 做本地 synthetic benchmark：

```bash
pnpm --filter @cf-uptime/worker bench:scheduler
```

預設會把當前工作樹與 `HEAD` 對比，適合做未提交調優的前後複測。

如果要和特定基線比（例如 `origin/master` 或某個 commit），可覆蓋基線 ref：

```bash
SCHEDULER_BENCH_BASE_REF=origin/master pnpm --filter @cf-uptime/worker bench:scheduler
SCHEDULER_BENCH_BASE_REF=ee9207b pnpm --filter @cf-uptime/worker bench:scheduler
```

可選引數：

```bash
SCHEDULER_BENCH_RUNS=20 SCHEDULER_BENCH_WARMUPS=5 pnpm --filter @cf-uptime/worker bench:scheduler
SCHEDULER_BENCH_WRITE_JSON=./scheduler-bench.json pnpm --filter @cf-uptime/worker bench:scheduler
```

說明：

- 基準只測 scheduler 自身的排程、狀態計算和 D1 編排開銷。
- HTTP/TCP probe 會被 mock 掉，避免真實網路波動汙染結果。
- 輸出裡的 `DB.batch()` 次數可直接反映批次寫入是否生效。

---

## Phase 8/9: 事件與維護視窗驗證步驟（最小示例）

### 1) 建立一個事件（incident.created）

```bash
curl -X POST http://localhost:8787/api/v1/admin/incidents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{
    "title": "API outage",
    "impact": "major",
    "status": "investigating",
    "message": "We are investigating.",
    "monitor_ids": [1]
  }'
```

### 2) 追加事件更新（incident.updated）

```bash
curl -X POST http://localhost:8787/api/v1/admin/incidents/1/updates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{
    "status": "monitoring",
    "message": "Mitigation applied, monitoring."
  }'
```

### 3) 解決事件（incident.resolved）

```bash
curl -X PATCH http://localhost:8787/api/v1/admin/incidents/1/resolve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{ "message": "Resolved." }'
```

### 3.1) 刪除事件（admin delete）

```bash
curl -X DELETE http://localhost:8787/api/v1/admin/incidents/1 \
  -H "Authorization: Bearer your-secure-token-here"
```

### 4) 建立維護視窗（告警抑制）

```bash
# starts_at/ends_at 為 unix seconds（整數）
curl -X POST http://localhost:8787/api/v1/admin/maintenance-windows \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-token-here" \
  -d '{
    "title": "DB maintenance",
    "message": "Planned maintenance.",
    "starts_at": 1700000000,
    "ends_at": 1700003600,
    "monitor_ids": [1]
  }'
```

### 4.1) 刪除維護視窗

```bash
curl -X DELETE http://localhost:8787/api/v1/admin/maintenance-windows/1 \
  -H "Authorization: Bearer your-secure-token-here"
```

---

## Phase 10: Analytics & 報表（最小示例）

> 說明：7d/30d/90d 的 analytics 依賴 `monitor_daily_rollups`（日級 rollup 表）。
> 本地可透過觸發 daily cron 來生成“昨日”的 rollup 資料。

### 0) 應用最新 migrations（新增 rollup 表）

```bash
cd apps/worker
wrangler d1 migrations apply cf-uptime --local
```

### 1) 觸發 daily rollup（生成昨日資料）

```bash
curl "http://localhost:8787/__scheduled?cron=0+0+*+*+*"
```

### 2) Admin: 全域性概覽（24h/7d）

```bash
curl "http://localhost:8787/api/v1/admin/analytics/overview?range=24h" \
  -H "Authorization: Bearer your-secure-token-here"
```

### 3) Admin: 某個 monitor 的 analytics（24h/7d/30d/90d）

```bash
curl "http://localhost:8787/api/v1/admin/analytics/monitors/1?range=24h" \
  -H "Authorization: Bearer your-secure-token-here"
```

### 4) Admin: outage 列表（支援 limit/cursor）

```bash
curl "http://localhost:8787/api/v1/admin/analytics/monitors/1/outages?range=7d&limit=50" \
  -H "Authorization: Bearer your-secure-token-here"
```

### 4.1) Admin: CSV 匯出（可選）

```bash
# outages
curl -L "http://localhost:8787/api/v1/admin/exports/monitors/1/outages.csv?range=30d" \
  -H "Authorization: Bearer your-secure-token-here"

# check_results（受 retention 限制，預設僅支援 24h/7d）
curl -L "http://localhost:8787/api/v1/admin/exports/monitors/1/check-results.csv?range=24h" \
  -H "Authorization: Bearer your-secure-token-here"

# incidents
curl -L "http://localhost:8787/api/v1/admin/exports/incidents.csv?range=90d" \
  -H "Authorization: Bearer your-secure-token-here"
```

### 5) Public: 30d/90d uptime 概覽（用於狀態頁加速）

```bash
curl "http://localhost:8787/api/v1/public/analytics/uptime?range=30d"
```

## 自動化測試（90%場景覆蓋）

Worker 側新增了高價值純邏輯模組測試（狀態機、目標校驗、uptime 計算、延遲直方圖、通知模板），並設定了覆蓋率閾值（line/function/statement >= 90%，branch >= 85%）。

在倉庫根目錄執行：

```bash
pnpm test
```

僅執行 Worker 覆蓋率測試：

```bash
pnpm --filter @cf-uptime/worker test
```

測試檔案位於：

- `apps/worker/test/monitor-state-machine.test.ts`
- `apps/worker/test/monitor-targets.test.ts`
- `apps/worker/test/analytics-uptime.test.ts`
- `apps/worker/test/analytics-latency.test.ts`
- `apps/worker/test/notify-template.test.ts`

## 程式碼質量檢查

### 型別檢查

檢查所有包的 TypeScript 型別：

```bash
pnpm typecheck
```

### 程式碼風格檢查

執行 ESLint：

```bash
pnpm lint
```

### 程式碼格式化

檢查格式：

```bash
pnpm format:check
```

自動格式化：

```bash
pnpm format
```

---

### Public Status (60-day uptime bars)

The public status page now uses the daily rollup table (`monitor_daily_rollups`) to render a 60-day uptime bar per monitor.

To generate rollup data locally (yesterday's rollup):

```bash
curl "http://localhost:8787/__scheduled?cron=0+0+*+*+*"
```

The UI will show up to 60 bars when data exists. If there is no rollup data yet, uptime fields may be empty.

## 常見問題

### Q: Worker 啟動失敗，提示資料庫不存在

**A**: 確保已執行資料庫遷移：

```bash
cd apps/worker
wrangler d1 migrations apply cf-uptime --local
```

### Q: 前端無法連線後端 API

**A**: 檢查以下幾點：

1. Worker 是否在 `localhost:8787` 執行
2. Vite 配置中的代理設定是否正確（見 `apps/web/vite.config.ts`）

### Q: 認證失敗 (401 Unauthorized)

**A**: 確保：

1. `.dev.vars` 檔案存在且包含 `ADMIN_TOKEN`
2. 請求頭中的 Token 與 `.dev.vars` 中的一致

### Q: 如何清空本地資料庫

**A**: 刪除本地資料庫檔案後重新執行遷移：

```bash
cd apps/worker
rm -rf .wrangler/state
wrangler d1 migrations apply cf-uptime --local
```

---

## 專案結構參考

```
CF Uptime/
├── apps/
│   ├── web/          # React 前端 (localhost:5173)
│   └── worker/       # Cloudflare Worker 後端 (localhost:8787)
├── packages/
│   ├── db/           # 資料庫 Schema 和客戶端
│   └── shared/       # 共享工具
└── pnpm-workspace.yaml
```
