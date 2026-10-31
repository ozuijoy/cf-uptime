# Observability.md：CF Uptime 可觀測性與安全使用（Workers CPU 最佳化用）

本專案在 Cloudflare 平台上做效能最佳化時，**唯一**可信的最終指標是線上 Cloudflare Workers Metrics 裡的 **CPU Time（尤其 P50/P90）**。但 Metrics 顆粒度很粗，因此需要一套“能定位到鏈路/函式段”的最小可觀測性組合，既能除錯，又不會把“可觀測性本身”變成效能稅。

本文總結當前倉庫內已落地的可觀測效能力與使用方法（不涉及新的架構方案）。

---

## 0. 安全邊界

本文只記錄 header 名、環境變數名、命令模板與排查流程，**不能**記錄任何真實 token、secret、Cloudflare account id、database id、管理員口令或私有域名。

生產環境與任何公網可訪問環境必須為 Trace 配置 token gate：

- 首選 `UPTIMER_TRACE_TOKEN`
- 相容備用 `TRACE_TOKEN`

沒有 token gate 的匿名 Trace 只能用於本地或受訪問控制保護的臨時環境。`X-Uptimer-Trace-Mode: bypass-cache` 會改變快取路徑，只能用於診斷，不能作為普通使用者路徑或釋出效能結論的唯一依據。

輸出處理規則：

- 不要把 `X-Uptimer-Trace-Token` 寫進公開文件、Issue、PR、聊天記錄或測試 fixture。
- `wrangler tail` 與 Trace 響應可能包含請求 URL、query、header、錯誤資訊和內部路徑標籤；分享前必須脫敏。
- 需要儲存原始 tail/trace 輸出時，放入 gitignored 的 `tmp/` 或其他本地臨時目錄，不要提交。
- 示例命令只能使用佔位符，例如 `<your-worker-origin>`、`<your-pages-origin>`、`<token>`。

---

## 1. 訊號層級（按可信度/成本排序）

### 1.1 Cloudflare Workers Metrics（最終裁判）

- 指標：CPU time 的 P50/P90/P99 等分位
- 特點：真實線上、覆蓋所有請求；但**無法按 route/函式**拆分
- 結論：任何本地 bench / 程式碼推理 / “看起來更快”，都必須讓位於 Metrics

### 1.2 `wrangler tail`（按“單次 invocation”觀測 CPU）

用途：當 Metrics 告訴你“變慢了”，`wrangler tail` 可以告訴你**是哪些請求**在燒 CPU，並且能看到每次 invocation 的 `cpuTime`。

前置條件：

- 需要能訪問對應 Cloudflare 賬號的 Workers Tail（本地一般用 `wrangler login`；在 CI/無瀏覽器環境用 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`）
- Worker 名稱以 `apps/worker/wrangler.toml` 的 `name` 為準（本倉庫預設是 `cf-uptime`；Dev/多環境可能不同）
- 若 tail 輸出用於 issue/PR/release 證據，只記錄聚合結果、取樣引數與結論；不要貼原始 JSON。

常用命令（按需調 sampling）：

```bash
pnpm --filter @cf-uptime/worker exec wrangler tail cf-uptime --format json --sampling-rate 0.2
```

過濾（減少噪聲）：

```bash
# 只看 POST
pnpm --filter @cf-uptime/worker exec wrangler tail cf-uptime --format json --sampling-rate 0.8 --method POST

# 只看 GET
pnpm --filter @cf-uptime/worker exec wrangler tail cf-uptime --format json --sampling-rate 0.5 --method GET

# 只看 ok/error/canceled（canceled 常見於 waitUntil / 內部自呼叫鏈路）
pnpm --filter @cf-uptime/worker exec wrangler tail cf-uptime --format json --sampling-rate 0.8 --status ok --status error --status canceled
```

解讀要點：

- `cpuTime`：本次 invocation 的 CPU（ms）
- `event.request.url`：請求 URL（可定位到 `/api/v1/public/*`、`/api/v1/internal/*` 等）
- `outcome=canceled`：並不一定代表錯誤；在 `ctx.waitUntil()`、內部自呼叫等鏈路中較常見，但 **CPU 依然真實計入**（重點看 `cpuTime` 分佈）
- sample rate 會影響證據強度；釋出證明優先使用完整取樣或明確說明取樣率與樣本數。

### 1.3 端到端 Trace（Server-Timing + 輕量標籤）

用途：當你知道“是某條鏈路”在燒 CPU，但不知道到底是**讀 snapshot / D1 查詢 / JSON 處理 / fallback 協調**哪段慢時，開啟 Trace 能把一次請求拆成多個 span。

目標：**預設關閉**、按需開啟、必須可用 token 保護，避免使用者流量被動開啟導致效能稅或資訊洩露。

---

## 2. 當前已實現的 Trace 協議

### 2.1 Header 協議（請求端）

所有 trace 都基於這組 header（Workers 與 Pages Worker 一致；`single_worker` 模式僅有 Worker 層）：

- `X-Uptimer-Trace: 1|true|yes|on`：開啟 trace（預設關閉）
- `X-Uptimer-Trace-Id: <id>`：可選；用於跨層關聯（不傳會自動生成 UUID）
- `X-Uptimer-Trace-Token: <token>`：可選；若環境變數設定了 token，則必須匹配才啟用
- `X-Uptimer-Trace-Mode: <mode>`：可選；Worker 熱路徑與 Pages Worker 均支援 `bypass-cache`

注意：

- 共享排查命令時不要包含真實 `X-Uptimer-Trace-Token`。
- `X-Uptimer-Trace-Id` 用於關聯請求，不應包含使用者身份、郵箱、真實域名或其他可識別資訊。

Token 的環境變數（兩處都支援）：

- `UPTIMER_TRACE_TOKEN`（推薦）
- `TRACE_TOKEN`（相容備用）

### 2.2 Header 協議（響應端）

開啟後，響應會包含：

- `X-Uptimer-Trace-Id`：本次 trace id
- `X-Uptimer-Trace`：輕量標籤（`key=value;key=value`），用於快速看“路徑/命中/age”等
- `Server-Timing`：span 列表，瀏覽器 DevTools 或 `curl -I` 可直接讀

span 字首約定：

- Worker API（TS Worker）：通常以 `w_` 字首輸出（由呼叫方傳入 prefix）
- Pages Worker（`apps/web/public/_worker.js`，僅 `pages` 模式）：以 `p_` 表示頁面層 span，並把 API 的 `Server-Timing` 重新命名為 `api_*` 合並進來，方便端到端閱讀
- span 名和標籤只應表達執行路徑、cache 命中、age、payload 形態等低敏資訊；不要寫入 token、header 原文、完整目標 URL 或使用者輸入。

---

## 3. Worker（API）側的 Trace 實現位置

- Trace 實現：`apps/worker/src/observability/trace.ts`
- 熱路徑啟用點（避免全量路由引入額外 CPU）：
  - `apps/worker/src/fetch-handler.ts`：對 `/api/v1/public/homepage`、`/api/v1/public/homepage-artifact`、`/api/v1/public/status` 走“public hot path”並支援 trace
  - `apps/worker/src/routes/public.ts`：部分路徑也有 Trace（歷史實現）

使用示例：

```bash
# 看 public/homepage 的 span + 標籤
curl -sS -D - -o /dev/null \
  -H 'X-Uptimer-Trace: 1' \
  -H 'X-Uptimer-Trace-Token: <token>' \
  -H 'X-Uptimer-Trace-Mode: bypass-cache' \
  'https://<your-worker-origin>/api/v1/public/homepage'
```

你會看到類似：

- `Server-Timing: w_homepage_snapshot_read;dur=... , w_total;dur=...`
- `X-Uptimer-Trace: route=public/homepage;path=snapshot;age=...`

---

## 4. Pages Worker（HTML 注入層）的 Trace 實現位置

- Pages Worker：`apps/web/public/_worker.js`（預設 `pages` 部署模式）
- 行為：
  - 當 HTML 導航請求攜帶 `X-Uptimer-Trace`（且 token 校驗透過）時：
    - Pages Worker 會在自身邏輯中記錄 `p_*` span（cache 命中、index fetch、API fetch、注入等）
    - 同時把同一組 trace header 轉發到 API（用於拿到 API 的 `Server-Timing` + `X-Uptimer-Trace`）
    - 最終把 API 的 timing 合併成 `api_*` 輸出到頁面響應
  - `X-Uptimer-Trace-Mode: bypass-cache`：
    - Pages Worker 會跳過 `caches.default.match` 與 `caches.default.put`
    - 適合定位“真實注入成本”，避免快取把問題掩蓋

使用示例（直接觀測 HTML 注入鏈路）：

```bash
curl -sS -D - -o /dev/null \
  -H 'Accept: text/html' \
  -H 'X-Uptimer-Trace: 1' \
  -H 'X-Uptimer-Trace-Token: <token>' \
  -H 'X-Uptimer-Trace-Mode: bypass-cache' \
  'https://<your-pages-origin>/'
```

> **部署模式說明**：
>
> - 預設 `pages` 模式下，首屏 HTML 預注入由 Pages Worker 完成；端到端 trace 會同時輸出 `p_*` 與 `api_*` span。
> - 可選 `single_worker` 模式下，SPA 靜態資源直接由 Worker `[assets]` 提供，沒有 Pages Worker 中間代理層（不經過 `_worker.js`，首屏由 SPA 執行時拉取 `/api/v1/public/homepage`），端到端排查直接觀測 Worker 的 `w_*` span。

---

## 5. 推薦的效能排查流程（CPU 最佳化專用）

1. **先看 Metrics**：確認分位數是否真的迴歸/改善（以 P50/P90 為主）
2. **用 `wrangler tail` 找鏈路**：確定哪個 URL/方法的 `cpuTime` 在高分位貢獻最大
3. **對該鏈路開 Trace**：用 `Server-Timing` 拆解 span，明確慢在“讀/算/寫/協調”的哪一段
4. **只在 Dev 環境做放大實驗**：
   - 增加更細的 span（但要保證預設關閉 + token 保護）
   - 用 `bypass-cache` 排除快取影響
   - 原始 tail/trace 輸出儲存到 gitignored 臨時目錄，彙報時只貼脫敏後的聚合摘要
5. **最終回到 Metrics 驗證**：任何本地解釋都不能替代線上分位數變化

---

## 6. 常見誤區（已踩坑總結）

- **把 Pages Worker 當作“免費搬運層”**：Pages Worker 的 CPU 也計入指標，熱路徑邏輯會直接推高 P50/P90
- **在熱路徑裡做“順手回寫/協調”**：即使“順手”，也可能成為效能稅
- **bench 變快 ≠ Metrics 變快**：在 Cloudflare 的真實鏈路中，協調/解析/比較的 CPU 往往比“純計算”更貴
- **Trace 預設開**：會造成效能稅與潛在資訊洩露；必須預設關閉、可 token gate、只在必要路徑啟用
