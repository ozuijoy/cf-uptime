# Structure.md: Repository Structure (CF Uptime)

本文定義 CF Uptime 倉庫的目錄結構、模組邊界與命名約定，用於初始化與後續協作一致性。

---

## 1. 頂層目錄（當前）

```
.
├─ apps/
│  ├─ web/                      # React + Vite 前端（管理後台 + 公共狀態頁）；預設部署到 Pages，single_worker 模式由 Worker [assets] 提供
│  └─ worker/                   # Cloudflare Workers: Hono API + scheduled 監控引擎（[assets] 可選託管前端）
├─ packages/
│  ├─ shared/                   # 共享型別/常量/Zod schema（前後端共用）
│  └─ db/                       # Drizzle schema 與 DB 訪問封裝（供 worker 使用）
├─ Develop/                     # 產品規格、結構、計劃、API 參考、釋出記錄
├─ .github/workflows/           # CI/CD（預設 Pages + Worker；可選 single_worker 部署、D1 遷移）
├─ AGENTS.md                    # 程式碼助手/協作約定
└─ reference-project/           # 參考專案（只讀；不要在此處開發）
```

說明：

- 本倉庫採用 monorepo 結構，便於共享型別與統一依賴。
- 規格文件統一放在 `Develop/`；Issue #24 CPU release 記錄見 `Develop/Worker-CPU-10ms-Release-Readiness.md`。
- 只讀參考專案僅作為 Cloudflare API/Workers 用法參考；本專案實現應以 `Develop/Application.md` 為準。

---

## 2. Worker（後端）結構

```
apps/worker/
├─ wrangler.toml                # Worker 配置（D1 binding、cron triggers、Free Plan CPU profile；CI 按需注入 [assets]）
├─ migrations/                  # D1 SQL migrations（wrangler d1 migrations apply）
└─ src/
   ├─ index.ts                  # Worker entry：fetch/scheduled/export default
   ├─ fetch-handler.ts          # fetch 入口拆分，降低 scheduled cold path 負擔
   ├─ hono-app.ts               # Hono app 與路由掛載
   ├─ env.ts                    # Env interface（D1 binding、secrets、feature flags）
   ├─ analytics/                # latency / uptime 聚合 helpers
   ├─ internal/                 # scheduled/service-binding internal handlers
   │  ├─ homepage-refresh-core.ts
   │  ├─ runtime-fragments-refresh-core.ts
   │  ├─ sharded-public-snapshot-core.ts
   │  └─ sharded-public-snapshot-continuation.ts
   ├─ middleware/               # auth / errors / public cache / rate limit
   ├─ routes/
   │  ├─ public.ts              # /api/v1/public/*（完整 public API）
   │  ├─ public-hot.ts          # homepage/status/artifact hot snapshot path
   │  ├─ public-ui*.ts          # status UI 輔助 API
   │  ├─ admin*.ts              # admin CRUD / settings / analytics / exports
   │  └─ ...
   ├─ scheduler/
   │  ├─ scheduled.ts           # scheduled() 編排、check-batch children、CPU profile
   │  ├─ daily-rollup.ts        # monitor_daily_rollups
   │  ├─ lock.ts / lease-guard.ts
   │  ├─ notifications.ts
   │  └─ retention.ts
   ├─ monitor/                  # HTTP/TCP check、target validation、state machine
   ├─ notify/                   # Webhook dispatch、template、dedupe
   ├─ observability/            # trace/timing helpers（diagnostics 預設關閉）
   ├─ public/                   # homepage/status payload compute、runtime snapshot、visibility
   ├─ schemas/                  # Zod schemas for public/admin/stored payloads
   └─ snapshots/                # public_snapshots read/write, fragments, homepage artifact
```

約定：

- 所有對外 API 均從 `routes/` 進入；非路由邏輯沉到 `public/`、`snapshots/`、`internal/`、`scheduler/` 等模組。
- `scheduled()` 入口僅負責編排流程與日誌；探測、runtime fragment 寫入、sharded public snapshot publish 拆為小 invocation。
- `internal/` routes 僅由 scheduled/service binding 使用，必須保持 Bearer Token 鑑權與 feature flag gating。

---

## 3. Web（前端）結構

```
apps/web/
├─ public/
├─ index.html
├─ vite.config.ts
└─ src/
   ├─ main.tsx
   ├─ app/
   │  ├─ router.tsx             # React Router 路由表
   │  └─ queryClient.ts         # TanStack Query 配置
   ├─ api/
   │  ├─ client.ts              # fetch 封裝（baseUrl、錯誤處理）
   │  └─ types.ts               # 前端 API 型別（優先從 packages/shared 匯入）
   ├─ pages/
   │  ├─ StatusPage.tsx         # 公共狀態頁
   │  ├─ AdminLogin.tsx         # 可選（僅 Token 輸入/儲存到 localStorage）
   │  └─ AdminDashboard.tsx
   ├─ features/
   │  ├─ monitors/              # 監控項 CRUD UI
   │  ├─ incidents/             # 事件管理 UI
   │  └─ notifications/         # 通知渠道 UI
   ├─ components/
   ├─ styles/
   └─ utils/
```

約定：

- 與後端共享的型別與 schema 優先從 `packages/shared` 匯入，避免前後端“各寫一套”。
- API 請求統一走 `api/client.ts`；不要在元件內散落裸 `fetch`。
- 前端構建產物（`apps/web/dist`）託管方式取決於部署模式：預設 `pages` 部署到 Cloudflare Pages（`apps/web/public/_worker.js` 代理 `/api/*`）；`UPTIMER_DEPLOY_MODE=single_worker` 時由 Worker `[assets]` 提供，`/api/*` 走 Worker，其餘路徑靜態資源 + SPA fallback。`VITE_API_BASE` 在兩種模式下均可預設 `/api/v1`（pages 模式依賴代理或 CI 注入的絕對地址）。

---

## 4. Shared/DB 包結構

```
packages/shared/
└─ src/
   ├─ constants.ts              # 列舉/常量（status、event type）
   ├─ schemas.ts                # Zod schemas（API input/output、DB json 欄位）
   └─ types.ts                  # TypeScript 型別（由 schema 推導）

packages/db/
└─ src/
   ├─ schema.ts                 # Drizzle table schema（與 migrations 一致）
   └─ index.ts                  # 匯出 db helpers
```

約定：

- DB schema（Drizzle）與 D1 migrations（SQL）必須同步變更；任何 schema 改動必須伴隨新增 migration。
- `config_json`、`*_json` 欄位統一使用 Zod 做執行時校驗。

---

## 5. 命名與邊界規則

- 路由：
  - Public: `/api/v1/public/*`
  - Admin: `/api/v1/admin/*`
- 時間欄位：
  - 對外 API 與 D1 儲存統一使用 unix seconds（INTEGER），欄位名以 `*_at` 結尾。
- 狀態欄位：
  - DB/介面統一用 `up|down|maintenance|paused|unknown`；延遲統一用 `latency_ms`。
- 不允許在 `apps/web` 直接依賴 Worker 執行時 API（如 `cloudflare:sockets`）。
- 不允許修改只讀參考專案作為實現的一部分（除非明確要求）。
