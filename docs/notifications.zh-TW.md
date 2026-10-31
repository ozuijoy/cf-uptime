# 通知系統

[English](notifications.md) | 中文

CF Uptime 的通知系統在監控狀態變化或事件建立/更新時傳送 Webhook 通知。本文件涵蓋事件型別、渠道配置、Payload 構建、模板變數、Webhook 簽名與故障排除。

## 概覽

通知系統的核心能力：

- 在關鍵狀態變化（UP->DOWN、DOWN->UP）和事件生命週期事件時傳送通知
- 每個渠道獨立配置：HTTP 方法、超時、Headers、Payload 格式、模板、事件過濾、可選簽名
- 冪等投遞保證：每個事件對每個渠道最多傳送一次（透過 `notification_deliveries` 唯一約束實現）

### 核心流程

1. 系統產生事件（eventType + eventKey + payload）
2. 查詢所有活躍的 Webhook 渠道
3. 對每個渠道：
   - 按 `enabled_events` 過濾
   - 在 `notification_deliveries` 中佔位（冪等 claim）
   - 渲染模板（message、payload、headers）
   - 根據 `payload_type` 構建 URL/body
   - 透過 `fetch` 傳送（no-store + timeout）
   - 記錄投遞結果（success/failed）

## 事件型別

| 事件                  | 說明                             |
| --------------------- | -------------------------------- |
| `monitor.down`        | 監控項轉為 DOWN 狀態             |
| `monitor.up`          | 監控項轉為 UP 狀態               |
| `incident.created`    | 新事件建立                       |
| `incident.updated`    | 事件收到更新                     |
| `incident.resolved`   | 事件被標記為已解決               |
| `maintenance.started` | 維護視窗開始                     |
| `maintenance.ended`   | 維護視窗結束                     |
| `test.ping`           | 測試按鈕（即使被過濾也始終允許） |

## 事件鍵（冪等）

每個事件都有唯一的 `event_key` 用於去重：

- 監控：`monitor:<monitorId>:down|up:<timestamp>`
- 事件：`incident:<incidentId>:created|resolved:<...>` 或 `incident:<incidentId>:update:<updateId>`
- 測試：`test:webhook:<channelId>:<now>`

> 如果在同一秒內連續點選測試按鈕，第二次請求可能被去重跳過。等待 1 秒後重試即可。

## 管理端 API

| 方法   | 端點                                           | 說明         |
| ------ | ---------------------------------------------- | ------------ |
| GET    | `/api/v1/admin/notification-channels`          | 列出所有渠道 |
| POST   | `/api/v1/admin/notification-channels`          | 建立渠道     |
| PATCH  | `/api/v1/admin/notification-channels/:id`      | 更新渠道     |
| DELETE | `/api/v1/admin/notification-channels/:id`      | 刪除渠道     |
| POST   | `/api/v1/admin/notification-channels/:id/test` | 傳送測試通知 |

測試端點會生成一個 `test.ping` 事件（帶示例資料）並返回投遞記錄，用於除錯。

## 渠道配置

Webhook 渠道的 `config_json` 欄位（由 Zod 校驗）：

| 欄位               | 必填 | 預設值 | 說明                                                                   |
| ------------------ | ---- | ------ | ---------------------------------------------------------------------- |
| `url`              | 是   | —      | Webhook URL（僅允許 `http://` 或 `https://`）                          |
| `method`           | 否   | `POST` | HTTP 方法：`GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`             |
| `headers`          | 否   | —      | 自定義 Headers 物件 `{ "Header-Name": "value" }`。Value 支援模板渲染。 |
| `timeout_ms`       | 否   | —      | 請求超時（1–60000 ms）                                                 |
| `payload_type`     | 否   | `json` | `json`、`param` 或 `x-www-form-urlencoded`                             |
| `message_template` | 否   | —      | `message` 變數的模板                                                   |
| `payload_template` | 否   | —      | 自定義 Payload 模板（詳見下文）                                        |
| `enabled_events`   | 否   | —      | 事件白名單陣列。空 = 全部事件。`test.ping` 始終透過。                  |
| `signing`          | 否   | —      | `{ enabled: boolean, secret_ref: string }` — HMAC-SHA256 簽名          |

## Payload 模式

### 模式 1：預設 JSON（無模板）

當 `payload_type = json` 且未設定 `payload_template` 時，CF Uptime 傳送完整的系統 Payload：

```json
{
  "event": "monitor.down",
  "event_id": "monitor:1:down:1700000000",
  "timestamp": 1700000000,
  "monitor": { "id": 1, "name": "..." },
  "state": { "status": "down", "http_status": 500 }
}
```

所有欄位完整，數字型別保持不變。

### 模式 2：自定義模板

設定了 `payload_template` 時，渲染後的模板即為最終 Payload。系統欄位 **不會** 自動注入 — 需在模板中顯式引用：

```json
{
  "event": "{{event}}",
  "event_id": "{{event_id}}",
  "text": "{{message}}",
  "monitor_name": "{{monitor.name}}"
}
```

### 模式 3：最小扁平 Payload（非 JSON 無模板）

當 `payload_type` 為 `param` 或 `x-www-form-urlencoded` 且未設定模板時：

```
event, event_id, timestamp, message
```

## 模板系統

模板可用於 `message_template`、`payload_template` 中的所有字串欄位、以及 `headers` 中的所有 value。

### 語法

- `{{path.to.field}}` — 點號路徑取值
- `{{checks[0].latency_ms}}` — 陣列下標訪問
- `$MSG` — 渲染後 `message` 的別名

### 內建變數

| 變數              | 型別   | 說明                                                 |
| ----------------- | ------ | ---------------------------------------------------- |
| `event`           | string | 事件型別                                             |
| `event_id`        | string | 冪等鍵                                               |
| `timestamp`       | number | Unix 秒                                              |
| `channel.id`      | number | 渠道 ID                                              |
| `channel.name`    | string | 渠道名稱                                             |
| `monitor.*`       | object | 監控項欄位（如適用）                                 |
| `state.*`         | object | 監控狀態欄位（如適用）                               |
| `default_message` | string | 系統生成的預設訊息                                   |
| `message`         | string | 最終訊息（若設定了 `message_template` 則為渲染結果） |

> 系統原始 Payload 會展開到頂層變數。如果 Payload 包含 `monitor`，可直接使用 `{{monitor.name}}`。

### 缺失欄位

路徑不存在時，模板解析為空字串。

### 安全限制

模板路徑拒絕訪問 `__proto__`、`prototype` 和 `constructor`，防止原型鏈汙染。

### 型別說明

模板替換本質是字串替換。`"id": "{{monitor.id}}"` 最終變為 `"id": "12"`（字串），而非數字 `12`。如果需要數字型別，請使用預設 Payload（不設定模板）或在接收端做型別轉換。

## Payload Type 詳解

### `json`

- Body：`JSON.stringify(payload)`
- 預設 Header：`Content-Type: application/json`（為相容性不附加 `charset=utf-8`）
- 如在 `headers` 中手動設定了 `Content-Type`，則不會被覆蓋

### `param`

- Payload（必須是扁平物件）轉換為查詢引數拼接到 URL 上
- 不傳送請求 body

### `x-www-form-urlencoded`

- POST/PUT/PATCH/DELETE：body 為 `URLSearchParams`，Header `Content-Type: application/x-www-form-urlencoded`
- GET/HEAD：退化為查詢引數（無 body）

## Webhook 簽名

當 `signing.enabled = true` 時，CF Uptime 在每個請求中附加兩個 Header：

```
X-Uptimer-Timestamp: <unix_seconds>
X-Uptimer-Signature: sha256=<hmac_hex>
```

**簽名計算**：

- `message = "<timestamp>.<rawBody>"`
- `hmac = HMAC-SHA256(secret, message)` 的十六進位制值

Secret 從 Worker 環境變數中讀取（由 `secret_ref` 指定），永遠不會存入資料庫。

### 驗證示例（Node.js）

```js
import crypto from 'node:crypto';

function verify(req, secret) {
  const ts = req.headers['x-uptimer-timestamp'];
  const sig = req.headers['x-uptimer-signature']; // "sha256=..."
  const rawBody = req.rawBody ?? '';
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return sig === `sha256=${expected}`;
}
```

## 配置示例

### 透過 Apprise 推送到 Discord / Slack / ntfy

```json
{
  "url": "https://your-apprise-endpoint/notify",
  "method": "POST",
  "payload_type": "json",
  "message_template": "[{{event}}] {{monitor.name}} => {{state.status}}\n$MSG",
  "payload_template": {
    "urls": "ntfys://your-ntfy-topic",
    "body": "{{message}}"
  }
}
```

### 查詢引數 Webhook (GET)

```json
{
  "url": "https://example.com/webhook",
  "method": "GET",
  "payload_type": "param",
  "payload_template": {
    "event": "{{event}}",
    "monitor": "{{monitor.name}}",
    "msg": "{{message}}"
  }
}
```

### 表單編碼 Webhook (POST)

```json
{
  "url": "https://example.com/webhook",
  "method": "POST",
  "payload_type": "x-www-form-urlencoded",
  "payload_template": {
    "event": "{{event}}",
    "msg": "{{message}}"
  }
}
```

## 故障排除

### 檢查測試 API 返回

使用管理後台的測試按鈕或直接呼叫 API：

```
POST /api/v1/admin/notification-channels/:id/test
```

返回內容包含：

- `delivery.status` — `success` 或 `failed`
- `delivery.http_status` — HTTP 狀態碼（網路錯誤時可能為 null）
- `delivery.error` — 錯誤描述

**常見錯誤**：

- `HTTP 400/415`：接收端拒絕 Content-Type 或 body 結構
- `Timeout after XXXXms`：接收端響應慢或不可達
- `Signing secret not configured: XXX`：開啟了簽名但未配置對應 Secret

### 常見"配置看起來對但不工作"的原因

| 症狀                 | 原因                                                             |
| -------------------- | ---------------------------------------------------------------- |
| 接收端收到錯誤欄位   | `payload_template` 中的欄位名與接收端期望的不匹配                |
| Content-Type 被拒絕  | 某些接收端要求精確的 `application/json` — 非必要不要覆蓋 headers |
| 真實事件未投遞       | `enabled_events` 白名單生效，但未包含該事件型別                  |
| 渠道顯示活躍但無投遞 | 渠道的 `is_active = false`                                       |
| 重複點選無響應       | 冪等去重 — 同一 `event_key` 在 1 秒內被跳過                      |

### 查詢投遞記錄

在本地 D1 中檢視最近的投遞記錄：

```bash
wrangler d1 execute cf-uptime --local \
  --command="SELECT * FROM notification_deliveries ORDER BY created_at DESC LIMIT 20;"
```

## 已知限制

- 目前僅支援 Webhook 渠道（無內建 Email、Telegram 等）
- 模板替換始終產生字串（詳見上方「型別說明」）
- `payload_template` 的 JSON 深度上限為 32 層

## 原始碼參考

| 元件         | 檔案                                 |
| ------------ | ------------------------------------ |
| Webhook 派發 | `apps/worker/src/notify/webhook.ts`  |
| 冪等去重     | `apps/worker/src/notify/dedupe.ts`   |
| 模板引擎     | `apps/worker/src/notify/template.ts` |
| 配置 Schema  | `packages/db/src/json.ts`            |
| 測試端點     | `apps/worker/src/routes/admin.ts`    |
