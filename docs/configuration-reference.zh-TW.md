# 配置參考

[English](configuration-reference.md) | 中文

CF Uptime 所有可配置引數，按部署時、執行時、本地開發分類。

## 1. GitHub Actions（部署時）

來源：`.github/workflows/deploy.yml`

### Secrets

| 名稱                    | 必需       | 說明                                                              |
| ----------------------- | ---------- | ----------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | 是         | Cloudflare API 認證（部署 Worker、管理 D1；pages 模式還需 Pages） |
| `CLOUDFLARE_ACCOUNT_ID` | 否（推薦） | Cloudflare Account ID；未提供時工作流嘗試自動解析                 |
| `UPTIMER_ADMIN_TOKEN`   | 是         | 管理面板訪問金鑰；自動寫入 Worker Secret `ADMIN_TOKEN`            |
| `VITE_ADMIN_PATH`       | 否         | 覆蓋管理後台路徑（優先順序高於 Variable）                           |

### Variables

| 名稱                    | 預設值               | 說明                                                                                                        |
| ----------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `UPTIMER_PREFIX`        | 倉庫名 slug          | 統一資源名字首                                                                                              |
| `UPTIMER_WORKER_NAME`   | `${UPTIMER_PREFIX}`  | Worker 名稱                                                                                                 |
| `UPTIMER_PAGES_PROJECT` | `${UPTIMER_PREFIX}`  | Pages 專案名（僅 `pages` 模式）                                                                             |
| `UPTIMER_D1_NAME`       | `${UPTIMER_PREFIX}`  | D1 資料庫名                                                                                                 |
| `UPTIMER_D1_BINDING`    | `DB`                 | Worker 中 D1 binding 名稱                                                                                   |
| `UPTIMER_DEPLOY_MODE`   | `pages`              | `pages`（Pages + Workers）或 `single_worker`（SPA 掛 Worker assets）；手動觸發可用輸入項 `deploy_mode` 覆蓋 |
| `UPTIMER_API_BASE`      | 自動推導或 `/api/v1` | 完整 API 地址（如 `https://my-worker.example.com/api/v1` 或 `/api/v1`）；僅 `pages` 模式                    |
| `UPTIMER_API_ORIGIN`    | 自動推導             | API 域名來源（如 `https://my-worker.example.com`，自動追加 `/api/v1`）；僅 `pages` 模式                     |
| `VITE_ADMIN_PATH`       | —                    | 管理後台路徑（可被 Secret 覆蓋）                                                                            |
| `UPTIMER_ADMIN_PATH`    | —                    | 相容變數名（`VITE_ADMIN_PATH` 的 fallback）                                                                 |

> **API 地址（`pages` 模式）**：通常無需配置——工作流會自動檢測 Worker URL。僅當 API 使用自定義域名時才需設定 `UPTIMER_API_BASE` 或 `UPTIMER_API_ORIGIN`。兩者接受不同格式的同類資訊，設定任意一個即可。Pages 還會透過 `apps/web/public/_worker.js` 代理 `/api/*`。
>
> **API 地址（`single_worker` 模式）**：無需配置——前端與 API 共用 Worker 來源，SPA 以相對路徑呼叫 `/api/v1`。

## 2. Worker 執行時

### Secrets

| 名稱          | 必需 | 說明                    |
| ------------- | ---- | ----------------------- |
| `ADMIN_TOKEN` | 是   | 管理員 API Bearer Token |

### 環境變數

來源：`apps/worker/wrangler.toml` 與 `apps/worker/src/env.ts`

| 名稱                          | 預設值 | 說明                            |
| ----------------------------- | ------ | ------------------------------- |
| `ADMIN_RATE_LIMIT_MAX`        | `60`   | 管理端 API 限流視窗內最大請求數 |
| `ADMIN_RATE_LIMIT_WINDOW_SEC` | `60`   | 管理端 API 限流視窗長度（秒）   |

### 靜態資源（`[assets]`）

基礎 `apps/worker/wrangler.toml` 預設不包含 `[assets]` 配置，使本地 `wrangler dev` 與測試無需依賴預構建前端即可執行。CI 行為：

- `pages` 模式（預設）：生產 Worker 僅提供 API（無 `[assets]`）；前端部署至 Cloudflare Pages
- `single_worker` 模式：CI 動態向 `wrangler.ci.toml` 注入 `[assets]`，SPA 與 Worker 一起釋出

## 3. Web 構建時

來源：`apps/web/.env.example`

| 名稱              | 預設值    | 說明                    |
| ----------------- | --------- | ----------------------- |
| `VITE_ADMIN_PATH` | `/admin`  | 管理後台路由字首        |
| `VITE_API_BASE`   | `/api/v1` | 前端訪問 API 的基礎 URL |

> `VITE_API_BASE` 預設 `/api/v1`。`single_worker`（同源）以及配置了 Pages 代理的 `pages` 模式下都是正確值。CI 在 `pages` 模式下可能會寫入 Worker 的絕對地址。

## 4. 執行時設定（D1）

來源：`apps/worker/src/schemas/settings.ts`

可透過 Admin API `PATCH /api/v1/admin/settings` 更新。

| Key                               | 說明                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| `site_title`                      | 狀態頁標題                                                  |
| `site_description`                | 狀態頁描述                                                  |
| `site_locale`                     | 站點語言（`auto` / `en` / `zh-TW` / `ja` / `es`）；舊的 `zh-CN` 會被接受並正規化為 `zh-TW` |
| `site_timezone`                   | IANA 時區識別符號                                             |
| `retention_check_results_days`    | `check_results` 資料保留天數                                |
| `state_failures_to_down_from_up`  | UP -> DOWN 所需連續失敗次數                                 |
| `state_successes_to_up_from_down` | DOWN -> UP 所需連續成功次數                                 |
| `admin_default_overview_range`    | 管理後台總覽預設時間範圍                                    |
| `admin_default_monitor_range`     | 管理後台監控詳情預設時間範圍                                |
| `uptime_rating_level`             | 可用率評級閾值                                              |

## 5. 本地開發

### Worker

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
```

最小配置：

```dotenv
ADMIN_TOKEN=changeme
```

### Web

```bash
cp apps/web/.env.example apps/web/.env
```

可選配置：

```dotenv
VITE_ADMIN_PATH=/admin
```

## 6. 安全注意事項

- `ADMIN_TOKEN` 僅能儲存在 Worker Secrets 或本地 `.dev.vars` 中，絕不能提交到 Git。
- GitHub Actions 中敏感值必須使用 Secrets，不要放在 Variables 中。
- Webhook 簽名金鑰必須引用 Worker Secrets（不要存入資料庫）。
