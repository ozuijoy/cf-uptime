#!/usr/bin/env node
/**
 * 產生 Cloudflare Dashboard（Workers Builds / Git 整合）可直接使用的 wrangler 設定檔。
 *
 * 為什麼需要這一步：
 *   專案原本的部署走 GitHub Actions，workflow 會在 CI 裡「動態」產生
 *   apps/worker/wrangler.ci.toml（把 D1 database_id、worker 名稱、migrations_dir
 *   寫進去）。Cloudflare Dashboard 的 Workers Builds 沒有這段邏輯，如果直接
 *   `wrangler deploy`，D1 會綁到 wrangler.toml 裡的假 id
 *   00000000-0000-0000-0000-000000000000，部署會失敗或綁到不存在的資料庫。
 *
 * 這個腳本做的是同一件事，只是改成在 build 階段跑。
 *
 * 用法：
 *   D1_ID=<你的 database_id> node scripts/cf/prepare-wrangler.mjs
 *
 * 可用環境變數：
 *   WORKER_NAME / UPTIMER_WORKER_NAME   預設 cf-uptime
 *   D1_BINDING  / UPTIMER_D1_BINDING    預設 DB
 *   D1_NAME     / UPTIMER_D1_NAME       預設 cf-uptime
 *   D1_ID       / UPTIMER_D1_ID         必填（可用 --d1-id= 或第二個參數）
 *   UPTIMER_DEPLOY_MODE                 pages（預設）| single_worker
 *
 * 產出：apps/worker/wrangler.dashboard.toml
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const srcPath = path.join(repoRoot, 'apps/worker/wrangler.toml');
const dstPath = path.join(repoRoot, 'apps/worker/wrangler.dashboard.toml');
const migrationsDir = path.join(repoRoot, 'apps/worker/migrations');

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const env = process.env;
const workerName = arg('worker-name', env.WORKER_NAME || env.UPTIMER_WORKER_NAME || 'cf-uptime');
const d1Binding = arg('d1-binding', env.D1_BINDING || env.UPTIMER_D1_BINDING || 'DB');
const d1Name = arg('d1-name', env.D1_NAME || env.UPTIMER_D1_NAME || 'cf-uptime');
const d1Id =
  arg('d1-id', env.D1_ID || env.UPTIMER_D1_ID || '') ||
  process.argv[2] ||
  '';
const deployMode = env.UPTIMER_DEPLOY_MODE || 'pages';

function die(msg) {
  console.error(`\n[prepare-wrangler] 錯誤：${msg}\n`);
  process.exit(1);
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d1Id)) {
  die(
    '缺少有效的 D1 database_id。\n' +
      '  Cloudflare Dashboard → Workers & Pages → D1 → 選你的資料庫，複製 Database ID，\n' +
      '  然後設定環境變數 D1_ID，或直接帶參數：\n' +
      '    node scripts/cf/prepare-wrangler.mjs --d1-id=<database_id>',
  );
}

if (!['pages', 'single_worker'].includes(deployMode)) {
  die(`UPTIMER_DEPLOY_MODE 只能是 pages 或 single_worker（目前是 ${deployMode}）`);
}

let text = fs.readFileSync(srcPath, 'utf8');

// 1) Worker 名稱
const nameRe = /^name\s*=\s*"[^"]*"\s*$/m;
if (!nameRe.test(text)) die('apps/worker/wrangler.toml 找不到頂層 name = "..."');
text = text.replace(nameRe, `name = "${workerName}"`);

// 2) 找出 [[d1_databases]] 區塊，改寫匹配 binding 的那一個
const blockRe = /^\[\[d1_databases\]\][\s\S]*?(?=^\[\[|^\[[a-zA-Z]|\Z)/gm;
const blocks = [...text.matchAll(blockRe)];

function setKV(block, key, value) {
  const kvRe = new RegExp(`^${key}\\s*=\\s*"[^"]*"\\s*$`, 'm');
  if (kvRe.test(block)) return block.replace(kvRe, `${key} = "${value}"`);
  const bindingLine = /^binding\s*=\s*"[^"]*"\s*$/m.exec(block);
  if (bindingLine) {
    const at = bindingLine.index + bindingLine[0].length;
    return `${block.slice(0, at)}\n${key} = "${value}"${block.slice(at)}`;
  }
  const nl = block.indexOf('\n');
  return nl === -1 ? `${block}\n${key} = "${value}"\n` : `${block.slice(0, nl + 1)}${key} = "${value}"\n${block.slice(nl + 1)}`;
}

let replaced = false;
if (blocks.length > 0) {
  const target = blocks.find((m) => new RegExp(`^binding\\s*=\\s*"${d1Binding}"\\s*$`, 'm').test(m[0]));
  if (!target) die(`找不到 binding = "${d1Binding}" 的 [[d1_databases]] 區塊`);
  let patched = setKV(target[0], 'database_name', d1Name);
  patched = setKV(patched, 'database_id', d1Id);
  patched = setKV(patched, 'migrations_dir', migrationsDir.split(path.sep).join('/'));
  text = text.slice(0, target.index) + patched + text.slice(target.index + target[0].length);
  replaced = true;
}
if (!replaced) die('apps/worker/wrangler.toml 沒有任何 [[d1_databases]] 區塊');

// 3) SELF service binding（scheduler 用它把快照刷新丟到獨立 invocation）
if (!/binding\s*=\s*"SELF"/.test(text)) {
  text = `${text.trimEnd()}\n\n[[services]]\nbinding = "SELF"\nservice = "${workerName}"\n`;
}

// 4) 依模式處理 [assets]
const hasAssets = /^\[assets\]\s*$/m.test(text);
if (deployMode === 'single_worker') {
  if (!hasAssets) {
    text = `${text.trimEnd()}\n\n# single_worker：SPA 靜態資源跟 Worker 一起上傳\n[assets]\ndirectory = "../web/dist"\nnot_found_handling = "single-page-application"\nrun_worker_first = ["/api/*"]\n`;
  }
} else if (hasAssets) {
  die('pages 模式的設定不可包含 [assets]（請確認 wrangler.toml 沒有被手動加過）');
}

// 5) 基本驗證（Dashboard 上沒有 CI 的檢查，這裡先擋掉常見錯誤）
const problems = [];
if (!/^crons\s*=/m.test(text)) problems.push('缺少 crons（cron trigger 不會生效）');
if (!/database_id\s*=\s*"[0-9a-f-]{36}"/i.test(text)) problems.push('database_id 格式不正確');
if (deployMode === 'pages' && /^\[assets\]/m.test(text)) problems.push('pages 模式不該有 [assets]');
if (!/^\[\[services\]\]/m.test(text)) problems.push('缺少 [[services]] SELF binding');
if (problems.length > 0) die(`產出的設定有問題：\n  - ${problems.join('\n  - ')}`);

// 6) 統計 vars，方便對照 Dashboard 上的值
const varsSection = text.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
const varNames = [...varsSection.matchAll(/^([A-Z0-9_]+)\s*=\s*"[^"]*"\s*$/gm)].map((m) => m[1]);

fs.writeFileSync(dstPath, text, 'utf8');

console.log('[prepare-wrangler] 已產生', path.relative(repoRoot, dstPath));
console.log(`  worker      : ${workerName}`);
console.log(`  d1 binding  : ${d1Binding} -> ${d1Name} (${d1Id})`);
console.log(`  migrations  : ${migrationsDir}`);
console.log(`  deploy mode : ${deployMode}`);
console.log(`  vars        : ${varNames.length} 個 (${varNames.slice(0, 6).join(', ')}${varNames.length > 6 ? ', ...' : ''})`);