'use strict';
/* 净界 - 基础工具库 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const cp = require('child_process');

const USER = process.env.USERPROFILE || os.homedir();
const ROAM = process.env.APPDATA || path.join(USER, 'AppData', 'Roaming');
const LOCAL = process.env.LOCALAPPDATA || path.join(USER, 'AppData', 'Local');
const PROGRAMDATA = process.env.ProgramData || 'C:\\ProgramData';
const WINDIR = process.env.windir || 'C:\\Windows';
const SYSTEMDRIVE = process.env.SystemDrive || 'C:';

function expand(p) {
  if (!p) return p;
  return p.replace(/%([^%]+)%/g, (m, k) => process.env[k] || process.env[k.toUpperCase()] || m);
}

function documentsDir() {
  let d = '';
  try {
    const out = cp.execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)\s*$/m);
    if (m) d = expand(m[1].trim());
  } catch (e) { /* ignore */ }
  if (!d) d = path.join(USER, 'Documents');
  try { if (fs.statSync(d).isDirectory()) return d; } catch (e) { }
  return path.join(USER, 'Documents');
}

const DOCS = documentsDir();

function exists(p) { try { fs.accessSync(p); return true; } catch (e) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function statSafe(p) { try { return fs.lstatSync(p); } catch (e) { return null; } }
function sizeSafe(p) { try { const s = fs.statSync(p); return s.isFile() ? s.size : 0; } catch (e) { return 0; } }

function human(n) {
  if (n === null || n === undefined) return '-';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1, v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + u[i];
}

/* 递归统计：文件数与占用字节数 */
async function walkUsage(root, opts) {
  opts = opts || {};
  const ageCutoff = opts.ageDays ? Date.now() - opts.ageDays * 86400000 : 0;
  const concurrency = opts.concurrency || 8;
  const filter = opts.filter || null;
  const collect = opts.collect ? [] : null;
  let size = 0, files = 0, dirs = 0, errors = 0;
  const stack = [root];
  let active = 0;
  let finished = false;
  return new Promise((resolve) => {
    function pump() {
      if (finished) return;
      if (stack.length === 0 && active === 0) { finished = true; resolve({ size, files, dirs, errors, list: collect }); return; }
      while (stack.length > 0 && active < concurrency) {
        const d = stack.pop();
        active++;
        fsp.readdir(d, { withFileTypes: true }).then(async (ents) => {
          const tasks = [];
          for (const e of ents) {
            const p = path.join(d, e.name);
            let isLink = false;
            try { isLink = e.isSymbolicLink(); } catch (err) { }
            if (e.isDirectory()) {
              dirs++;
              if (!isLink) stack.push(p);
            } else if (e.isFile()) {
              tasks.push(fsp.stat(p).then((s) => {
                if (ageCutoff && s.mtimeMs >= ageCutoff) return;
                if (filter && !filter.test(e.name)) return;
                size += s.size; files++;
                if (collect) collect.push({ path: p, size: s.size, mtime: s.mtimeMs });
              }).catch(() => { errors++; }));
            }
          }
          if (tasks.length) await Promise.all(tasks);
        }).catch(() => { errors++; }).then(() => { active--; pump(); });
      }
    }
    pump();
  });
}

/* 统计单个目标（文件或目录） */
async function measureTarget(p, ageDays) {
  const st = statSafe(p);
  if (!st) return { path: p, size: 0, count: 0, exists: false };
  if (st.isFile()) {
    if (ageDays && st.mtimeMs >= Date.now() - ageDays * 86400000) return { path: p, size: 0, count: 0, exists: true };
    return { path: p, size: st.size, count: 1, exists: true };
  }
  if (!st.isDirectory()) return { path: p, size: 0, count: 0, exists: true };
  const u = await walkUsage(p, { ageDays });
  return { path: p, size: u.size, count: u.files, exists: true };
}

/* 执行外部命令
   opts.enc：原生命令输出编码。PowerShell 输出统一 UTF-8；ping / ipconfig / netstat
   这类系统命令在中文系统上是 GBK，需要单独指定，否则中文会变成乱码。 */
function run(cmd, args, opts) {
  opts = opts || {};
  let dec = null;
  try { dec = new TextDecoder(opts.enc || 'utf-8'); } catch (e) { dec = null; }
  const decode = (buf) => (dec ? dec.decode(buf, { stream: true }) : buf.toString('utf8'));
  return new Promise((resolve) => {
    const p = cp.spawn(cmd, args || [], {
      windowsHide: true,
      cwd: opts.cwd,
      env: Object.assign({}, process.env, opts.env || {}),
      shell: !!opts.shell,
    });
    let out = '', err = '';
    const timer = opts.timeout ? setTimeout(() => { try { p.kill(); } catch (e) { } }, opts.timeout) : null;
    p.stdout.on('data', (d) => { const t = decode(d); out += t; if (opts.onLine) splitLines(t).forEach(opts.onLine); });
    p.stderr.on('data', (d) => { err += decode(d); });
    p.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: -1, out, err: err + '\n' + e.message }); });
    p.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, out, err }); });
  });
}

function splitLines(s) { return s.split(/\r?\n/).filter((x) => x.length > 0); }

const PS_HEADER = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue';";
function ps(script, opts) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_HEADER + script];
  return run('powershell.exe', args, Object.assign({ timeout: 60000 }, opts || {}));
}

async function psJson(script) {
  const r = await ps(script + " | ConvertTo-Json -Compress -Depth 6");
  const t = (r.out || '').trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) {
    // 有时 PowerShell 会输出 BOM 或多个对象
    const i = t.indexOf('['), j = t.lastIndexOf('}');
    try { return JSON.parse(t.slice(i >= 0 ? i : 0, j + 1)); } catch (e2) { return null; }
  }
}

let adminCache = null;
async function isAdmin() {
  if (adminCache !== null) return adminCache;
  const r = await run('fltmc', ['filters'], { timeout: 5000 });
  adminCache = r.code === 0;
  return adminCache;
}

/* 删除一个条目（文件或目录） */
async function removeEntry(p, retries) {
  const st = statSafe(p);
  if (!st) return { ok: true };
  try {
    await fsp.rm(p, { recursive: true, force: true, maxRetries: retries == null ? 2 : retries, retryDelay: 60 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.code || e.message };
  }
}

/* 删除目录内容，保留目录本身。用并发 + 少重试，避免大目录（临时文件/缓存）卡很久 */
async function removeContents(dir, opts) {
  const res = { freed: 0, removed: 0, errors: [] };
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return res; }
  const list = ents.filter((e) => !(opts && opts.filter && !opts.filter(e)));
  const CONC = (opts && opts.concurrency) || 6;
  const RETRY = opts && opts.retries != null ? opts.retries : 1;
  let idx = 0;
  async function worker() {
    while (idx < list.length) {
      const e = list[idx++];
      const p = path.join(dir, e.name);
      let size = 0;
      try {
        const st = statSafe(p);
        if (st && st.isFile()) size = st.size;
        else if (st && st.isDirectory() && e.isDirectory()) size = (await walkUsage(p, { concurrency: 4 })).size;
      } catch (err) { }
      const r = await removeEntry(p, RETRY);
      if (r.ok) { res.freed += size; res.removed++; } else { res.errors.push({ path: p, error: r.error }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, list.length || 1) }, worker));
  return res;
}

/* 带超时/容忍错误的移动（用于隔离区） */
async function moveEntry(src, dst) {
  try {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.rename(src, dst);
    return { ok: true };
  } catch (e) {
    if (e.code === 'EXDEV') {
      try {
        await fsp.cp(src, dst, { recursive: true, force: true, errorOnExist: false });
        await fsp.rm(src, { recursive: true, force: true });
        return { ok: true };
      } catch (e2) { return { ok: false, error: e2.code || e2.message }; }
    }
    if (e.code === 'ENOENT') return { ok: true };
    return { ok: false, error: e.code || e.message };
  }
}

function diskInfo() {
  const out = [];
  try {
    const drive = cp.execFileSync('wmic', ['logicaldisk', 'get', 'DeviceID,VolumeName,FileSystem,Size,FreeSpace', '/format:csv'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    const lines = drive.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('Node'));
    for (const l of lines) {
      const c = l.split(',');
      if (c.length < 6) continue;
      const total = parseInt(c[5], 10), free = parseInt(c[4], 10);
      if (!total) continue;
      out.push({ name: c[1], label: c[2] || '', fs: c[3] || '', total: total, free: free });
    }
  } catch (e) { }
  if (!out.length) {
    try {
      fs.readdirSync('/').forEach(() => { });
      const { execSync } = cp;
      const psOut = execSync('powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free,Root | ConvertTo-Json -Compress"', { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      const arr = JSON.parse(psOut);
      (Array.isArray(arr) ? arr : [arr]).forEach((d) => {
        if (!d.Free && !d.Used) return;
        out.push({ name: d.Name + ':', label: '', fs: 'NTFS', total: (d.Used || 0) + (d.Free || 0), free: d.Free || 0 });
      });
    } catch (e2) { }
  }
  return out;
}

function uptimeSeconds() { return Math.floor(os.uptime()); }

function osCaption() {
  let name = '', build = 0;
  try {
    const out = cp.execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'ProductName'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    const m = out.match(/REG_SZ\s+(.+)\s*$/m);
    if (m) name = m[1].trim();
  } catch (e) { }
  try {
    const out2 = cp.execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'CurrentBuildNumber'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    const m2 = out2.match(/REG_SZ\s+(\d+)/);
    if (m2) build = parseInt(m2[1], 10);
  } catch (e) { }
  if (name && build >= 22000) name = name.replace(/Windows 10/, 'Windows 11');
  if (name) return name;
  return os.type() + ' ' + os.release();
}

function diskFreeOf(p) {
  try {
    const d = path.parse(path.resolve(p)).root.replace(/\\$/, '');
    const all = diskInfo();
    const hit = all.find((x) => x.name.toUpperCase() === d.toUpperCase());
    return hit ? hit.free : null;
  } catch (e) { return null; }
}

module.exports = {
  fs, fsp, path, os, cp,
  USER, ROAM, LOCAL, PROGRAMDATA, WINDIR, SYSTEMDRIVE, DOCS,
  expand, exists, isDir, isFile, statSafe, sizeSafe, human,
  walkUsage, measureTarget, run, ps, psJson, isAdmin, splitLines,
  removeEntry, removeContents, moveEntry, diskInfo, diskFreeOf,
  uptimeSeconds, osCaption,
};
