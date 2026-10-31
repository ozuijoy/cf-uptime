# 貢獻指南

[English](CONTRIBUTING.md) | 中文

感謝你對 CF Uptime 專案的關注！本指南介紹貢獻的基本流程。

## 開發環境搭建

```bash
# 前置要求：Node.js >= 22.14.0、pnpm >= 10.8.1

git clone https://github.com/VrianCao/cf-uptime.git
cd CF Uptime
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm dev
```

完整的本地開發指南請參閱 [Develop/LOCAL-TESTING.md](Develop/LOCAL-TESTING.md)。

## 提交變更

1. 從 `master` 建立新分支
2. 進行修改，保持變更小而聚焦
3. 確保透過質量檢查：
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm format:check
   ```
4. 如果修改了 D1 Schema，必須新增 **新的** migration 檔案（不要修改已有的 migration）
5. 提交 Pull Request

## 程式碼風格

- 所有包均啟用 TypeScript strict 模式
- 程式碼格式由 Prettier 統一管理 — 提交前執行 `pnpm format`
- Lint 規則定義在 `eslint.config.mjs`

## 架構說明

提交變更前，請先閱讀以下文件：

- [Develop/Application.md](Develop/Application.md) — 產品規格與技術約束
- [Develop/Structure.md](Develop/Structure.md) — 目錄結構與模組邊界
- [AGENTS.md](AGENTS.md) — 協作約定

關鍵約定：

- 所有 API 輸入必須使用 Zod 校驗
- 所有資料庫寫入必須使用引數化查詢（Drizzle ORM）
- 共享型別放在 `packages/shared`，不要在各 app 中重複定義
- API 路由定義在 `apps/worker/src/routes/`，業務邏輯放在對應的領域模組中

## 提交 Issue

提交 Bug 報告時，請包含：

- 復現步驟
- 期望行為 vs 實際行為
- 相關日誌或錯誤資訊
- 部署方式（本地開發 / GitHub Actions / 手動部署）

## Pull Request

- PR 應小而聚焦於單一關注點
- 包含清晰的變更說明（做了什麼、為什麼）
- 關聯相關 Issue
- 確保 CI 透過後再請求 Review
