# API-Reference.md: CF Uptime (Cloudflare Runtime + D1 + HTTP Calls)

目的：把 CF Uptime 可能用到的「平台執行時 API / 資料庫 API / 出站 HTTP/TCP 呼叫 / 內部 HTTP API」集中整理成一份可查閱的參考。

來源說明：

- “提煉”部分來自既有 Cloudflare Workers、D1、TCP sockets 等實踐用法（僅提煉 API 用法，不借鑑外部架構/業務實現）。
- “補全”部分基於 Cloudflare 官方文件（見本文末尾 References）。

---

## Contents

- 1. Cloudflare Workers：入口與上下文
- 2. fetch：出站 HTTP 呼叫（監控 + webhook + 工具請求）
- 3. TCP sockets：`cloudflare:sockets`（TCP 埠探測）
- 4. D1：Workers Binding API（SQLite 語義）
- 5. Durable Objects（可選，用於未來多地域探測）
- 6. Web Crypto：Webhook 簽名（HMAC-SHA256，可選）
- 7. Workers Cache API：`caches.default`（可選，用於公共介面加速）
- 8. CF Uptime 內部 HTTP API（供前端呼叫；摘要）
- 9. Hono（Worker 路由框架）
- 10. Drizzle ORM（D1/SQLite driver）

---

## 1) Cloudflare Workers：入口與上下文

### 1.1 Module Worker 入口

```ts
export interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
  // 其他 bindings / secrets...
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response('ok');
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // controller.cron: string (cron 表示式)
  },
} satisfies ExportedHandler<Env>;
```

相關點：

- `scheduled()` 用於 Cron Triggers（wrangler/Dashboard 配置）。
- `ExecutionContext.waitUntil()` 用於把非同步任務延長到 handler 結束之後繼續執行（不阻塞響應）。

### 1.2 ctx.waitUntil（後台任務）

典型用途：

- 傳送 webhook 通知
- 寫快取（`caches.default.put`）
- 記錄非同步日誌/統計（例如寫入 Analytics Engine，若未來啟用）

```ts
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(doSomethingAsync());
    return new Response('ok');
  },
};
```

References：

- Workers Context API（`ctx.waitUntil`）：https://developers.cloudflare.com/workers/runtime-apis/context/

### 1.3 Cron Triggers（wrangler 配置）

```toml
[triggers]
crons = ["* * * * *"] # 每分鐘
```

注意：

- Cron 以 UTC 解釋，觸發可能存在抖動；CF Uptime 需要按 `interval_sec` 做“到期探測”，而不是假設每分鐘全量掃一遍。

### 1.4 Incoming Request CF 資訊（僅 fetch handler 可用）

在 `fetch()` 中可以讀取 Cloudflare 注入的請求上下文（如 colo / country / tls 等）。`scheduled()` 沒有 inbound request，無法使用該能力。

```ts
export default {
  async fetch(request: Request) {
    // @ts-expect-error: request.cf is Workers-specific.
    const colo = request.cf?.colo;
    // @ts-expect-error: request.cf is Workers-specific.
    const country = request.cf?.country;
    return Response.json({ colo, country });
  },
};
```

### 1.5 併發限制（p-limit，用於批次探測）

基於 Workers 實踐：Workers 存在出站連線併發限制，批次探測時建議限制併發數（例如 5）。

```ts
import pLimit from 'p-limit';

const limit = pLimit(5);
const results = await Promise.all(monitors.map((m) => limit(() => runCheck(m))));
```

---

## 2) fetch：出站 HTTP 呼叫（監控 + webhook + 工具請求）

### 2.1 禁用快取（監控請求必須做）

Workers 對 `fetch` 支援 `cache: 'no-store' | 'no-cache'`（僅支援這兩種）。

推薦（用於監控目標請求）：

```ts
const res = await fetch(url, {
  method: 'GET',
  cache: 'no-store',
  cf: {
    // 對所有狀態碼禁用快取
    cacheTtlByStatus: { '100-599': -1 },
  },
});
```

References：

- fetch cache directives（no-store / no-cache）：https://developers.cloudflare.com/workers/examples/cache-using-fetch/
- fetch cf cache 示例（含 cacheTtlByStatus 結構示例）：https://developers.cloudflare.com/workers/examples/cache-using-fetch/

### 2.2 AbortController 超時封裝

```ts
export function fetchTimeout(
  url: string,
  ms: number,
  init: RequestInit<RequestInitCfProperties> = {},
): Promise<Response> {
  const controller = new AbortController();

  // 若呼叫方也傳入 signal，轉發 abort
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }

  const t = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(t));
}
```

實踐建議：

- 監控請求預設 10s；webhook 預設 5s（可配置）。
- 對於需要讀取 body 的斷言場景，儘量在完成斷言後呼叫 `response.body?.cancel()`，避免長連線佔用。

### 2.3 解析 Cloudflare 執行位置（colo）

實踐用法：請求 `https://cloudflare.com/cdn-cgi/trace`，解析 `colo=...`。

```ts
export async function getWorkerColo(): Promise<string | null> {
  const res = await fetch('https://cloudflare.com/cdn-cgi/trace', { cache: 'no-store' });
  const text = await res.text();
  return /^colo=(.*)$/m.exec(text)?.[1] ?? null;
}
```

說明：

- `scheduled()` 沒有 inbound request，因此無法使用 `request.cf.colo`，用 trace 是一種可行手段。

### 2.4 Webhook 傳送（JSON / form / query param）

JSON：

```ts
const headers = new Headers({
  'Content-Type': 'application/json',
  'User-Agent': 'CF Uptime/0.1',
});
headers.set('Authorization', 'Bearer <token>'); // 可選

const resp = await fetchTimeout(webhookUrl, 5000, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload),
});
```

`application/x-www-form-urlencoded`：

```ts
const resp = await fetchTimeout(webhookUrl, 5000, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ a: '1', b: '2' }).toString(),
});
```

Query param（通常用於 GET webhook）：

```ts
const u = new URL(webhookUrl);
u.searchParams.set('msg', 'hello');
const resp = await fetchTimeout(u.toString(), 5000, { method: 'GET' });
```

### 2.5 Response headers（CORS / no-store）

基於 Edge API 實踐：公開資料介面通常加 CORS；狀態類介面/徽章類介面通常顯式禁止快取。

```ts
const headers = new Headers({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
});

return new Response(JSON.stringify({ ok: true }), { headers });
```

---

## 3) TCP sockets：`cloudflare:sockets`（TCP 埠探測）

### 3.1 連線與關閉（官方 API）

```ts
import { connect } from 'cloudflare:sockets';

const socket = connect({ hostname: 'example.com', port: 443 });
const writer = socket.writable.getWriter();
await writer.write(new TextEncoder().encode('...'));
await writer.close();
socket.close();
```

References：

- TCP sockets API：https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/

### 3.1.1 提煉：為相容某些打包器的動態 import 寫法

當你的構建鏈對 `cloudflare:sockets` 產生打包/解析問題時，可以用動態 import：

```ts
const connect = await import('cloudflare:sockets').then((m) => m.connect);
const socket = connect({ hostname: 'example.com', port: 443 });
```

### 3.2 用作 TCP health-check（握手延遲）

Workers TCP Socket `Socket` 提供（文件描述）：

- 一個“連線建立後 resolve”的 Promise（通常命名為 `socket.opened`）
- 一個“連線關閉後 resolve”的 Promise（通常命名為 `socket.closed`）
- `socket.close()` 強制關閉讀寫兩端

建議實現（僅握手 + 立即關閉）：

```ts
import { connect } from 'cloudflare:sockets';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => t && clearTimeout(t));
}

export async function tcpPing(hostname: string, port: number, timeoutMs: number): Promise<number> {
  const start = Date.now();
  const socket = connect({ hostname, port });
  // @ts-expect-error: Workers runtime Socket has opened/closed promises.
  await withTimeout(socket.opened, timeoutMs);
  socket.close();
  return Date.now() - start;
}
```

注意：

- TCP 探測屬於“受控 SSRF/埠探測能力”，必須做目標校驗與速率控制（見 `Application.md` 安全章節）。

---

## 4) D1：Workers Binding API（SQLite 語義）

### 4.1 wrangler 繫結（示例）

```toml
[[d1_databases]]
binding = "DB"
database_name = "cf-uptime"
database_id = "<uuid>"
```

References：

- Wrangler 配置 D1 bindings：https://developers.cloudflare.com/workers/wrangler/configuration/

### 4.2 Prepared Statement：prepare / bind / run / first / raw

```ts
// 1) run(): 返回 D1Result（含 meta + results）
const r1 = await env.DB.prepare('SELECT * FROM monitors WHERE id = ?')
  .bind(123)
  .run<{ id: number; name: string }>();

// 2) first(): 返回首行物件或 null（無 meta）
const row = await env.DB.prepare('SELECT * FROM monitors WHERE id = ?')
  .bind(123)
  .first<{ id: number; name: string }>();

// 3) raw(): 返回二維陣列（可選 columnNames）
const raw = await env.DB.prepare('SELECT id, name FROM monitors ORDER BY id DESC LIMIT 10').raw({
  columnNames: true,
});
```

要點：

- `run()` 與 `all()` 在 D1 中等價（文件說明 run 可視為 all 的別名）；寫操作時 `results` 為空，變化資訊在 `meta.changes/last_row_id`。
- 引數化繫結遵循 SQLite：`?`、`?1`、`?2` 等（避免 SQL 注入）。
- 如果你手上是一個引數陣列，使用 `.bind(...params)`（不要把陣列當成單個引數傳入）。

補充：`all()`（等價於 `run()`）

```ts
const r = await env.DB.prepare('SELECT * FROM monitors').all();
```

補充：`first(columnName)`（只取首行某列的值）

```ts
const lastId = await env.DB.prepare('SELECT MAX(id) AS id FROM monitors').first<number>('id');
```

References：

- Prepared statements（bind/run/first/raw）：https://developers.cloudflare.com/d1/worker-api/prepared-statements/

### 4.3 D1Database.batch（多語句批次執行）

```ts
const stmts = [
  env.DB.prepare(
    'INSERT INTO check_results (monitor_id, checked_at, status) VALUES (?, ?, ?)',
  ).bind(monitorId, checkedAt, status),
  env.DB.prepare(
    'UPDATE monitor_state SET status = ?, last_checked_at = ? WHERE monitor_id = ?',
  ).bind(status, checkedAt, monitorId),
];

const results = await env.DB.batch(stmts);
// results: D1Result[]，每條語句一個結果（含 meta）
```

References：

- D1 Database batch/exec 教程示例：https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1

### 4.4 D1Database.exec（執行原始 SQL 字串）

```ts
await env.DB.exec('PRAGMA foreign_keys = ON;');
```

注意：

- `exec()` 不支援 bind 引數；僅用於受控 SQL（例如維護/除錯/固定語句），不要用於拼接使用者輸入。

References：

- D1 exec 示例：https://developers.cloudflare.com/d1/worker-api/return-object

### 4.5 提煉：“D1 當 KV 用” 寫法（示例）

一種早期輕量寫法是在 D1 內建一個 `kv_store(key, value)` 表，透過 UPSERT 存/取一個大 JSON 狀態 blob：

```ts
// get
const row = await env.DB.prepare('SELECT value FROM kv_store WHERE key = ?')
  .bind('state')
  .first<{ value: string }>();

// set (UPSERT)
await env.DB.prepare(
  'INSERT INTO kv_store (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value;',
)
  .bind('state', stateJson)
  .run();
```

說明：

- CF Uptime v0.x 採用“關係表 + retention”，不建議把所有狀態壓成單 blob；但上述示例對理解 D1 prepare/bind/run 很直觀。

### 4.6 D1 分散式鎖（lease lock，用於 scheduled 防重疊）

CF Uptime v0.x 推薦用 D1 `locks(name, expires_at)` 實現一個簡單 lease：

獲取鎖（僅當不存在或已過期時覆蓋）：

```ts
const now = Math.floor(Date.now() / 1000);
const ttl = 55;
const expiresAt = now + ttl;

const sql =
  'INSERT INTO locks (name, expires_at) VALUES (?, ?) ' +
  'ON CONFLICT(name) DO UPDATE SET expires_at = excluded.expires_at ' +
  'WHERE locks.expires_at <= ?;';

const r = await env.DB.prepare(sql).bind('scheduler', expiresAt, now).run();
const acquired = (r.meta?.changes ?? 0) > 0;
```

釋放鎖（可選；通常讓其自然過期即可）：

```ts
await env.DB.prepare('DELETE FROM locks WHERE name = ?').bind('scheduler').run();
```

### 4.7 Public snapshot fast path tables

當前釋出基線使用 D1 靜態快照 + fragments 支撐 Free Plan CPU profile：

```sql
CREATE TABLE IF NOT EXISTS public_snapshots (
  key TEXT PRIMARY KEY,
  generated_at INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

CREATE TABLE IF NOT EXISTS public_snapshot_guard_versions (
  key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  state_json TEXT
);

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

Key conventions:

- `public_snapshots.key`: `homepage` / `status` / `homepage:artifact`。
- `public_snapshot_fragments.snapshot_key`: `homepage:envelope`、`homepage:monitors`、`status:envelope`、`status:monitors`、`homepage:artifact:monitors`、`monitor-runtime:updates`。
- artifact rows use `updated_at` for public freshness, while the body/snapshot still validates against stored `generated_at`。

### 4.8 Retention 清理（刪除過期 check_results）

```ts
const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
await env.DB.prepare('DELETE FROM check_results WHERE checked_at < ?').bind(cutoff).run();
```

---

## 5) Durable Objects（可選，用於未來多地域探測）

一種可選方案是使用 DO 做“指定 locationHint 的遠端探測”，核心 API 點：

```ts
import { DurableObject } from 'cloudflare:workers';

export interface Env {
  REMOTE_CHECKER_DO: DurableObjectNamespace<RemoteChecker>;
}

export class RemoteChecker extends DurableObject {
  async getLocationAndStatus(payload: unknown) {
    // ... run check ...
    return { location: 'HKG', status: { up: true, ping: 12, err: '' } };
  }
}
```

呼叫側示例：

```ts
const id = env.REMOTE_CHECKER_DO.idFromName(monitorId);
const stub = env.REMOTE_CHECKER_DO.get(id, { locationHint: 'hkg' as DurableObjectLocationHint });
const resp = await stub.getLocationAndStatus(monitorConfig);
```

注意：

- DO 屬於 v1+ 擴充套件點；v0.1 不引入（避免複雜度）。
- 具體需要的 compatibility flags / RPC 形態以 Cloudflare DO 文件為準。

---

## 6) Web Crypto：Webhook 簽名（HMAC-SHA256，可選）

用於讓 webhook 接收方驗證來源、防重放。

```ts
function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(sig);
}
```

用法建議：

- 傳送：
  - `X-Uptimer-Timestamp: <unix seconds>`
  - `X-Uptimer-Signature: sha256=<hex>`
  - `signature = HMAC(secret, timestamp + "." + rawBody)`
- 接收方校驗 timestamp 在允許視窗內（例如 5 分鐘），並校驗簽名。

---

## 7) Workers Cache API：`caches.default`（可選，用於公共介面加速）

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    const res = new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
    });

    ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  },
};
```

注意：

- 監控目標探測請求必須禁快取（見 2.1），Cache API 僅用於你自己的公共 API/狀態頁資料快取。

References：

- cache-using-fetch（含 caches.default.put 示例）：https://developers.cloudflare.com/workers/examples/cache-using-fetch/

---

## 8) CF Uptime 內部 HTTP API（供前端呼叫；摘要）

詳細定義以 `Application.md` 為準，這裡僅列出“會被呼叫”的 endpoints：

Public（無需鑑權）：

- `GET /api/v1/public/homepage`
- `GET /api/v1/public/homepage-artifact`
- `GET /api/v1/public/status`
- `GET /api/v1/public/monitors/:id/latency?range=24h`
- `GET /api/v1/public/monitors/:id/uptime?range=24h|7d|30d`
- `GET /api/v1/public/incidents?limit=20`
- `GET /api/v1/public/maintenance-windows?limit=20`

Admin（Bearer Token）：

- `GET /api/v1/admin/monitors`
- `POST /api/v1/admin/monitors`
- `PATCH /api/v1/admin/monitors/:id`
- `DELETE /api/v1/admin/monitors/:id`
- `POST /api/v1/admin/monitors/:id/test`
- `GET /api/v1/admin/notification-channels`
- `POST /api/v1/admin/notification-channels`
- `PATCH /api/v1/admin/notification-channels/:id`
- `DELETE /api/v1/admin/notification-channels/:id`
- `POST /api/v1/admin/notification-channels/:id/test`
- `GET /api/v1/admin/incidents`
- `POST /api/v1/admin/incidents`
- `POST /api/v1/admin/incidents/:id/updates`
- `PATCH /api/v1/admin/incidents/:id/resolve`

Internal（Bearer Token；scheduled/service-binding only）：

- `POST /api/v1/internal/scheduled/check-batch`
- `POST /api/v1/internal/write/runtime-update-fragments`
- `POST /api/v1/internal/refresh/runtime-fragments`
- `POST /api/v1/internal/seed/sharded-public-snapshot`
- `POST /api/v1/internal/assemble/sharded-public-snapshot`
- `POST /api/v1/internal/continue/sharded-public-snapshot`

Free Plan CPU profile vars are documented in `Develop/Worker-CPU-10ms-Release-Readiness.md` and enabled in `apps/worker/wrangler.toml`. Do **not** enable `UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED` for the release profile.

---

## 9) Hono（Worker 路由框架）

基礎：

```ts
import { Hono } from 'hono';

type Bindings = { DB: D1Database; ADMIN_TOKEN: string };
const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/v1/public/status', (c) => c.json({ ok: true }));

export default app;
```

讀取 JSON Body：

```ts
app.post('/api/v1/admin/monitors', async (c) => {
  const body = await c.req.json();
  return c.json({ received: body });
});
```

鑑權中介軟體（示意）：

```ts
import { createMiddleware } from 'hono/factory';

export const requireAdmin = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
  const auth = c.req.header('authorization') ?? '';
  const expected = `Bearer ${c.env.ADMIN_TOKEN}`;
  if (auth !== expected)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, 401);
  await next();
});
```

開啟 CORS（可選，適用於 public API）：

```ts
import { cors } from 'hono/cors';

app.use('/api/v1/public/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));
```

---

## 10) Drizzle ORM（D1/SQLite driver）

建立 client（Worker 內）：

```ts
import { drizzle } from 'drizzle-orm/d1';

export function getDb(env: { DB: D1Database }) {
  return drizzle(env.DB);
}
```

查詢示例（來自 Drizzle Cloudflare D1 文件頁面的用法風格）：

```ts
import { drizzle } from 'drizzle-orm/d1';
import { users } from './schema';

const db = drizzle(env.DB);
const rows = await db.select().from(users).all();
```

寫入示例（insert / update / delete，通用 Drizzle 用法）：

```ts
import { eq } from 'drizzle-orm';
import { users } from './schema';

await db.insert(users).values({ name: 'Andrew' });
await db.update(users).set({ name: 'Mr. Dan' }).where(eq(users.name, 'Dan'));
await db.delete(users).where(eq(users.name, 'Mr. Dan'));
```

執行原生 SQL（Drizzle `sql`，通用 Drizzle 用法）：

```ts
import { sql } from 'drizzle-orm';

const id = 69;
const r = await db.execute(sql`select * from ${users} where ${users.id} = ${id}`);
```

說明：

- CF Uptime 以 “SQL migrations via Wrangler” 為準；Drizzle schema 用於型別安全與查詢封裝，二者需保持一致。

## References

Cloudflare Workers：

- Cron Triggers / scheduled：https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Context API / waitUntil：https://developers.cloudflare.com/workers/runtime-apis/context/
- Request.cf（IncomingRequestCfProperties）：https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties
- fetch & cache 示例：https://developers.cloudflare.com/workers/examples/cache-using-fetch/
- TCP sockets：https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- Wrangler config：https://developers.cloudflare.com/workers/wrangler/configuration/

Cloudflare D1：

- Prepared statements：https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Query D1 best practices：https://developers.cloudflare.com/d1/best-practices/query-d1/
- D1 API tutorial（batch/exec 示例）：https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1
- D1 return object / exec 示例：https://developers.cloudflare.com/d1/worker-api/return-object

Hono：

- Hono docs：https://hono.dev/

Drizzle ORM：

- Cloudflare D1 connection：https://orm.drizzle.team/docs/connect-cloudflare-d1
- SQL template (`sql`)：https://orm.drizzle.team/docs/sql
- Insert / Update / Delete：
  - https://orm.drizzle.team/docs/insert
  - https://orm.drizzle.team/docs/update
  - https://orm.drizzle.team/docs/delete
