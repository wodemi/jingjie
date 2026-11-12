'use strict';
/* 净界 - 扫描与清理作业层 */
const fs = require('fs');
const fsp = fs.promises;
const pathm = require('path');
const U = require('./util');
const REG = require('./reg');
const catalog = require('./catalog');

const isDriveRoot = (p) => { try { return pathm.parse(pathm.resolve(p)).root.toLowerCase() === pathm.resolve(p).toLowerCase(); } catch (e) { return true; } };

/* ---------- 特殊项：测量 ---------- */
async function measureSpecial(item) {
  if (item.special === 'reg') {
    const r = await REG.scan(item.regId);
    return {
      size: 0, count: r.count, unit: '项',
      parts: r.entries.slice(0, 200).map((e) => ({ path: (e.name || e.key) + '：' + e.reason, size: 0, count: 1 })),
    };
  }
  if (item.special === 'hibernate') {
    const p = pathm.join(U.SYSTEMDRIVE + '\\', 'hiberfil.sys');
    const s = U.sizeSafe(p);
    return { size: s, count: s ? 1 : 0, parts: [{ path: p, size: s, count: s ? 1 : 0 }] };
  }
  if (item.special === 'recycle') {
    let size = 0, count = 0; const parts = [];
    for (const d of U.diskInfo()) {
      const p = pathm.join(d.name + '\\', '$Recycle.Bin');
      if (!U.isDir(p)) continue;
      const r = await U.walkUsage(p, {});
      size += r.size; count += r.files;
      parts.push({ path: p, size: r.size, count: r.files });
    }
    return { size, count, parts };
  }
  if (item.special === 'windows_old') {
    const p = pathm.join(U.SYSTEMDRIVE + '\\', 'Windows.old');
    if (!U.isDir(p)) return { size: 0, count: 0, parts: [] };
    const r = await U.walkUsage(p, {});
    return { size: r.size, count: r.files, parts: [{ path: p, size: r.size, count: r.files }] };
  }
  return { size: 0, count: 0, parts: [], unknown: true };
}

/* ---------- 单个目标测量 ---------- */
async function measureOne(t, ageDays) {
  if (!U.exists(t.path)) return { path: t.path, size: 0, count: 0, exists: false };
  if (t.mode === 'file') {
    const s = U.sizeSafe(t.path);
    return { path: t.path, size: s, count: s ? 1 : 0, exists: true };
  }
  if (t.mode === 'glob') {
    let size = 0, count = 0;
    try {
      for (const e of await fsp.readdir(t.path, { withFileTypes: true })) {
        if (!e.isFile() || !t.pattern.test(e.name)) continue;
        const s = U.sizeSafe(pathm.join(t.path, e.name));
        size += s; count++;
      }
    } catch (e) { }
    return { path: t.path, size, count, exists: true, glob: true };
  }
  const r = await U.walkUsage(t.path, {
    ageDays: t.mode === 'agewalk' ? ageDays : 0,
    filter: t.filter || null,
  });
  return { path: t.path, size: r.size, count: r.files, exists: true, errors: r.errors };
}

/* ---------- 扫描 ---------- */
async function scan(item, opt, emit) {
  const ageDays = opt.ageDays || 0;
  if (item.special) {
    const r = await measureSpecial(item);
    return Object.assign({ id: item.id, special: item.special }, r);
  }
  const targets = item.targets(opt);
  const parts = [];
  let size = 0, count = 0, errs = 0;
  for (const t of targets) {
    const r = await measureOne(t, ageDays);
    errs += r.errors || 0;
    if (emit) emit({ type: 'part', id: item.id, path: r.path, size: r.size, count: r.count, exists: r.exists });
    if (r.size > 0 || r.count > 0) { size += r.size; count += r.count; parts.push({ path: r.path, size: r.size, count: r.count }); }
  }
  parts.sort((a, b) => b.size - a.size);
  return { id: item.id, size, count, parts, errors: errs };
}

async function scanMany(ids, opt, emit) {
  const groups = catalog.buildCatalog();
  const out = [];
  const list = [];
  for (const g of groups) for (const it of g.items) if (!ids || ids.includes(it.id)) list.push({ g, it });
  for (const { g, it } of list) {
    if (emit) emit({ type: 'item-start', id: it.id, name: it.name, group: g.name });
    const t0 = Date.now();
    let r;
    try { r = await scan(it, opt, emit); } catch (e) { r = { id: it.id, size: 0, count: 0, parts: [], error: String(e && e.message || e) }; }
    r.name = it.name; r.group = g.id; r.groupName = g.name; r.risk = it.risk; r.ms = Date.now() - t0;
    out.push(r);
    if (emit) emit({ type: 'item-done', id: it.id, size: r.size, count: r.count, group: g.id });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

/* ---------- 清理：基础操作 ---------- */
/* 把系统错误码翻成用户能看懂的原因 */
function why(code) {
  if (code === 'EBUSY') return '被占用';
  if (code === 'EPERM') return '被安全软件拦截';
  if (code === 'EACCES') return '需要管理员';
  if (code === 'ENOENT') return '不存在';
  if (code === 'ENOTEMPTY') return '仍被占用';
  return code || '失败';
}

async function delFile(p) {
  try {
    const st = U.statSafe(p);
    if (!st) return 0;
    let size = st.isFile() ? st.size : 0;
    if (st.isDirectory()) { const r = await U.walkUsage(p, {}); size = r.size; }
    await fsp.rm(p, { recursive: true, force: true, maxRetries: 1, retryDelay: 60 });
    return size;
  } catch (e) { delFile.lastCode = e.code; return -1; }
}

async function cleanTarget(t, ageDays, res) {
  if (isDriveRoot(t.path)) return;
  if (!U.exists(t.path)) return;
  const st = U.statSafe(t.path);
  if (!st) return;
  if (t.mode === 'file') {
    const r = await delFile(t.path);
    if (r >= 0) { res.freed += r; res.removed++; } else res.errors.push({ path: t.path, error: why(delFile.lastCode) });
    return;
  }
  if (t.mode === 'dir') {
    const r = await delFile(t.path);
    if (r >= 0) { res.freed += r; res.removed++; } else res.errors.push({ path: t.path, error: why(delFile.lastCode) });
    return;
  }
  if (t.mode === 'glob') {
    let ents = [];
    try { ents = await fsp.readdir(t.path, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (!e.isFile() || !t.pattern.test(e.name)) continue;
      const r = await delFile(pathm.join(t.path, e.name));
      if (r >= 0) { res.freed += r; res.removed++; } else res.errors.push({ path: pathm.join(t.path, e.name), error: why(delFile.lastCode) });
    }
    return;
  }
  if (t.mode === 'contents') {
    const r = await U.removeContents(t.path);
    res.freed += r.freed; res.removed += r.removed;
    for (const e of r.errors) res.errors.push({ path: e.path, error: why(e.error) });
    return;
  }
  if (t.mode === 'agewalk') {
    const w = await U.walkUsage(t.path, { ageDays, filter: t.filter || null, collect: true });
    const list = w.list || [];
    const CONC = 8;
    let i = 0;
    async function worker() {
      while (i < list.length) {
        const f = list[i++];
        try {
          await fsp.rm(f.path, { force: true, maxRetries: 1, retryDelay: 50 });
          res.freed += f.size; res.removed++;
        } catch (e) { res.errors.push({ path: f.path, error: why(e.code) }); }
        if (res.removed % 200 === 0) await new Promise((r) => setImmediate(r));
      }
    }
    await Promise.all(Array.from({ length: CONC }, worker));
    await pruneEmpty(t.path, 3);
  }
}

/* 删除空目录（最多向下 3 层） */
async function pruneEmpty(dir, depth) {
  if (depth <= 0) return;
  let ents = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const p = pathm.join(dir, e.name);
    await pruneEmpty(p, depth - 1);
    try { const left = await fsp.readdir(p); if (left.length === 0) await fsp.rmdir(p); } catch (err) { }
  }
}

/* ---------- 特殊清理 ---------- */
async function cleanSpecial(item, opt, res) {
  const s = item.special;
  if (s === 'reg') {
    const r = await REG.clean(item.regId, opt || {});
    res.removed += r.removed;
    if (r.failed) for (const e of r.errors) res.errors.push(e);
    const m = r.message || ('已删除 ' + r.removed + ' 条');
    /* 注意：这里必须返回“字符串消息”，不能返回 res 本身 —— 否则 cleanMany 会把消息
       设成自己的引用（循环引用），SSE 序列化时 JSON.stringify 直接抛错，进度条卡死 */
    return r.backupDir ? m + '（备份：' + r.backupDir + '）' : m;
  }
  const freeBefore = U.diskInfo().reduce((a, d) => a + d.free, 0);
  let msg = '';
  if (s === 'recycle') {
    const r = await U.ps("Clear-RecycleBin -Force -ErrorAction SilentlyContinue; 'ok'", { timeout: 120000 });
    msg = '回收站已清空';
  } else if (s === 'flushdns') {
    await U.run('ipconfig', ['/flushdns'], { timeout: 20000 });
    msg = 'DNS 缓存已刷新';
  } else if (s === 'hibernate') {
    const p = pathm.join(U.SYSTEMDRIVE + '\\', 'hiberfil.sys');
    const before = U.sizeSafe(p);
    const r = await U.run('powercfg', ['/h', 'off'], { timeout: 60000 });
    if (r.code === 0) { res.freed += before; res.removed++; msg = '休眠已关闭，已释放 hiberfil.sys'; }
    else { res.errors.push({ path: 'powercfg /h off', error: (r.err || '').trim() || '需要管理员权限' }); msg = '关闭休眠失败'; }
  } else if (s === 'vss') {
    const drv = U.SYSTEMDRIVE;
    const r = await U.run('vssadmin', ['delete', 'shadows', '/for=' + drv + '\\', '/all', '/quiet'], { timeout: 120000 });
    if (r.code === 0) msg = '系统还原点已删除（保留最新之外）';
    else { res.errors.push({ path: 'vssadmin', error: (r.err || '').trim() || '需要管理员权限' }); msg = '删除还原点失败'; }
  } else if (s === 'dism') {
    const args = ['/Online', '/Cleanup-Image', '/StartComponentCleanup'];
    if (opt.resetBase) args.push('/ResetBase');
    const r = await U.ps("Start-Process -FilePath dism.exe -ArgumentList '" + args.join(' ') + "' -Wait -NoNewWindow -PassThru | Select-Object -ExpandProperty ExitCode", { timeout: 1800000 });
    const code = parseInt((r.out || '').trim(), 10);
    if (code === 0) msg = 'WinSxS 组件清理完成';
    else { res.errors.push({ path: 'DISM', error: '退出码 ' + (isNaN(code) ? '?' : code) + '（需管理员权限）' }); msg = 'DISM 组件清理失败'; }
  } else if (s === 'drivers') {
    const r = await U.ps("(Get-WindowsDriver -Online -All | Where-Object { $_.Driver -like 'oem*' }).Count", { timeout: 120000 });
    msg = '检测到 ' + (r.out || '').trim() + ' 个第三方驱动包；请在「驱动管理」中确认后再移除';
  } else if (s === 'windows_old') {
    const p = pathm.join(U.SYSTEMDRIVE + '\\', 'Windows.old');
    const before = (await U.walkUsage(p, {})).size;
    const r = await U.ps("takeown /f '" + p + "' /r /d y | Out-Null; icacls '" + p + "' /grant *S-1-5-32-544:F /t /c /q | Out-Null; Remove-Item -LiteralPath '" + p + "' -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path '" + p + "') { 'left' } else { 'gone' }", { timeout: 1800000 });
    if (!(r.out || '').includes('left')) { res.freed += before; res.removed++; msg = 'Windows.old 已删除'; }
    else { msg = 'Windows.old 部分文件被占用，未能完全删除'; }
  }
  const freeAfter = U.diskInfo().reduce((a, d) => a + d.free, 0);
  const delta = Math.max(0, freeAfter - freeBefore);
  if (res.freed === 0 && delta > 0) res.freed = delta;
  return msg;
}

/* ---------- 清理主流程 ---------- */
async function cleanMany(ids, opt, emit) {
  const groups = catalog.buildCatalog();
  const ageDays = opt.ageDays || 0;
  const results = [];
  /* 先排好队，便于前端显示 "第 n / 共 m 项" */
  const queue = [];
  for (const g of groups) {
    for (const it of g.items) {
      if (ids && !ids.includes(it.id)) continue;
      queue.push({ g: g, it: it });
    }
  }
  const total = queue.length;
  for (let i = 0; i < total; i++) {
    const g = queue[i].g, it = queue[i].it;
    if (emit) emit({ type: 'item-start', id: it.id, name: it.name, idx: i + 1, total: total });
    const res = { id: it.id, name: it.name, group: g.id, freed: 0, removed: 0, errors: [], message: '', skipped: false };
    /* 需要管理员的项目在普通权限下直接跳过，避免一堆无意义的失败 */
    if (it.admin && !U.isAdmin()) {
      res.skipped = true;
      res.message = '需要管理员权限，已跳过';
      results.push(res);
      if (emit) emit({ type: 'item-done', id: it.id, name: it.name, idx: i + 1, total: total, freed: 0, removed: 0, errors: 0, skipped: true, message: res.message });
      continue;
    }
    try {
      if (it.special) {
        res.message = await cleanSpecial(it, opt, res);
      } else {
        for (const t of it.targets(opt)) {
          await cleanTarget(t, ageDays, res);
          if (emit) emit({ type: 'part', id: it.id, freed: res.freed, removed: res.removed });
        }
      }
    } catch (e) {
      res.errors.push({ path: it.id, error: String(e && e.message || e) });
    }
    /* 把失败原因汇总成一句人话 */
    if (res.errors.length) {
      const cnt = {};
      for (const e of res.errors) cnt[e.error] = (cnt[e.error] || 0) + 1;
      const parts = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).map((k) => cnt[k] + ' 个' + k);
      res.message = (res.message ? res.message + '；' : '') + parts.join('、');
    }
    res.ok = true;
    results.push(res);
    if (emit) emit({ type: 'item-done', id: it.id, name: it.name, idx: i + 1, total: total, freed: res.freed, removed: res.removed, errors: res.errors.length, message: res.message });
  }
  return results;
}

module.exports = { scan, scanMany, cleanMany, measureSpecial };
