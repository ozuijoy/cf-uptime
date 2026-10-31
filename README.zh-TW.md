<div align="center">

# CF Uptime

**基於 Cloudflare 邊緣網路的 Serverless 可用性監控與狀態頁**

[![CI](https://github.com/ozuijoy/cf-uptime/actions/workflows/ci.yml/badge.svg)](https://github.com/ozuijoy/cf-uptime/actions/workflows/ci.yml)
[![Deploy](https://github.com/ozuijoy/cf-uptime/actions/workflows/deploy.yml/badge.svg)](https://github.com/ozuijoy/cf-uptime/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

監控你的服務，向訪客展示實時狀態，並在服務異常時傳送通知 — 全部執行在 Cloudflare Workers + Pages + D1 上，零運維。

[快速部署](#快速部署5-步完成) · [本地開發](#本地開發) · [文件](#文件) · [貢獻指南](CONTRIBUTING.zh-TW.md)

**[English](README.md)** | 中文

</div>

---

## 為什麼選擇 CF Uptime？

- **零運維** — 無需管理伺服器、容器或資料庫。完全執行在 Cloudflare 的免費/付費套餐上。
- **邊緣原生** — 監控探針從 Cloudflare Workers 發起，狀態頁由 CDN 邊緣節點分發。
- **一鍵部署** — 推送到 `main` 分支，GitHub Actions 自動完成：D1 遷移、Worker API 與 Pages 前端（可選 single Worker 模式）。
- **功能完整** — HTTP/TCP 探測、事件管理、維護視窗、Webhook 通知、管理後台。

## 功能特性

**監控**

- HTTP(S) 探測，支援自定義 Headers、Body、狀態碼白名單/黑名單（精確碼與區間）與關鍵詞斷言
- TCP 埠連通性檢測
- 可配置的超時、重試閾值與抖動控制
- 自動狀態機：UP / DOWN / MAINTENANCE / PAUSED / UNKNOWN

**狀態頁**

- 面向公眾的狀態頁，實時展示聚合狀態
- 每個監控項的可用率百分比與延遲圖表
- 當前活躍的事件與維護視窗
- 多語言支援（en、zh-TW、ja、es）—— 舊的 zh-CN 設定會自動轉為 zh-TW

**事件管理**

- 建立、更新、解決事件，附帶時間線
- 計劃維護視窗
- 所有事件在公共狀態頁可見

**通知**

- Webhook 通知至 Discord、Slack、ntfy 或任意 HTTP 端點
- 可自定義的訊息與 Payload 模板，支援魔法變數
- 可選的 HMAC-SHA256 簽名驗證
- 冪等投遞與去重

**管理後台**

- 監控項 CRUD 與實時狀態概覽
- 通知渠道管理，支援測試按鈕
- 分析面板，含可用率/延遲圖表與 CSV 匯出
- 系統設定（站點標題、時區、閾值、資料保留）

## 架構

預設部署形態為 **Pages + Workers**（前後端分離）。也可選用 **single_worker** 模式，將 SPA 與 API 部署到同一個 Worker 域名。

```
                ┌──────────────────────────────────────────┐
                │            Cloudflare Network            │
                │                                          │
Visitors ──────►│  Pages (React SPA)                       │
                │      │  /api/*  →  代理到 Worker         │
                │      ▼                                   │
Admin ─────────►│  Workers (Hono API)                      │
                │      │              │                    │
                │      ▼              ▼                    │
                │    D1 DB      Cron Triggers              │
                │              (定時探測)                  │
                │                     │                    │
                └─────────────────────┼────────────────────┘
                                      │
                                      ▼
                           Target Services (HTTP/TCP)
                                      │
                                      ▼
                              Webhooks ──► Discord / Slack / ntfy
```

**預設（`pages`）**：狀態頁與管理後台部署在 Cloudflare Pages；Worker 負責 API 與定時探測。Pages 透過 `apps/web/public/_worker.js` 將 `/api/*` 代理到 Worker，並在首屏 HTML 中預注入首頁快照資料。

**可選（`single_worker`）**：設定 GitHub Actions 變數 `UPTIMER_DEPLOY_MODE=single_worker`，構建後的 SPA 會作為 Worker 的 `[assets]` 上傳。狀態頁、管理後台與 API 共用同一域名（無需 Pages 專案）。注意：首屏需在 SPA 載入後請求 `/api/v1/public/homepage` 完成渲染（無 HTML 預注入）；若從現有 `pages` 切換到此模式，需手動刪除舊的 Pages 專案或配置重定向。

## 技術棧

| 層級   | 技術                                                               |
| ------ | ------------------------------------------------------------------ |
| 前端   | React 18, Vite, TypeScript, Tailwind CSS, TanStack Query, Recharts |
| 後端   | Cloudflare Workers, Hono, Zod                                      |
| 資料庫 | Cloudflare D1 (SQLite), Drizzle ORM                                |
| 託管   | Cloudflare Pages（前端）+ Workers（API）；可選單 Worker 模式       |
| CI/CD  | GitHub Actions                                                     |
| 包管理 | pnpm（monorepo）                                                   |

## 快速部署（5 步完成）

無需修改任何程式碼或配置檔案，即可部署專屬於你的 CF Uptime 例項：

### 第 1 步 — Fork 倉庫

點選本倉庫右上角的 **Fork** 按鈕，建立你自己的副本。

### 第 2 步 — 建立 Cloudflare API Token

1. 前往 [Cloudflare Dashboard → API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. 點選 **Create Token** → 使用 **Edit Cloudflare Workers** 模板
3. 新增以下許可權：
   - `Account / Cloudflare Pages / Edit`
   - `Account / D1 / Edit`
   - `Account / Account Settings / Read`
4. 複製生成的 Token

> `Cloudflare Pages / Edit` 僅預設 `pages` 模式需要。若使用 `UPTIMER_DEPLOY_MODE=single_worker`，可不授予 Pages 許可權。

### 第 3 步 — 新增 GitHub Secrets

進入你 Fork 的倉庫 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，新增：

| Secret 名稱             | 值                                                                                                            | 是否必填 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | :------: |
| `CLOUDFLARE_API_TOKEN`  | 第 2 步獲取的 Token                                                                                           |   必填   |
| `UPTIMER_ADMIN_TOKEN`   | 任意強密碼字串（用於登入管理後台）                                                                          |   必填   |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 [Cloudflare Account ID](https://developers.cloudflare.com/fundamentals/setup/find-account-and-zone-ids/) |   推薦   |

可選倉庫 **變數**（非 Secret）：`UPTIMER_DEPLOY_MODE` = `pages`（預設）或 `single_worker`。

### 第 4 步 — 執行 GitHub Actions

進入 **Actions** → **Deploy to Cloudflare** → **Run workflow**（或直接向 `main`/`master` 推送一次提交）。

工作流會自動完成：

- 建立 D1 資料庫並執行遷移
- 部署 Worker（API + 定時探測）
- 預設模式：構建前端（Vite）並部署到 Cloudflare Pages
- single_worker 模式：構建前端，並作為靜態資源與 Worker 一起上傳
- 注入管理金鑰為 Worker Secret

### 第 5 步 — 訪問你的狀態頁

工作流執行成功後（首次部署通常約 2 分鐘）：

**預設（`pages` 模式）：**

- **狀態頁** → `https://<你的-pages-專案名>.pages.dev`
- **管理後台** → `https://<你的-pages-專案名>.pages.dev/admin`
- **API** → `https://<你的-worker-名>.workers.dev/api/v1/public/status`

**可選（`single_worker` 模式）：**

- **狀態頁** → `https://<你的-worker-名>.workers.dev`
- **管理後台** → `https://<你的-worker-名>.workers.dev/admin`
- **API** → `https://<你的-worker-名>.workers.dev/api/v1/public/status`

使用你設定的 `UPTIMER_ADMIN_TOKEN` 登入管理後台，即可開始新增監控項。

> **保持更新** — 由於你從自己的 Fork 部署，隨時可以[同步上游倉庫](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork)獲取最新功能。每次同步後，部署工作流會自動執行。

> 高階選項（自定義域名、資源命名、管理路徑等）請參閱[部署指南](docs/deploy-github-actions.zh-TW.md)。

---

## 本地開發

<details>
<summary>點選展開本地開發環境配置</summary>

### 前置要求

- Node.js >= 22.14.0
- pnpm >= 10.8.1

### 配置步驟

```bash
# 1. 克隆並安裝依賴
git clone https://github.com/<your-username>/CF Uptime.git
cd CF Uptime
pnpm install

# 2. 配置本地金鑰
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# 編輯 .dev.vars，設定 ADMIN_TOKEN=your-secret-token

# 3. 一鍵初始化並啟動開發伺服器
pnpm dev
```

預設地址：

- **狀態頁**：http://localhost:5173
- **管理後台**：http://localhost:5173/admin
- **API**：http://localhost:8787/api/v1

> 完整的本地開發指南（種子資料、API 測試、常見問題）請參閱 [Develop/LOCAL-TESTING.md](Develop/LOCAL-TESTING.md)。

</details>

## 文件

| 文件                                              | 說明                               |
| ------------------------------------------------- | ---------------------------------- |
| [部署指南](docs/deploy-github-actions.zh-TW.md)   | GitHub Actions 部署完整流程        |
| [配置參考](docs/configuration-reference.zh-TW.md) | 所有可配置引數（金鑰、變數、設定） |
| [通知系統](docs/notifications.zh-TW.md)           | Webhook 配置、模板、簽名、故障排除 |
| [本地開發](Develop/LOCAL-TESTING.md)              | 本地環境搭建、種子資料、測試流程   |

## 質量檢查

```bash
pnpm lint          # ESLint 全包檢查
pnpm typecheck     # TypeScript 嚴格型別檢查
pnpm test          # 單元測試
pnpm format:check  # Prettier 格式檢查
```

## 貢獻

歡迎貢獻！請參閱 [CONTRIBUTING.zh-TW.md](CONTRIBUTING.zh-TW.md) 瞭解詳情。

## 許可證

本專案基於 MIT 許可證開源 — 詳見 [LICENSE](LICENSE) 檔案。

---

<div align="center">

基於 [Cloudflare Workers](https://workers.cloudflare.com/) + [Hono](https://hono.dev/) + [React](https://react.dev/) 構建

感謝 [UptimeFlare](https://github.com/lyc8503/UptimeFlare) 在 Cloudflare 原生可用性監控模式上帶來的啟發。

</div>
