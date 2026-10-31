# Plan.md: Delivery Plan (CF Uptime v0.1+)

Phased delivery plan from MVP to production. Each phase includes acceptance criteria.

> Phases 0–12 are **complete**. Issue #24 Free Plan CPU timeout closeout is released via PR #77/#78 and documented in `Worker-CPU-10ms-Release-Readiness.md`. See REVIEW.md for remaining gaps.

---

## Post-release baseline — Issue #24 CPU closeout（2026-04-29）

狀態：已釋出到 Main，並已同步 Dev。

驗收證據：

- Final controlled Dev Tail：`BAD_OR_GE10 count=0`，所有采樣 invocation path 嚴格 `<10ms`。
- Production post-release Tail：`BAD_OR_GE10 count=0`。
- Public parity：`/api/v1/public/homepage`、`/api/v1/public/status`、`/api/v1/public/homepage-artifact` 均返回 `200`。

釋出基線：

- Free Plan CPU profile 已寫入 `apps/worker/wrangler.toml`。
- Homepage/status 繼續使用靜態預計算快照；不以 live compute 作為公共 API 主路徑。
- `UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED` 已實測拒絕，不屬於釋出基線。

---

## 0. Constraints (Locked)

- 平台：Cloudflare Workers + D1，預設前端託管在 Cloudflare Pages（可選 `UPTIMER_DEPLOY_MODE=single_worker` 將 SPA 作為 Worker `[assets]` 與 API 同源）
- 前端：React + Vite + TypeScript + Tailwind + React Router + TanStack Query + Recharts
- 後端：TypeScript + Hono + Zod
- DB：D1 + Drizzle ORM；遷移用 Wrangler D1 migrations
- 鑑權：Admin Bearer Token（Workers Secret）

---

## 1. Phase 0 — 倉庫初始化（1 天）

任務：

- 建立 monorepo 目錄結構：`apps/web`、`apps/worker`、`packages/shared`、`packages/db`
- 統一包管理器與 Node 版本：
  - `pnpm` + `pnpm-workspace.yaml`
  - `.nvmrc` / `.node-version`（固定 Node 版本）
- 基礎工程化：
  - TypeScript base config（strict）
  - ESLint + Prettier（前後端一致）
  - GitHub Actions：lint + typecheck（先不部署也可）

驗收（DoD）：

- `pnpm -r lint`、`pnpm -r typecheck` 可執行（即使只有空專案）

---

## 2. Phase 1 — D1 Schema & Migrations（1 天）

任務：

- 根據 `Application.md` 建立首個 migration：
  - `monitors`、`monitor_state`、`check_results`、`outages`
  - `incidents`、`incident_updates`
  - `maintenance_windows`
  - `notification_channels`、`notification_deliveries`
  - `settings`、`locks`
- 新增必要索引（按 `monitor_id, checked_at` 等）
- `packages/db`：
  - Drizzle schema 定義與 D1 client 封裝
  - 為 `*_json` 欄位提供 Zod 校驗與序列化工具

驗收（DoD）：

- `wrangler d1 migrations apply` 可對本地/遠端庫執行（至少本地可跑通）
- Worker 能連線 D1 並執行一次簡單查詢（healthcheck）

---

## 3. Phase 2 — Worker API 骨架（1–2 天）

任務：

- Hono 路由分層：
  - `/api/v1/public/*`（無需鑑權）
  - `/api/v1/admin/*`（Bearer Token 中介軟體）
- 統一錯誤響應格式與輸入校驗（Zod）
- 實現最小 API：
  - `GET /api/v1/public/status`（先返回佔位資料）
  - `GET /api/v1/admin/monitors` / `POST /api/v1/admin/monitors`

驗收（DoD）：

- 本地 `wrangler dev` 下可訪問 API，鑑權正確生效
- Monitor CRUD 能寫入 D1，並能讀回

---

## 4. Phase 3 — 監控引擎（scheduled）（2–4 天）

任務：

- `scheduled()` 實現（每分鐘 tick）：
  - D1 lease 鎖（`locks` 表）防重疊執行
  - 計算“到期 monitors”（基於 `interval_sec` 與 `last_checked_at`）
  - 併發限制（p-limit 預設 5）
- HTTP check：
  - 超時（AbortController）
  - 禁用快取（`cache: 'no-store'` + `cf.cacheTtlByStatus: { '100-599': -1 }`）
  - 狀態碼斷言（精確碼/區間白名單、黑名單優先）、關鍵字斷言（必要時讀取 body）
- TCP check：
  - `cloudflare:sockets` connect + 超時 + close
- 狀態機：
  - 連續失敗/成功閾值（UP->DOWN、DOWN->UP）
  - 寫入 `check_results`、upsert `monitor_state`
  - 維護 `outages`（開/關區間）

驗收（DoD）：

- 至少 2 個 monitor（HTTP + TCP）可穩定跑通
- `monitor_state` 會隨探測更新；DOWN/UP 切換正確；`outages` 區間正確閉合

---

## 5. Phase 4 — 通知（Webhook）（1–2 天）

任務：

- `notification_channels` CRUD（admin）
- Webhook dispatch：
  - 支援 method/headers/timeout/payloadType(json)
  - 冪等：`notification_deliveries` 唯一鍵去重
  - 可選簽名（HMAC-SHA256）
- 通知觸發：
  - 僅在狀態變更且不處於維護視窗時傳送 `monitor.down`/`monitor.up`
  - 使用 `ctx.waitUntil()` 傳送，避免阻塞 scheduled 主流程

驗收（DoD）：

- DOWN/UP 狀態變更可觸發 webhook
- 重複觸發不會重複傳送（冪等生效）

---

## 6. Phase 5 — Public API 資料化（1–2 天）

任務：

- `GET /api/v1/public/status`：
  - 從 `monitor_state` 聚合全域性狀態
  - 返回 monitors 列表 + 最近心跳（每個 monitor 最近 N 條）
- `GET /api/v1/public/monitors/:id/latency?range=24h`
- `GET /api/v1/public/monitors/:id/uptime?range=24h|7d|30d`：
  - 基於 `outages` 計算 downtime 與 uptime%
  - UNKNOWN 語義按 `Application.md` 執行

驗收（DoD）：

- 狀態頁可僅靠 Public API 完成首屏渲染

---

## 7. Phase 6 — Web（狀態頁 + 管理後台 MVP）（2–5 天）

任務：

- Web 基礎：
  - React Router 路由：Status / Admin
  - TanStack Query 接入 Public/Admin API
  - Tailwind 基礎佈局與主題
- 狀態頁：
  - 全域性 banner + monitors 列表
  - Heartbeat bar（最近 60 次）
  - Latency chart（24h）
- 管理後台：
  - monitors CRUD
  - 手動 test check（`POST /admin/monitors/:id/test`）
  - notification channels CRUD + test

驗收（DoD）：

- 透過 UI 可完成：新增 monitor -> scheduled 自動探測 -> 狀態頁展示 -> DOWN 觸發通知

---

## 8. Phase 7 — Retention / Hardening / Release（1–3 天）

任務：

- Retention：
  - 每日清理 `check_results` 過期資料（可配置保留天數）
- 安全與濫用防護：
  - monitor target 校驗（協議/埠/私網限制）
  - admin API 速率限制（Cloudflare 側規則 + 應用內基礎限制）
- 可觀測性：
  - scheduled 每輪結構化日誌（數量、耗時、失敗原因分佈）
- 釋出準備：
  - 文件：README（快速部署、環境變數、遷移步驟）

驗收（DoD）：

- MVP 可部署到 Cloudflare：預設 Pages 前端 + Worker API + D1 migrations 一次性跑通（可選 `UPTIMER_DEPLOY_MODE=single_worker` 為單 Worker 託管）
- 資料不會無限膨脹（Retention 生效）

---

## 9. Phase 8 — Incidents（事件系統）& Status Page 整合（v0.2）（2–4 天）

任務：

- Worker API（admin）：
  - 完整實現 incidents：`GET/POST /api/v1/admin/incidents`
  - incident updates：`POST /api/v1/admin/incidents/:id/updates`
  - resolve：`PATCH /api/v1/admin/incidents/:id/resolve`
  - delete：`DELETE /api/v1/admin/incidents/:id`
  - 事件與監控項關聯：建立事件時指定 `monitor_ids: number[]`（影響範圍）
  - 輸入校驗（Zod）與錯誤格式統一（按 `Application.md`）
- Worker API（public）：
  - `GET /api/v1/public/incidents?limit=20`（含未解決置頂、分頁/limit）
  - `GET /api/v1/public/status` 聚合未解決事件摘要（banner 展示）
  - Public 輸出包含事件的 `monitor_ids`，用於狀態頁展示“受影響元件”
- 通知擴充套件：
  - 觸發 `incident.created / incident.updated / incident.resolved`
  - 複用 `notification_deliveries` 冪等鍵（避免同一 update 重複傳送）
- Web UI：
  - 後台新增事件管理頁：建立/更新/解決（Markdown 編輯 + 預覽）
  - 狀態頁新增事件列表與事件詳情（timeline），未解決置頂
  - 事件在 UI 上顯示“受影響 monitors”（與 monitor 列表聯動）

驗收（DoD）：

- 後台可建立事件並追加 updates；狀態頁能看到對應 timeline
- 事件狀態變化可觸發 webhook（冪等生效、失敗可追蹤）

---

## 10. Phase 9 — Maintenance Windows（維護視窗）& 告警抑制（v0.2）（2–4 天）

任務：

- Worker API（admin）：
  - `maintenance_windows` CRUD（至少 list/create/delete；可選 update）
  - 時間輸入統一 unix seconds；校驗 `starts_at < ends_at`
  - 維護視窗與監控項關聯：建立/更新時指定 `monitor_ids: number[]`
- Scheduler 語義落地（按 `Application.md`）：
  - 在維護視窗內：僅對被關聯的 monitors 抑制 down/up 通知（告警抑制）
  - 狀態頁展示維護（active/upcoming 列表，並顯示受影響 monitors）
  - 可選：維護開始/結束觸發 `maintenance.started / maintenance.ended`
- Web UI：
  - 後台維護視窗管理（建立表單 + 列表）
  - 狀態頁展示 active/upcoming maintenance（與 incidents 同風格）

驗收（DoD）：

- 維護視窗期間：僅關聯 monitors 的 DOWN/UP 不會觸發通知；其它 monitors 正常告警
- 狀態頁能正確展示 active/upcoming 維護資訊

---

## 11. Phase 10 — Analytics & 報表（v0.3）（3–7 天）

任務：

- 指標與查詢（保持 D1 可控，按 `Application.md` 7.3）：
  - 監控詳情：P50/P95 latency、uptime%、downtime 秒數、Unknown 比例（range=24h/7d/30d/90d）
  - 全域性概覽：最近 24h/7d 的整體 uptime、告警次數、最長 outage、MTTR（可先基於 outages/incident 近似）
  - 大視窗效能最佳化：必要時新增“日級 rollup 表”（migration），並由每日 Cron 回填
- Worker API：
  - Public：為狀態頁提供 30d/90d 的 uptime 概覽（避免前端做重計算）
  - Admin：新增 analytics endpoints（命名保持 `/api/v1/admin/*`，並做分頁/limit）
- Web UI：
  - 後台新增 Analytics 頁面（全域性概覽 + monitor 詳情圖表，Recharts）
  - 圖表互動：range selector、tooltip、空資料態、載入態
- 匯出（可選）：
  - CSV 匯出：outages/incidents/check_results（受 retention 限制）

驗收（DoD）：

- 7d/30d 查詢在可接受時間內完成（避免一次性拉全量導致超時）
- 後台能檢視至少：uptime%、P95 latency、outage 列表（並可按時間過濾）

---

## 12. Phase 11 — UI/UX 完善（Dashboard + Status Page）（2–6 天）

任務：

- 後台體驗：
  - Monitor 建立嚮導：HTTP/TCP 模板、實時校驗（埠/協議/私網限制提示）、測試探測按鈕
  - 列表增強：搜尋/過濾（按 type/status）、排序、分頁、批次操作（可選）
  - 全域性反饋：Toast、表單錯誤聚合、loading skeleton、空狀態文案
- 狀態頁體驗：
  - Banner 規則嚴格按 `Application.md`（incident 優先）
  - 更明確的狀態解釋：Unknown/Paused/Maintenance 文案與圖例
  - 移動端適配、基礎無障礙（鍵盤可達、對比度）
- 工程一致性：
  - 前端 API error 對映（統一展示 `error.code/message`）
  - 元件抽象（表格/彈窗/表單控制元件）避免重複

驗收（DoD）：

- 不依賴“懂內部實現”的情況下，使用者可完成：建立 monitor -> 測試 -> 儲存 -> 看圖表/事件
- 基礎互動（loading/empty/error）覆蓋主要頁面

---

## 13. Phase 12 — Settings / 自定義（Branding & 行為引數）（v0.3+）（2–5 天）

任務：

- Settings 規範化：
  - 用 `settings` 表存非敏感配置：站點標題/描述、時區、預設 range、保留天數、閾值預設值（連續失敗/成功等）
  - 管理端 settings API：`GET/PATCH /api/v1/admin/settings`（Zod 校驗）
- 狀態頁可定製：
  - Logo/Favicon（前端靜態資源：Pages `public/` 或 Worker `[assets]`）與主題色（Tailwind tokens）
  - 可選：自定義公告（類似 Statuspage 的 notice）
- 文件與上線：
  - 增補 README：自定義域名/HTTPS、Worker 環境變數、遷移步驟

驗收（DoD）：

- 不改程式碼即可調整“站點標題/描述/保留策略/預設閾值”等配置，並在 UI 生效

---

## 14. Phase 13 — 審計 / 運營工具（v0.3+）（2–5 天）

任務：

- 審計日誌（按 `Application.md` 12.3）：
  - v0：關鍵操作結構化日誌完善（monitor/incident/notification/settings）
  - v1（可選）：新增 `audit_logs` 表（migration）並落庫，提供查詢 API 與 UI
- 資料工具：
  - 配置匯入/匯出（JSON）：monitors、notification_channels、settings（不包含 secrets）
  - 故障覆盤輔助：一鍵匯出某 monitor 在時間視窗內的 outages/incidents/check_results

驗收（DoD）：

- 能回答“誰在什麼時候改了什麼配置”（至少 logs；可選落庫）
- 能匯出一份可復現問題的最小資料包（用於 issue/分享）

---

## 15. Phase 14 — Advanced Monitoring & 通知規則（v1）（3–10 天）

任務：

- 監控能力增強（不引入新服務）：
  - HTTP：響應時間閾值告警、header 斷言、允許/禁止重定向（可配）
  - Flapping 控制：cooldown、grace period、error reason 變更策略（按 `Application.md` 6.5）
- 通知規則：
  - 細化觸發條件：按 monitor/tag/impact 分級通知（可能需要新增 join 表 migration）
  - 預置模板：Discord/Slack/Telegram 等（本質仍為 Webhook 配置模板）
- 狀態頁細化：
  - 元件分組（Group/Tag）與聚合展示（需要 schema 擴充套件時以 migration 落地）

驗收（DoD）：

- 可透過 UI 配置：某些 monitor 只在“持續 DOWN >= N 分鐘”才告警，並可驗證生效
- 狀態頁能按元件分組展示並保持 banner 聚合規則一致

---

## 16. Phase 15 — 多地域探測（可選增強）（v1+）（5–14 天）

說明：Cron 不保證在所有邊緣節點觸發；若要“多地域探測”，需引入額外機制（見 `Application.md` 6.7）。本階段屬於可選增強，若要引入 Durable Objects/外部探針，需要在變更說明中寫清必要性與替代方案。

任務（兩種路線二選一）：

- 路線 A：Durable Objects 探針編排（可控 region）
  - 為不同 region 配置 DO `locationHint`，由主排程器 fan-out 請求各 DO 執行 check
  - 資料模型擴充套件：`check_results.location` 標準化（region/colo），UI 展示多條曲線/分割槽狀態
- 路線 B：外部探針（非預設依賴）
  - 定義探針上報協議與簽名；Worker 接收並寫入結果（仍走現有狀態機/通知）

驗收（DoD）：

- 同一 monitor 可看到多地域延遲/成功率，並能配置“按多數派/最差地域”決定全域性狀態（策略可先固定後可配）

---

## 17. Phase 16 — “產品化”收尾（v1+）（2–6 天）

任務：

- 效能與成本：
  - Public API 快取（`caches.default` + TTL），並保證監控探測請求仍為 no-store
  - scheduled 執行時間與 D1 查詢最佳化（索引審計、批次寫、降級策略）
- 釋出體驗：
  - 完整的部署嚮導文件（從 0 到上線）
  - 示例資料/演示模式（可選，便於自測 UI）
- 穩定性與迴歸：
  - 補齊關鍵單測/整合測試（狀態機、SLA 計算、incident/maintenance 聚合）
  - 迴歸用例清單（手動步驟 + curl）

驗收（DoD）：

- 新使用者按文件可在 30 分鐘內完成部署並看到第一條監控資料
- 有一套可重複執行的迴歸步驟，覆蓋核心路徑（探測->狀態機->通知->狀態頁）
