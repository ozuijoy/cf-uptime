# 部署指南（GitHub Actions）

[English](deploy-github-actions.md) | 中文

透過倉庫內建的 GitHub Actions 工作流將 CF Uptime 部署到 Cloudflare。

## 前置要求

- GitHub 倉庫（預設分支為 `master` 或 `main`）
- Cloudflare 賬號
- 具有部署許可權的 Cloudflare API Token
- 倉庫 Settings > Secrets and Variables 的配置許可權

## 工作流概覽

**觸發方式**：推送到 `main`/`master`，或手動觸發 `workflow_dispatch`

**配置檔案**：`.github/workflows/deploy.yml`

**部署模式**（倉庫變數 `UPTIMER_DEPLOY_MODE`，或 `workflow_dispatch` 輸入 `deploy_mode`）：

| 模式            | 是否預設 | 部署內容                                                 |
| --------------- | -------- | -------------------------------------------------------- |
| `pages`         | 是       | Worker（API + 定時任務）+ Cloudflare Pages SPA           |
| `single_worker` | 否       | 單個 Worker 同時提供 SPA 靜態資源與 API（無 Pages 專案） |

手動觸發時的優先順序：`workflow_dispatch` 輸入 `deploy_mode` > 倉庫變數 `UPTIMER_DEPLOY_MODE` > 預設 `pages`。輸入項預設為 `auto`，即沿用倉庫變數。

> **部署模式注意事項**：
>
> - **預載入行為**：在 `pages` 模式下，Pages 代理層（`apps/web/public/_worker.js`）會在首屏 HTML 中直接預注入首頁快照資料以提升首屏渲染速度。而在 `single_worker` 模式下，無 HTML 預注入，首屏頁面在 SPA 載入後由客戶端請求 `/api/v1/public/homepage` 完成渲染。
> - **模式切換**：如果將現有的 `pages` 部署切換為 `single_worker`，原本的 Cloudflare Pages 專案仍然存在於你的 Cloudflare 賬戶中，需要手動刪除或配置重定向，以避免訪問到舊版本的頁面。

**執行步驟（按順序）**：

1. 安裝 Node + pnpm + 依賴
2. 解析 Cloudflare Account ID（優先讀配置，回退到 API 查詢）
3. 計算資源命名（Worker / Pages / D1）並校驗 `UPTIMER_DEPLOY_MODE`
4. 檢查或建立 D1 資料庫，注入真實 `database_id` 到臨時 `wrangler.ci.toml`
5. 在 `single_worker` 模式下向臨時 `wrangler.ci.toml` 注入 Worker `[assets]`
6. 遠端執行 D1 遷移
7. 部署 Worker
   - `pages`：僅 API Worker（基礎配置不包含 `[assets]`）
   - `single_worker`：SPA + API 透過注入的 `[assets]` 一起上傳
8. （可選）寫入 Worker Secret：`ADMIN_TOKEN`
9. **僅 pages 模式**：解析 API base/origin，構建 Vite SPA，建立/部署 Pages 專案，設定 Pages Secret `UPTIMER_API_ORIGIN`

## 配置說明

### 必需金鑰

| 名稱                   | 必需 | 說明                                                    |
| ---------------------- | ---- | ------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` | 是   | Cloudflare API 認證                                     |
| `UPTIMER_ADMIN_TOKEN`  | 是   | 管理面板訪問金鑰；自動寫入 Worker 的 `ADMIN_TOKEN` 金鑰 |

> 預設 `pages` 模式需要 `Account / Cloudflare Pages / Edit` 許可權。`single_worker` 模式不需要 Pages 許可權。

### 推薦金鑰

| 名稱                    | 說明             |
| ----------------------- | ---------------- |
| `CLOUDFLARE_ACCOUNT_ID` | 避免自動解析失敗 |

### 可選變數

覆蓋預設命名，或切換部署模式：

| 名稱                                     | 預設值               | 說明                                                                                     |
| ---------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| `UPTIMER_PREFIX`                         | 倉庫名 slug          | 統一資源名字首                                                                           |
| `UPTIMER_WORKER_NAME`                    | `${UPTIMER_PREFIX}`  | Worker 名稱                                                                              |
| `UPTIMER_PAGES_PROJECT`                  | `${UPTIMER_PREFIX}`  | Pages 專案名（僅 `pages` 模式）                                                          |
| `UPTIMER_D1_NAME`                        | `${UPTIMER_PREFIX}`  | D1 資料庫名                                                                              |
| `UPTIMER_D1_BINDING`                     | `DB`                 | Worker 中 D1 binding 名稱                                                                |
| `UPTIMER_DEPLOY_MODE`                    | `pages`              | `pages` 或 `single_worker`；手動觸發時也可用輸入項 `deploy_mode`                         |
| `UPTIMER_API_BASE`                       | 自動推導或 `/api/v1` | 完整 API 地址（如 `https://my-worker.example.com/api/v1` 或 `/api/v1`）；僅 `pages` 模式 |
| `UPTIMER_API_ORIGIN`                     | 自動推導             | API 域名來源（如 `https://my-worker.example.com`，自動追加 `/api/v1`）；僅 `pages` 模式  |
| `VITE_ADMIN_PATH` / `UPTIMER_ADMIN_PATH` | —                    | 自定義管理後台路徑                                                                       |

> 若不配置命名變數，工作流會使用倉庫名 slug 作為預設字首。這在 fork 場景下能保持命名穩定。
>
> **API 地址（`pages` 模式）**：SPA 構建時寫入 `VITE_API_BASE`（預設 `<worker>/api/v1`）。Pages advanced-mode worker 在配置了 `UPTIMER_API_ORIGIN` 時也會把 `/api/*` 代理到 Worker。
>
> **API 地址（`single_worker` 模式）**：無需配置——前端與 API 共用 Worker 來源，SPA 以相對路徑呼叫 `/api/v1`。

## Cloudflare Token 許可權

工作流會建立和更新多個資源，你的 Token 需要以下許可權：

- Workers 指令碼：部署與管理金鑰
- Cloudflare Pages：建立專案與部署（預設 `pages` 模式）
- D1：查詢、建立與遷移資料庫
- 賬號：讀取賬號資訊（用於 Account ID 解析）

## 首次部署

1. 在倉庫 Secrets 中新增 `CLOUDFLARE_API_TOKEN`
2. 新增 `UPTIMER_ADMIN_TOKEN`（管理面板訪問金鑰）
3. 新增 `CLOUDFLARE_ACCOUNT_ID`（推薦）
4. （可選）設定 `UPTIMER_PREFIX`，避免與其他例項重名
5. （可選）設定變數 `UPTIMER_DEPLOY_MODE=single_worker`，或手動執行工作流時選擇 `deploy_mode`
6. 推送到 `master`/`main`，或手動觸發 "Deploy to Cloudflare"
7. 工作流成功後，從日誌中記錄訪問地址：
   - `pages`：狀態頁在 `*.pages.dev`，API 在 `*.workers.dev`
   - `single_worker`：狀態頁、管理後台與 API 都在 Worker URL

> **手動 `wrangler deploy`**：`apps/worker/wrangler.toml` 基礎配置不包含 `[assets]`，直接執行 `wrangler deploy` 會部署 API-only Worker。如需 `single_worker` 部署，請走 GitHub Actions（CI 會向 `wrangler.ci.toml` 動態注入 `[assets]`）或手動新增 `[assets]` 配置。

## 部署後驗證

### 檢查狀態頁

- `pages`：訪問 `https://<pages-專案名>.pages.dev`（管理後台在 `/admin`）
- `single_worker`：訪問 `https://<worker-名>.workers.dev`（管理後台在 `/admin`）

### 測試 API

```bash
# 公開 API（single_worker：與狀態頁使用同一域名）
curl https://<worker-url>/api/v1/public/status

# 管理 API
curl https://<worker-url>/api/v1/admin/monitors \
  -H "Authorization: Bearer <YOUR_ADMIN_TOKEN>"
```

### 驗證資料庫（可選）

使用 Wrangler 檢查 D1 中關鍵表是否存在：

```
monitors, monitor_state, check_results, outages, settings
```

## 故障排除

### "Resolve Cloudflare Account ID" 失敗

- 確認 `CLOUDFLARE_API_TOKEN` 已設定且有效
- 確認 Token 具有賬號讀取許可權
- 直接設定 `CLOUDFLARE_ACCOUNT_ID` 跳過自動解析

### D1 遷移失敗

- 檢查 `UPTIMER_D1_BINDING` 是否與 `apps/worker/wrangler.toml` 中的 binding 一致
- 確認遷移 SQL 是冪等的且語法正確

### 靜態資源或 SPA 路由返回 404（`single_worker` 模式）

- 確認 `Build Web (Vite, single_worker)` 步驟在 `Deploy Worker` 之前已生成 `apps/web/dist`
- 確認 CI 生成的 `wrangler.ci.toml` 仍包含 `[assets]`（`UPTIMER_DEPLOY_MODE=single_worker` 時由 CI 注入）
- `/admin` 等深連結依賴 SPA fallback；本地開發請使用 `:5173` 的 Vite 伺服器

### 狀態頁能開啟但 API 呼叫失敗（`pages` 模式）

- 確認 Pages 專案已建立，且 `Deploy Pages` 在 Worker 部署之後執行
- 檢查 Pages Secret `UPTIMER_API_ORIGIN` 是否指向 Worker origin（工作流會 best-effort 設定）
- 確認構建產物中包含 `apps/web/public/_worker.js`（Vite 會複製 `public/`）

### 管理端返回 401

- 確認 `UPTIMER_ADMIN_TOKEN` 已寫入 Worker Secret
- 檢查瀏覽器 localStorage 中的 token 是否與 Secret 一致

## 回滾

優先重新部署上一個已知可用的 commit：

1. 找到上一個綠色部署 commit
2. 基於該 commit 重新觸發 "Deploy to Cloudflare"
3. 若涉及 Schema 變更，透過新增前向相容 migration 修復，而非回滾

> D1 遷移不應做破壞性回滾。若遠端遷移已執行，請透過新增 migration 向前修復。

## 與 CI 的關係

| 工作流       | 用途                            |
| ------------ | ------------------------------- |
| `ci.yml`     | 質量門禁：lint、typecheck、test |
| `deploy.yml` | 生產釋出                        |

推薦的分支策略：

- PR 合併前必須透過 CI
- `master`/`main` 僅接收經過 Review 的變更
- 釋出由 push 自動觸發，避免手工漂移
