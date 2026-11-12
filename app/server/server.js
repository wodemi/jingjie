'use strict';
/* 净界 - 本地 HTTP 服务 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const U = require('./util');
const catalog = require('./catalog');
const job = require('./job');
const tools = require('./tools');

const ROOT = path.join(__dirname, '..', 'web');
const TOKEN = process.env.JJ_TOKEN || crypto.randomBytes(12).toString('hex');
const PORT = parseInt(process.env.JJ_PORT || '0', 10);
const VERSION = '1.0.0';

/* 最近一次扫描结果（内存），供页面刷新后恢复数字 */
let lastScan = null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
}

function auth(req) {
  const t = req.headers['x-jj-token'] || '';
  return t === TOKEN;
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 32 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/* NDJSON 流式响应 */function stream(res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    'Connection': 'keep-alive',
  });
  return {
    send(obj) { try { res.write(JSON.stringify(obj) + '\n'); } catch (e) { } },
    end() { try { res.end(); } catch (e) { } },
  };
}

async function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const full = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  let data;
  try { data = await fsp.readFile(full); } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
  const ext = path.extname(full).toLowerCase();
  if (ext === '.html') {
    /* 主题直接注入到 <html data-theme>，首帧就是用户上次选的那套，避免闪一下深色 */
    const theme = (readSettings().theme === 'light') ? 'light' : 'dark';
    let s = data.toString('utf8')
      .replace(/__JJ_TOKEN__/g, TOKEN)
      .replace(/__JJ_VERSION__/g, VERSION)
      .replace(/__JJ_THEME__/g, theme);
    data = Buffer.from(s, 'utf8');
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(data);
}

/* 自检：能不能正常创建并删除文件（有些安全软件会拦截未签名程序的写/删操作） */
let probeCache = null;
async function deleteProbe(force) {
  if (probeCache != null && !force) return probeCache;
  const f = path.join(os.tmpdir(), 'jingjie_probe_' + process.pid + '.tmp');
  let canWrite = false, canDelete = false;
  try {
    await fsp.writeFile(f, 'ok');
    canWrite = true;
  } catch (e) { }
  if (canWrite) {
    try { await fsp.unlink(f); canDelete = true; } catch (e) { canDelete = false; }
  }
  probeCache = { canWrite, canDelete, at: Date.now() };
  return probeCache;
}

/* ---------- 用户设置（主题等），存 data\settings.json ---------- */
const DATA_DIR = process.env.JJ_DATA || path.join(__dirname, '..', '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function readSettings() {
  try {
    /* 记事本另存为可能带 BOM，先剥掉再解析 */
    const txt = fs.readFileSync(SETTINGS_FILE, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(txt) || {};
  } catch (e) { return {}; }
}
function writeSettings(obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

async function state() {
  const groups = catalog.buildCatalog();
  const meta = catalog.metaCatalog(groups);
  const disks = U.diskInfo();
  const admin = await U.isAdmin();
  return {
    version: VERSION,
    app: '净界',
    os: { caption: U.osCaption(), release: os.release(), arch: os.arch(), host: os.hostname(), user: os.userInfo().username },
    admin,
    probe: await deleteProbe(),
    disks,
    uptime: U.uptimeSeconds(),
    groups: meta,
    tools: tools.list(),
    scan: lastScan,
    settings: readSettings(),
    dataDir: path.dirname(__dirname),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    if (!auth(req)) { json(res, 401, { error: 'unauthorized' }); return; }
    try {
      if (p === '/api/state' && req.method === 'GET') { json(res, 200, await state()); return; }
      if (p === '/api/probe') { json(res, 200, { probe: await deleteProbe(url.searchParams.get('force') === '1') }); return; }
      if (p === '/api/ping') { json(res, 200, { ok: true, version: VERSION }); return; }
      if (p === '/api/disk') { json(res, 200, { disks: U.diskInfo() }); return; }
      if (p === '/api/settings' && req.method === 'POST') {
        const body = await readBody(req);
        const cur = readSettings();
        Object.keys(body || {}).forEach((k) => { cur[k] = body[k]; });
        json(res, 200, { ok: writeSettings(cur), settings: cur });
        return;
      }
      if (p === '/api/reveal' && req.method === 'POST') {
        const body = await readBody(req);
        const target = body.path || '';
        if (target && U.exists(target)) {
          const { spawn } = require('child_process');
          try {
            const st = U.statSafe(target);
            if (st && st.isDirectory()) spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            else spawn('explorer.exe', ['/select,' + target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            json(res, 200, { ok: true });
          } catch (e) { json(res, 200, { ok: false }); }
        } else json(res, 200, { ok: false });
        return;
      }
      if (p === '/api/openurl' && req.method === 'POST') {
        /* 用系统默认浏览器打开链接（用于「联网查询」这类外链） */
        const body = await readBody(req);
        const url = String(body.url || '');
        if (!/^https?:\/\//i.test(url)) { json(res, 200, { ok: false }); return; }
        const { spawn } = require('child_process');
        try {
          spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
          json(res, 200, { ok: true });
        } catch (e) { json(res, 200, { ok: false }); }
        return;
      }
      if (p === '/api/pick' && req.method === 'POST') {
        const script = "Add-Type -AssemblyName System.Windows.Forms;" +
          "$f=New-Object System.Windows.Forms.FolderBrowserDialog;" +
          "$f.Description='选择文件夹';$f.ShowNewFolderButton=$true;" +
          "if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){$f.SelectedPath}else{''}";
        const r = await U.run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command',
          "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" + script], { timeout: 180000 });
        json(res, 200, { path: (r.out || '').trim().split(/\r?\n/).pop() || '' });
        return;
      }
      if (p === '/api/scan' && req.method === 'POST') {
        const body = await readBody(req);
        const s = stream(res);
        const t0 = Date.now();
        s.send({ type: 'start', total: (body.ids || []).length });
        try {
          const results = await job.scanMany(body.ids, { ageDays: body.ageDays || 0 }, (e) => s.send(e));
          const at = Date.now();
          const map = {};
          for (const r of results) map[r.id] = { size: r.size || 0, count: r.count || 0 };
          /* 增量合并：局部扫描不覆盖其它分组已有数据 */
          lastScan = { at, age: body.ageDays || 0, items: Object.assign({}, (lastScan && lastScan.items) || {}, map) };
          s.send({ type: 'done', results, ms: Date.now() - t0, at });
        } catch (e) { s.send({ type: 'error', message: String(e && e.message || e) }); }
        s.end();
        return;
      }
      if (p === '/api/clean' && req.method === 'POST') {
        const body = await readBody(req);
        const s = stream(res);
        s.send({ type: 'start' });
        try {
          const results = await job.cleanMany(body.ids, { ageDays: body.ageDays || 0, resetBase: !!body.resetBase }, (e) => s.send(e));
          const freed = results.reduce((a, r) => a + (r.freed || 0), 0);
          const removed = results.reduce((a, r) => a + (r.removed || 0), 0);
          const errors = results.reduce((a, r) => a + (r.errors ? r.errors.length : 0), 0);
          s.send({ type: 'done', results, freed, removed, errors, disks: U.diskInfo() });
        } catch (e) { s.send({ type: 'error', message: String(e && e.message || e) }); }
        s.end();
        return;
      }
      if (p.startsWith('/api/tool/')) {
        const id = p.slice('/api/tool/'.length);
        const t = tools.find(id);
        if (!t) { json(res, 404, { error: 'no such tool' }); return; }
        if (req.method === 'GET') {
          if (t.status) { const q = Object.fromEntries(url.searchParams); json(res, 200, await t.status(q)); return; }
          const q = Object.fromEntries(url.searchParams);
          const r = await t.run(q);
          json(res, 200, { ok: true, data: r });
          return;
        }
        const body = await readBody(req);
        if (body.__run) { const r = await t.run(body); json(res, 200, { ok: true, data: r }); return; }
        if (t.status) { json(res, 200, await t.status(body)); return; }
        const r = await t.action(body);
        json(res, 200, r);
        return;
      }
      json(res, 404, { error: 'not found' });
      return;
    } catch (e) {
      json(res, 500, { error: String(e && e.message || e) });
      return;
    }
  }

  if (p === '/shutdown' && req.method === 'POST') { setTimeout(() => process.exit(0), 60); json(res, 200, { ok: true }); return; }
  await serveStatic(req, res, p);
});

server.on('error', (e) => {
  process.stdout.write('ERROR ' + (e && e.message) + '\n');
  process.exit(2);
});

server.listen(PORT, '127.0.0.1', () => {
  const port = server.address().port;
  process.stdout.write('READY {"port":' + port + ',"token":"' + TOKEN + '","version":"' + VERSION + '"}\n');
  if (process.send) process.send({ type: 'ready', port, token: TOKEN });
});

process.on('uncaughtException', (e) => { process.stdout.write('UNCAUGHT ' + (e && e.stack || e) + '\n'); });
process.on('unhandledRejection', (e) => { process.stdout.write('UNHANDLED ' + (e && e.stack || e) + '\n'); });
