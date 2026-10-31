# Application.md: CF Uptime

Version: 0.1.0 (Draft, revised)
Type: Technical Specification & Application Architecture
Platform: Cloudflare Native (Workers + Pages + D1; optional single-Worker hosting)
Last updated: 2026-01-28

---

## 0. 讀者與範圍

本文用於專案初始化階段的技術規格說明，目標是把 CF Uptime 的「做什麼 / 不做什麼 / 怎麼做 / 資料如何落地 / API 如何對外」一次性講清楚，便於後續拆分任務與實現。

本文預設單租戶（一個站點由一個團隊/個人維護），多租戶屬於後續擴充套件。

---

## 1. 專案概述 (Executive Summary)

CF Uptime 是一個構建在 Cloudflare 邊緣網路上的 Serverless 可用性監控 + 狀態頁 + 事件管理平台。

核心目標：

- Zero-Ops：無伺服器、無容器、無自建資料庫例項。
- Cloudflare-native：Workers 負責 API 與定時探測；Pages 承載 Web UI（預設）；也可選擇 single_worker 將 SPA 作為 Worker 靜態資源與 API 同源部署；D1 儲存配置與歷史資料。
- 開箱即用：以「個人/中小團隊」的可維護性、低成本、可定製為優先。

差異化強調（需與 Cloudflare 執行時約束匹配）：

- “Edge-first” 的真實含義：探測從 Cloudflare 執行環境發起（非傳統單機 VPS），但 Cron Trigger 並不保證在所有邊緣節點執行；如需多地域探測，需要額外的“多探針”設計（見 6.7 與 15）。

---

## 2. 目標與非目標 (Goals / Non-goals)

### 2.1 目標 (Goals)

- 支援 HTTP(S) 與 TCP 探測；提供可配置的超時、重試、斷言與告警節流。
- 提供公共狀態頁（聚合狀態 + 元件列表 + 歷史事件）。
- 提供管理後台（監控項管理、事件管理、通知渠道配置、系統設定）。
- 資料可追溯：保留必要的探測記錄用於圖表、SLA 計算、審計與問題回溯，同時控制 D1 體積增長。

### 2.2 非目標 (Non-goals, v0.x)

- 不做完整 APM、鏈路追蹤、日誌平台。
- 不追求 ICMP 原生 Ping（Workers 執行時不提供標準 ICMP）。統一使用 Latency 指標，以 HTTP fetch / TCP connect 近似實現。
- 不做複雜 RBAC/多租戶計費；v0.x 固定為“單租戶 + 單管理員 Token”。

---

## 3. 關鍵約束與設計原則 (Constraints & Principles)

### 3.1 Cloudflare Workers 約束（對設計有直接影響）

- Cron Triggers 透過 `scheduled()` 事件觸發；按 wrangler/Dashboard 配置的 cron 表示式執行（UTC），觸發時間可能存在抖動/漂移，且不保證在所有邊緣節點執行。參考：Workers Cron Triggers 文件。
- 出站探測要避免被 Cloudflare 快取影響：對 HTTP 探測請求顯式禁用快取（見 6.2）。
- TCP 探測需使用 Workers 的 TCP Socket API：`import { connect } from 'cloudflare:sockets'`（見 6.3）。該能力僅支援出站 TCP，不等同於 ICMP。
- 需要控制併發：Workers 對併發出站連線存在執行時限制，需做併發上限（例如預設 5）以避免資源耗盡與不穩定。

### 3.2 資料庫（D1/SQLite）約束

- D1 本質是 SQLite 語義，適合中等規模結構化資料；高頻寫入必須配合資料保留策略（Retention）與必要的聚合/歸檔，否則表會快速膨脹。
- 讀寫都需要走 D1 binding API（`env.DB.prepare(...).bind(...).run()` 等），儘量使用引數化 SQL 防注入。參考：D1 prepared statements 文件。

### 3.3 設計原則

- “可實現優先”：v0.x 先把 HTTP/TCP、告警、狀態頁、事件跑通，避免過度設計。
- “可擴充套件不綁死”：資料模型與 API 預留多地域探測、更多通知渠道、更多圖表維度的擴充套件點。
- “安全預設”：後台鑑權、輸入校驗、SSRF/埠掃描濫用防護要在第一版就設計進來。

---

## 4. 技術棧 (Tech Stack)

Frontend (Dashboard + Status Page):

- Host: Cloudflare Pages（預設）或 Cloudflare Workers `[assets]`（`UPTIMER_DEPLOY_MODE=single_worker`）
- Framework: React + Vite (TypeScript)
- Styling: Tailwind CSS
- Router: React Router
- Data Fetching: TanStack Query
- Forms/Validation: React Hook Form + Zod
- Charts: Recharts

Backend (API + Scheduler):

- Host: Cloudflare Workers
- Triggers: HTTP (`fetch`) + Cron (`scheduled`)
- Language: TypeScript
- Routing: Hono
- Validation: Zod
- Concurrency control: p-limit (cap outbound checks)

Storage:

- Core DB: Cloudflare D1
- SQL/ORM: Drizzle ORM (D1/SQLite driver)
- Migrations: SQL migrations managed via Wrangler (`wrangler d1 migrations`)

---

## 5. 系統架構 (System Architecture)

### 5.1 元件劃分

- Web 前端：公共狀態頁 + 管理後台 UI。預設部署在 Cloudflare Pages；`UPTIMER_DEPLOY_MODE=single_worker` 時作為 Worker `[assets]` 與 API 同源。
- Worker API：對外 REST API（public/admin），聚合 D1 資料。
- Worker Scheduler：Cron 觸發的探測引擎（可與 API 同一個 Worker 模組）。
- D1：配置、狀態、事件與歷史資料。
- 外部通知：Webhook（Discord/Slack/Telegram/自定義）。

### 5.2 架構圖 (Conceptual，預設 pages 模式)

```mermaid
graph TD
  Visitor[訪客] -->|HTTPS| Pages[Cloudflare Pages (UI)]
  Admin[管理員] -->|HTTPS| Pages

  Pages -->|/api/* 代理| Worker[Cloudflare Worker (API)]
  Worker --> D1[(D1 Database)]

  Cron[Cron Trigger] --> Scheduler[Worker (scheduled: Monitor Engine)]
  Scheduler -->|HTTP fetch / TCP connect| Targets[目標服務]
  Scheduler -->|write results| D1
  Scheduler -->|webhook| Notify[外部通知]
```

> `single_worker` 模式：Pages 節點替換為「Worker（UI 靜態資源 + API）」，訪客/管理員直連該 Worker，無 Pages 代理層。

---

## 6. 監控引擎設計 (Monitor Engine)

### 6.1 核心概念

- Monitor：一個被監控物件（HTTP URL 或 TCP host:port）。
- Check：一次探測（可能包含多次 retry）。
- State：監控項當前狀態（UP/DOWN/MAINTENANCE/PAUSED/UNKNOWN）。
- Outage：一次從 UP -> DOWN -> UP 的故障區間（用於 SLA 與事件自動化）。

### 6.2 HTTP(S) Monitor

支援項（v0.x）：

- Method：GET/HEAD/POST/PUT/DELETE（預設 GET）。
- Timeout：預設 10s（可配）。
- Headers：可配；預設附加 `User-Agent: CF Uptime/<version>`。
- Body：可選（主要用於 POST 探測）。
- Status code assertion：
  - 預設：2xx 視為成功。
  - 可配置允許碼/區間（`expected_status_json`，如 `[200,204,{"from":301,"to":399}]`）。
  - 可配置禁止碼/區間（`forbidden_status_json`）；**黑名單優先**於白名單。
  - 僅配置黑名單時仍預設 2xx，再排除禁止碼。
- Response assertion：
  - `responseKeyword`：必須包含（可選）。
  - `responseForbiddenKeyword`：必須不包含（可選）。

避免快取汙染（重要）：

- 對探測 fetch 顯式禁用快取，避免 Cloudflare 快取導致“假成功/假失敗”：
  - 標準 `fetch` 選項可用 `cache: 'no-store'|'no-cache'`。
  - 也可透過 `cf.cacheTtlByStatus` 強制控制快取行為（參考 Workers fetch 與 cache 配置示例）。
  - 實現建議：對所有狀態碼設定不快取（例如 `cf.cacheTtlByStatus: { '100-599': -1 }`），並在必要時設定隨機 query 引數作為兜底。

TLS 相關說明：

- v0.x 以“TLS 可用/可信”作為檢查：證書過期或不受信任會導致 fetch 失敗，從而判定 DOWN。
- “提前 N 天提醒證書到期”需要獲取證書 NotAfter 資訊，Workers 原生 fetch 不直接暴露證書鏈；該能力作為後續增強（見 16）。

### 6.3 TCP Port Monitor

實現方式：

- 使用 Workers TCP Socket API：
  - `import { connect } from 'cloudflare:sockets'`
  - `connect({ hostname, port })` 後等待連線建立並立即關閉
- 以“TCP 握手是否成功 + 耗時”作為可用性與延遲指標。

注意：

- 這不是 ICMP；但對“埠可達性”非常有效。
- 必須做目標校驗與速率控制，避免被濫用為埠掃描器（見 12.2）。

### 6.4 “Ping/ICMP”策略

Workers 不提供原生 ICMP；v0.x 定義：

- 統一指標欄位：`latency_ms`（UI 文案統一用 “Latency”，不出現 “ICMP Ping”）。
- HTTP Monitor：`latency_ms =` 從發起 `fetch()` 到收到響應頭（headers）的耗時（不包含完整讀 body；斷言 keyword 需要讀 body 時會額外消耗時間，需在實現中單獨標記）。
- TCP Monitor：`latency_ms =` 從 `connect()` 到 `socket.opened` resolve 的耗時。

### 6.5 重試、抖動與狀態機 (Flapping Control)

推薦預設策略（可配置）：

- 單次 Check 失敗時進行快速重試 1~2 次（例如間隔 300ms/800ms）。
- 僅當“連續失敗達到閾值”才從 UP -> DOWN（例如 2/3）。
- 恢復同理：連續成功達到閾值才從 DOWN -> UP（例如 2）。
- 告警節流：
  - Grace period（例如 DOWN 持續 >= 1 分鐘才發第一次告警）
  - Error reason 變化是否通知（可選）

### 6.6 併發控制與超時預算

- 每分鐘 Cron 執行時，對 Monitor 列表做併發限制（預設 5），避免超過 Workers 出站連線併發限制。
- 為整輪掃描設定總預算（例如 50s），超出則記錄 UNKNOWN 並留到下輪。
- 透過 `AbortController` / 超時包裝確保 fetch 與 socket 不懸掛。

### 6.7 多地域探測（v1+ 的擴充套件點）

v0.x 僅“單探針”（Cron 在某個執行位置執行）。後續可擴充套件：

- 多探針 Worker / Durable Object 遠端探測（為不同 region/colo 採集延遲）。
- 外部探針 API（可選，不作為預設依賴）。

### 6.8 排程器執行流程（scheduled / Cron tick）

Cron 建議配置為每分鐘觸發一次（`* * * * *`），但並不意味著每分鐘對所有 monitor 全量掃描；CF Uptime 應基於 `interval_sec` 做“到期探測”。

推薦流程：

1. 對齊當前時間片：`checked_at = floor(now / 60) * 60`（用於去重、圖表與視窗計算）。
2. 獲取分散式鎖（防止 scheduled 重疊）：
   - 以 D1 `locks` 表實現一個帶過期時間的 lease（例如 55s），拿不到鎖則直接退出。
3. 拉取待探測列表：
   - `monitors.is_active = 1`
   - `monitor_state.status != 'paused'`
   - `monitor_state.last_checked_at IS NULL OR last_checked_at <= now - interval_sec`
4. 併發受控地執行探測：
   - HTTP：禁用快取 + 超時 +（可選）斷言 body keyword
   - TCP：`cloudflare:sockets` connect + 超時
   - 對失敗做快速 retry，並結合連續成功/失敗閾值更新狀態機。
5. 寫入 D1（建議用 `DB.batch()` 保證同一 monitor 的狀態更新原子性）：
   - 插入 `check_results`（短期序列）
   - Upsert `monitor_state`（當前狀態）
   - 維護 `outages`（狀態變更時開/關區間）
6. 觸發通知：
   - 僅在“狀態變更且不處於維護視窗”時傳送 `monitor.down`/`monitor.up`。
   - 使用 `notification_deliveries` 的唯一鍵去重，避免重複告警。
   - 如需縮短單輪執行時間，可用 `ctx.waitUntil()` 非同步傳送通知。

可選：記錄本輪執行位置（colo/region）用於展示“當前探針位置”與排障（例如透過請求 `https://cloudflare.com/cdn-cgi/trace` 解析 `colo=`）。

### 6.9 Free Plan CPU Profile（當前釋出基線）

Issue #24 的最終釋出基線針對 Cloudflare Free Plan `10ms CPU` 預算做了專項最佳化：

- scheduled wrapper 只做輕量編排；實際探測拆為 `POST /api/v1/internal/scheduled/check-batch` 子 invocation。
- check-batch 在已持有 scheduler lease 且 chunk 唯一時使用 trusted scheduler lease 模式，避免重複 D1 batch/monitor lock 長尾。
- monitor runtime updates 先收集為 compact updates，再由單個 bulk writer 寫入 runtime update fragments。
- public homepage/status 繼續走 D1 靜態預計算快照；不以 live compute 作為公共 API 主路徑。
- homepage/status 快照使用 D1 fragments 分片 seed、raw JSON assemble、continuation publish。
- `homepage:artifact` 的 monitor preload card HTML 在 fragment seed 階段預渲染，artifact publish 只拼接預渲染 fragments。
- 正常 scheduled summary logs 預設關閉；warnings/errors 保留。

釋出驗證證據見 `Develop/Worker-CPU-10ms-Release-Readiness.md`。被拒絕的 `UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED` 不屬於釋出基線。

---

## 7. 資料模型 (D1 Schema Strategy)

目標：

- 配置與當前狀態查詢要快（後台列表、狀態頁聚合）。
- 歷史資料要“夠用且可控”：圖表需要短期高精度，SLA 需要長期可計算。

### 7.1 表與職責

說明：SQLite/D1 中 `BOOLEAN` 等價於整數；建議統一用 `INTEGER`(0/1) + CHECK 約束。

```sql
-- 監控項配置
CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'tcp')),
  target TEXT NOT NULL, -- http(s)://... 或 host:port

  interval_sec INTEGER NOT NULL DEFAULT 60 CHECK (interval_sec >= 60),
  timeout_ms   INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms >= 1000),

  -- HTTP-only 配置（JSON 用 TEXT 儲存，應用層校驗）
  http_method TEXT,
  http_headers_json TEXT,
  http_body TEXT,
  expected_status_json TEXT, -- e.g. [200,204,{"from":301,"to":399}]
  forbidden_status_json TEXT, -- e.g. [204,{"from":500,"to":599}]; blacklist first
  response_keyword TEXT,
  response_forbidden_keyword TEXT,

  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- 監控項當前狀態（用於快速讀取；由排程器更新）
CREATE TABLE IF NOT EXISTS monitor_state (
  monitor_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('up','down','maintenance','paused','unknown')),
  last_checked_at INTEGER,
  last_changed_at INTEGER,
  last_latency_ms INTEGER,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0
);

-- 短期探測記錄（用於心跳條/延遲圖），建議保留 24h~7d，按專案規模調優
CREATE TABLE IF NOT EXISTS check_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL,
  checked_at INTEGER NOT NULL, -- unix seconds
  status TEXT NOT NULL CHECK (status IN ('up','down','maintenance','unknown')),
  latency_ms INTEGER,
  http_status INTEGER,
  error TEXT,
  location TEXT, -- 可選：colo/region
  attempt INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_check_results_monitor_time
  ON check_results(monitor_id, checked_at);

-- 故障區間（長期保留，用於 SLA 與歷史事件）
CREATE TABLE IF NOT EXISTS outages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER, -- NULL 表示仍在故障中
  initial_error TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_outages_monitor_start
  ON outages(monitor_id, started_at);

-- 公共事件（可手工建立，也可選擇自動從 outages 生成）
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('investigating','identified','monitoring','resolved')),
  impact TEXT NOT NULL DEFAULT 'minor' CHECK (impact IN ('none','minor','major','critical')),
  message TEXT, -- 首條說明
  started_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS incident_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  status TEXT CHECK (status IN ('investigating','identified','monitoring','resolved')),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_incident_updates_incident_time
  ON incident_updates(incident_id, created_at);

-- Incident 與 monitors 關聯（多對多；用於狀態頁展示影響範圍）
CREATE TABLE IF NOT EXISTS incident_monitors (
  incident_id INTEGER NOT NULL,
  monitor_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  PRIMARY KEY (incident_id, monitor_id)
);
CREATE INDEX IF NOT EXISTS idx_incident_monitors_monitor
  ON incident_monitors(monitor_id);

-- 維護視窗（維護期間不觸發 DOWN 告警，可在狀態頁展示）
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- 維護視窗與 monitors 關聯（多對多；用於“告警抑制”與狀態頁展示）
CREATE TABLE IF NOT EXISTS maintenance_window_monitors (
  maintenance_window_id INTEGER NOT NULL,
  monitor_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  PRIMARY KEY (maintenance_window_id, monitor_id)
);
CREATE INDEX IF NOT EXISTS idx_maintenance_window_monitors_monitor
  ON maintenance_window_monitors(monitor_id);

-- 通知渠道（先做 Webhook；後續可擴充套件 provider 欄位）
CREATE TABLE IF NOT EXISTS notification_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('webhook')),
  config_json TEXT NOT NULL, -- { url, method, headers, payloadTemplate, timeoutMs, ... }
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- 通知傳送記錄（用於去重/審計/重放排查）
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL, -- e.g. monitor:12:down:1700000000
  channel_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','failed')),
  http_status INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_event_channel
  ON notification_deliveries(event_key, channel_id);

-- 輕量設定/金鑰引用（敏感值優先用 Workers Secrets；DB 僅存非敏感配置）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 分散式鎖（防止 scheduled 重疊執行）
CREATE TABLE IF NOT EXISTS locks (
  name TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

-- 公共 API 靜態快照（homepage/status/homepage:artifact fast path）
CREATE TABLE IF NOT EXISTS public_snapshots (
  key TEXT PRIMARY KEY,
  generated_at INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- 公共快照 guard state/version（跨 Worker isolate 證明 fast guard 狀態仍當前）
CREATE TABLE IF NOT EXISTS public_snapshot_guard_versions (
  key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  state_json TEXT
);

-- 公共快照 fragments（D1-first 分片 seed/assemble/publish）
CREATE TABLE IF NOT EXISTS public_snapshot_fragments (
  snapshot_key TEXT NOT NULL,
  fragment_key TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (snapshot_key, fragment_key)
);
CREATE INDEX IF NOT EXISTS idx_public_snapshot_fragments_snapshot_generated
  ON public_snapshot_fragments(snapshot_key, generated_at);
```

### 7.2 資料保留與清理 (Retention)

預設建議（可配置）：

- `check_results`：保留最近 7 天（或更短，如 24h），用於圖表與心跳條。
- `outages` / `incidents`：保留 90 天或更久（體積小）。
- 每日 Cron 執行清理任務：刪除過期 `check_results`；可選對 `outages` 做歸檔。

### 7.3 查詢模式與 SLA/圖表計算

Heartbeat Bar（最近 N 次探測）：

- 查詢：按 `checked_at DESC` 取最近 N 條 `check_results`（例如 60）。
- 展示：UP=綠，DOWN=紅，MAINTENANCE=藍，UNKNOWN=灰。

Latency Chart（時間序列）：

- 查詢：按時間視窗拉取 `check_results.latency_ms`（只取 status=up 或單獨標記 down）。
- P95：SQLite/D1 沒有內建 percentile 聚合，v0.x 在 Worker 中對視窗內資料排序計算（視窗建議 <= 7d）。

Uptime / SLA（按時間視窗計算可用性）：

- 長期視窗優先基於 `outages` 求 downtime（比全量心跳更省儲存）：
  - 對每條 outage 計算與視窗 `[rangeStart, rangeEnd)` 的交集秒數並求和。
  - `uptime = 1 - downtime / (rangeEnd - rangeStart)`
- UNKNOWN 的處理需要明確語義（建議 v0.x 預設“UNKNOWN 計為不可用/降級”，並在 UI 上單獨展示 Unknown 比例）。

---

## 8. API 設計 (REST API)

### 8.1 約定

- Base path：`/api/v1`
- Content-Type：`application/json; charset=utf-8`
- 時間：統一使用 unix seconds（整數）。
- 錯誤格式（統一）：

```json
{ "error": { "code": "INVALID_ARGUMENT", "message": "..." } }
```

### 8.2 鑑權與分割槽

- Public API：狀態頁讀取，無需鑑權（但可加快取）。
- Admin API：固定使用 `Authorization: Bearer <ADMIN_TOKEN>`（token 存於 Workers Secret）。
- 生產環境建議在 Cloudflare 層額外加一層 Access（SSO）保護 `/admin` 與 `/api/v1/admin/*`，作為“外部防護”，不改變應用內鑑權邏輯。

### 8.3 端點草案

Public:

- `GET /api/v1/public/homepage`：公共首頁 JSON；優先讀取 `public_snapshots.homepage` / fragments 釋出結果。
- `GET /api/v1/public/homepage-artifact`：HTML preload artifact；返回 `preload_html` + `snapshot`。
- `GET /api/v1/public/status`：返回全域性狀態、元件列表、未解決事件摘要、維護視窗、最近心跳與延遲（狀態頁首屏）。
- `GET /api/v1/public/monitors/:id/latency?range=24h`：延遲序列（對外可限制粒度）。
- `GET /api/v1/public/monitors/:id/uptime?range=24h|7d|30d`：SLA/可用性統計（含 downtime 秒數與 Unknown 比例）。
- `GET /api/v1/public/incidents?limit=20`：歷史事件列表。
- `GET /api/v1/public/maintenance-windows?limit=20`：公開維護視窗列表。

Admin:

- `GET /api/v1/admin/monitors`
- `POST /api/v1/admin/monitors`
- `PATCH /api/v1/admin/monitors/:id`
- `DELETE /api/v1/admin/monitors/:id`
- `POST /api/v1/admin/monitors/:id/test`：立即探測一次（不寫入或寫入標記為 manual）。

- `GET /api/v1/admin/incidents`
- `POST /api/v1/admin/incidents`
- `POST /api/v1/admin/incidents/:id/updates`
- `PATCH /api/v1/admin/incidents/:id/resolve`
- `DELETE /api/v1/admin/incidents/:id`

- `GET /api/v1/admin/maintenance-windows`
- `POST /api/v1/admin/maintenance-windows`
- `PATCH /api/v1/admin/maintenance-windows/:id`
- `DELETE /api/v1/admin/maintenance-windows/:id`

- `GET /api/v1/admin/notification-channels`
- `POST /api/v1/admin/notification-channels`
- `PATCH /api/v1/admin/notification-channels/:id`
- `DELETE /api/v1/admin/notification-channels/:id`
- `POST /api/v1/admin/notification-channels/:id/test`

Internal（Bearer Token + feature flags；scheduled/service-binding 使用，不作為公共產品 API）：

- `POST /api/v1/internal/scheduled/check-batch`
- `POST /api/v1/internal/write/runtime-update-fragments`
- `POST /api/v1/internal/refresh/runtime-fragments`
- `POST /api/v1/internal/seed/sharded-public-snapshot`
- `POST /api/v1/internal/assemble/sharded-public-snapshot`
- `POST /api/v1/internal/continue/sharded-public-snapshot`

### 8.4 分頁與過濾

- 列表介面預設 `limit=50`，最大 200；使用 `cursor`（基於 id 或時間）做遊標分頁，避免 offset 在大表上的效能問題。

---

## 9. 通知系統 (Notification Dispatcher)

### 9.1 事件型別

- `monitor.down`：UP -> DOWN（或 UNKNOWN -> DOWN）
- `monitor.up`：DOWN -> UP
- `incident.created` / `incident.updated` / `incident.resolved`
- `maintenance.started` / `maintenance.ended`（可選）

### 9.2 Webhook 標準 Payload（建議）

```json
{
  "event": "monitor.down",
  "event_id": "monitor:12:down:1700000000",
  "timestamp": 1700000000,
  "monitor": {
    "id": 12,
    "name": "API",
    "type": "http",
    "target": "https://api.example.com/health"
  },
  "state": {
    "status": "down",
    "latency_ms": 10000,
    "http_status": 0,
    "error": "Timeout after 10000ms",
    "location": "HKG"
  },
  "links": {
    "status_page": "https://status.example.com",
    "admin": "https://status.example.com/admin"
  }
}
```

Webhook Channel `config_json`（建議欄位）：

```json
{
  "preset": "custom",
  "url": "https://example.com/webhook",
  "method": "POST",
  "headers": { "Authorization": "Bearer xxx" },
  "timeout_ms": 5000,
  "payload_type": "json",
  "signing": {
    "enabled": false,
    "secret_ref": "UPTIMER_WEBHOOK_SIGNING_SECRET"
  }
}
```

簽名（可選）：

- 若啟用 signing，傳送時附加：
  - `X-Uptimer-Timestamp: <unix seconds>`
  - `X-Uptimer-Signature: sha256=<hmac>`（對 `timestamp + "." + rawBody` 做 HMAC-SHA256）
- 目的：讓接收方可驗證來源與防重放（接收方校驗 timestamp 在允許視窗內）。

Telegram Channel `config_json`（內建 preset）：

預設 Admin API 輸入：

```json
{
  "preset": "telegram",
  "bot_token": "123456789:AA...",
  "chat_id": "@status_channel"
}
```

D1 儲存形態：

```json
{
  "preset": "telegram",
  "bot_token_encrypted": "v1:...",
  "chat_id": "@status_channel",
  "message_thread_id": 123,
  "timeout_ms": 5000,
  "message_template": "{{message}}",
  "enabled_events": ["monitor.down", "monitor.up"],
  "parse_mode": "HTML",
  "disable_notification": false,
  "protect_content": false
}
```

- Telegram 告警是 CF Uptime 向 Telegram Bot API 出站呼叫 `sendMessage`，不是 Telegram `setWebhook` 入站更新回撥。
- 預設路徑允許管理員在 UI/API 輸入 Bot Token；Worker 使用現有 `ADMIN_TOKEN` 派生金鑰加密後，僅把 `bot_token_encrypted` 寫入 D1。Admin API 響應不得回傳明文或密文 token。
- 輪換 `ADMIN_TOKEN` 後，已加密的 Telegram token 需要在後台重新儲存。
- 進階路徑仍支援 `bot_token_secret_ref`，只儲存 Workers Secret binding 名稱；適合希望在 D1 之外管理 Bot Token 的部署。

### 9.3 去重與重試

- `event_id`/`event_key` 用於冪等：同一事件對同一 channel 只傳送一次（用 `notification_deliveries` UNIQUE 約束）。
- 失敗重試：v0.x 可做“有限次重試 + 指數退避”（例如 3 次：0s/10s/60s）；更可靠方案是引入 Cloudflare Queues（後續）。

---

## 10. 事件管理 (Incident Management)

### 10.1 事件型別與生命週期

- 型別：`Issue`（故障）、`Maintenance`（維護）
- 狀態：Investigating -> Identified -> Monitoring -> Resolved

### 10.2 與監控項的關係

- v0.x 可先不做複雜關聯：事件中用文字描述影響範圍。
- v0.2+ 建議支援 incident 與 monitors 的關聯（多對多）：建立事件時指定 `monitor_ids`，狀態頁按受影響元件展示。
- v1 可進一步擴充套件到 components（多對多），並支援更復雜的分組/聚合展示。

---

## 11. UI/UX 原則

公共狀態頁（對齊 Statuspage 體驗）：

- 全域性狀態 Banner（All Operational / Partial Outage / Major Outage / Maintenance）。
- 元件/服務列表：顯示當前狀態 + 最近心跳條 + 最近延遲趨勢迷你圖。
- 未解決事件置頂；歷史事件分頁。

狀態聚合規則（v0.x 建議，後續可配置）：

- 單個 monitor：`monitor_state.status` 直接決定展示色塊（up/down/maintenance/unknown/paused）。
- 全域性 Banner：
  - 若存在未解決的手工事件（`incidents.status != resolved`），優先按其 `impact` 對映為 Partial/Major（並展示事件摘要）。
  - 否則按 monitors 聚合：存在任意 DOWN => Partial；DOWN 比例超過閾值（例如 30%）=> Major；無 DOWN 但存在 MAINTENANCE => Maintenance；其餘 => All Operational。

管理後台（對齊 Uptime Kuma 易用性）：

- 監控項列表：狀態、最近一次探測、錯誤原因、延遲。
- 監控項配置嚮導：HTTP/TCP 兩種模板。
- 事件編輯器：支援 Markdown（渲染到狀態頁）。
- 通知渠道測試：一鍵傳送 test webhook。

---

## 12. 安全 (Security)

### 12.1 管理端鑑權

- 應用內鑑權：Bearer Token（儲存在 Workers Secret；不要寫入 Git 與 D1）。
- 生產環境外部防護：Cloudflare Access（可選，建議開啟）。

### 12.2 輸入校驗與 SSRF/濫用防護

監控項配置會觸發出站請求，應視為“受控 SSRF 能力”，需要：

- 限制協議：HTTP(S) 或 TCP；拒絕 file://、ftp:// 等。
- 埠：不再限制（允許 1-65535）。注意：這會提升被濫用為埠掃描器的風險，生產環境務必配合外部防護（如 Cloudflare Access）與速率限制。
- 可選拒絕私網/保留地址段（10.0.0.0/8、192.168.0.0/16、127.0.0.0/8、::1 等），避免內部掃描與誤用。
- 後台 API 做速率限制（優先用 Cloudflare WAF/Rate Limiting 規則）。

### 12.3 審計

- v0.x：至少記錄關鍵操作日誌（monitor/incident/notification 配置變更）到 Workers logs；
- v1：落表 `audit_logs`（可選）。

---

## 13. 開發與部署 (DevOps)

### 13.1 本地開發

- 後端：`wrangler dev`（啟用 D1 本地/預覽庫），除錯 `fetch` 與 `scheduled`。
- 前端：Vite dev server；透過代理轉發 `/api` 到 wrangler 埠。

### 13.2 部署 (CI/CD)

建議 GitHub Actions（`UPTIMER_DEPLOY_MODE` 控制，預設 `pages`）：

- 資料庫：`wrangler d1 migrations apply <db> --remote`
- 後端（`pages` 模式）：`wrangler deploy`（基礎配置不包含 `[assets]`，生產 Worker 僅提供 API）
- 後端（`single_worker` 模式）：CI 動態向 `wrangler.ci.toml` 注入 `[assets]`，SPA 靜態資源與 Worker 一併部署
- 前端（預設 `pages`）：build -> deploy to Cloudflare Pages（`_worker.js` 代理 `/api/*`）
- 前端（可選 `single_worker`）：由 Worker `[assets]` 承載，無需單獨 Pages 專案

### 13.3 wrangler 配置要點（示例）

```toml
name = "cf-uptime"
main = "src/index.ts"
compatibility_date = "2026-01-28"
minify = true

[triggers]
crons = ["* * * * *", "0 0 * * *", "30 0 * * *"]

[[d1_databases]]
binding = "DB"
database_name = "cf-uptime"
database_id = "<uuid>"

[vars]
ADMIN_RATE_LIMIT_MAX = "60"
ADMIN_RATE_LIMIT_WINDOW_SEC = "60"
UPTIMER_SCHEDULED_STATUS_REFRESH = "1"
UPTIMER_TRUST_SCHEDULED_RUNTIME_UPDATES = "1"
UPTIMER_INTERNAL_SCHEDULED_BATCH_SIZE = "2"
# Free Plan CPU profile: see Develop/Worker-CPU-10ms-Release-Readiness.md
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

`UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED` 曾實測產生 continuation CPU outliers，不屬於釋出基線。

---

## 14. 可觀測性 (Observability)

- Scheduler 每輪輸出結構化日誌：輪次 id、處理 monitor 數、成功/失敗、耗時、觸發 colo。
- 對關鍵異常（D1 寫失敗、通知失敗、探測異常）輸出 error logs。
- v1 可接入 Workers Analytics Engine 做輕量指標（可選）。

---

## 15. 里程碑 (Roadmap)

v0.1（MVP）：

- HTTP/TCP 探測 + 重試/超時 + 狀態機
- D1：monitors / monitor_state / check_results / outages
- Webhook 通知（down/up）
- 公共狀態頁 + 管理後台基礎 CRUD

v0.2：

- 事件管理（incidents + timeline）與狀態頁展示
- 維護視窗（maintenance）與告警抑制
- 資料保留任務（每日清理）

v0.3+（可選增強）：

- 多地域探測（多探針/DO locationHint/外部探針）
- 證書到期提前告警（需要額外實現途徑）
- 通知渠道擴充套件（Slack/Telegram 等內建模板）
- 更完善的審計、匯出、備份與恢復策略

---

## 16. 參考資料 (References)

- Workers Cron Triggers / `scheduled()`：https://developers.cloudflare.com/workers/configuration/cron-triggers/
- D1 prepared statements / bind/run：https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- D1 查詢最佳實踐：https://developers.cloudflare.com/d1/best-practices/query-d1/
- Workers TCP sockets (`cloudflare:sockets`)：https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- Workers fetch 與 cache 配置示例：https://developers.cloudflare.com/workers/examples/cache-using-fetch/
- Hono (Workers web framework)：https://hono.dev/
- Drizzle ORM：https://orm.drizzle.team/
- React：https://react.dev/
- Vite：https://vitejs.dev/
- React Router：https://reactrouter.com/
- TanStack Query：https://tanstack.com/query/latest
- Tailwind CSS：https://tailwindcss.com/
