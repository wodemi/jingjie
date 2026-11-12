/* =============================================================================
   注册表清理：只做“能证明已经失效”的项，宁可少删
   - reg_uninstall     安装目录不存在的卸载记录（高置信）
   - reg_startup       指向不存在程序的 Run / RunOnce 值（高置信）
   - reg_apppaths      App Paths 指向不存在文件（高置信）
   - reg_mui           MUICache 里指向不存在程序的名字缓存（谨慎）
   - reg_shareddlls    SharedDLLs 里指向不存在文件（谨慎）
   扫描只读；清理前把涉事键导出成 .reg 备份到 data/regbackup/<时间戳>/
   ============================================================================= */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const U = require('./util');

const BACKUP_ROOT = path.join(__dirname, '..', '..', 'data', 'regbackup');
const cache = new Map();      /* regId -> { at, entries } */

/* PowerShell 里把注册表提供程序路径换成 reg.exe 认得的形式 */
const PS2REG = `function ToReg($p) { $p -replace '^Microsoft\\.PowerShell\\.Core\\\\Registry::','' }`;

/* ---------------- 各类扫描脚本 ---------------- */

const SCRIPTS = {
  uninstall: `
$roots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)
$out = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  Get-ChildItem $r -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p -eq $null) { return }
    if ($p.SystemComponent -eq 1) { return }
    $nm = $p.DisplayName
    if (-not $nm) { return }
    $loc = $p.InstallLocation
    $lp = ''
    if ($loc) { $lp = $loc.Trim().Trim('"') }
    $bad = $false
    $why = ''
    if ($lp.Length -ge 3 -and -not (Test-Path -LiteralPath $lp)) {
      $bad = $true
      $why = '安装目录已不存在'
    }
    if (-not $bad -and $lp.Length -lt 3) {
      /* 没有安装目录时，改看卸载程序本身是否还在（MsiExec 不算） */
      $us = [string]$p.UninstallString
      if ($us) {
        if ($us -match '^(.*?\.exe)') { $ux = $matches[1].Trim('"') } elseif ($us.StartsWith('"')) { $ux = $us.Split('"')[1] } else { $ux = ($us -split ' ')[0] }
        $ux = [Environment]::ExpandEnvironmentVariables($ux)
        if ($ux -and $ux.Contains('\\') -and $ux -notmatch 'msiexec' -and -not (Test-Path -LiteralPath $ux)) {
          $bad = $true
          $why = '卸载程序已不存在'
          $lp = $ux
        }
      }
    }
    if (-not $bad) { return }
    $out += [pscustomobject]@{
      key    = ($_.PSPath -replace '^Microsoft\\.PowerShell\\.Core\\\\Registry::','')
      name   = $nm
      reason = $why
      detail = $lp
    }
  }
}
$out`,

  startup: `
$roots = @(
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'
)
$out = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  $k = Get-Item $r -ErrorAction SilentlyContinue
  if ($k -eq $null) { continue }
  foreach ($n in $k.GetValueNames()) {
    if (-not $n) { continue }
    $v = [string]$k.GetValue($n)
    if (-not $v) { continue }
    if ($v -match '^(.*?\.exe)') { $exe = $matches[1].Trim('"') } elseif ($v.StartsWith('"')) { $exe = $v.Split('"')[1] } else { $exe = ($v -split ' ')[0] }
    if (-not $exe) { continue }
    $exe = [Environment]::ExpandEnvironmentVariables($exe)
    if ($exe.Length -lt 4) { continue }
    if (-not $exe.Contains('\\') -and -not $exe.Contains('/')) { continue }
    if (Test-Path -LiteralPath $exe) { continue }
    $out += [pscustomobject]@{
      key    = ($r -replace '^HKCU:','HKEY_CURRENT_USER' -replace '^HKLM:','HKEY_LOCAL_MACHINE')
      value  = $n
      name   = $n
      reason = '启动程序已不存在'
      detail = $exe
    }
  }
}
$out`,

  apppaths: `
$roots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'
)
$out = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  Get-ChildItem $r -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p -eq $null) { return }
    $exe = [string]$p.'(default)'
    if (-not $exe) { return }
    $exe = [Environment]::ExpandEnvironmentVariables(($exe.Trim().Trim('"')))
    if ($exe.Length -lt 4) { return }
    if (Test-Path -LiteralPath $exe) { return }
    $out += [pscustomobject]@{
      key    = ($_.PSPath -replace '^Microsoft\\.PowerShell\\.Core\\\\Registry::','')
      name   = $_.PSChildName
      reason = '登记的程序文件已不存在'
      detail = $exe
    }
  }
}
$out`,

  mui: `
$r = 'HKCU:\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache'
$out = @()
if (Test-Path $r) {
  $k = Get-Item $r -ErrorAction SilentlyContinue
  if ($k -ne $null) {
    foreach ($n in $k.GetValueNames()) {
      if (-not $n) { continue }
      $p = $n -replace '\\.(FriendlyAppName|ApplicationCompany)$',''
      if ($p.Length -lt 4) { continue }
      if (-not $p.Contains('\\')) { continue }
      if (Test-Path -LiteralPath $p) { continue }
      $out += [pscustomobject]@{
        key    = 'HKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache'
        value  = $n
        name   = $p
        reason = '程序已不存在，名字缓存可删'
        detail = $p
      }
    }
  }
}
$out`,

  shareddlls: `
$r = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs'
$out = @()
if (Test-Path $r) {
  $k = Get-Item $r -ErrorAction SilentlyContinue
  if ($k -ne $null) {
    foreach ($n in $k.GetValueNames()) {
      if (-not $n) { continue }
      if (-not $n.Contains('\\')) { continue }
      if (Test-Path -LiteralPath $n) { continue }
      $out += [pscustomobject]@{
        key    = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs'
        value  = $n
        name   = $n
        reason = 'DLL 已不存在，记录可删'
        detail = $n
      }
    }
  }
}
$out`
};

/* ---------------- 扫描 ---------------- */

async function scan(regId) {
  const script = SCRIPTS[regId];
  if (!script) return { entries: [], count: 0 };
  let entries = [];
  try {
    const r = await U.psJson(script);
    entries = Array.isArray(r) ? r : (r ? [r] : []);
  } catch (e) {
    entries = [];
  }
  entries = entries.filter((x) => x && x.key);
  cache.set(regId, { at: Date.now(), entries });
  return { entries: entries, count: entries.length };
}

function cached(regId) {
  const c = cache.get(regId);
  return c ? c.entries : null;
}

/* ---------------- 备份 ---------------- */

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/* 把每个要动的键导出成 .reg，返回备份目录 */
async function backup(regId, entries) {
  const dir = path.join(BACKUP_ROOT, stamp());
  try { await fsp.mkdir(dir, { recursive: true }); } catch (e) { return ''; }
  const keys = [];
  for (const e of entries) if (e.key && keys.indexOf(e.key) < 0) keys.push(e.key);
  let i = 0;
  for (const k of keys) {
    i++;
    const f = path.join(dir, regId + '-' + i + '.reg');
    try { await U.run('reg', ['export', k, f, '/y'], { timeout: 20000 }); } catch (e) { }
  }
  return dir;
}

/* ---------------- 清理 ---------------- */

async function clean(regId, opt) {
  const entries = cached(regId) || (await scan(regId)).entries;
  const res = { removed: 0, failed: 0, errors: [], backupDir: '', message: '' };
  if (!entries.length) { res.message = '没有需要清理的项'; return res; }

  if (!opt || opt.backup !== false) {
    res.backupDir = await backup(regId, entries);
  }

  for (const e of entries) {
    const args = e.value
      ? ['delete', e.key, '/v', e.value, '/f']
      : ['delete', e.key, '/f'];
    const r = await U.run('reg', args, { timeout: 15000 });
    if (r.code === 0) res.removed++;
    else {
      res.failed++;
      const msg = ((r.err || '') + (r.out || '')).trim().split(/\r?\n/).filter(Boolean).pop() || '删除失败';
      if (res.errors.length < 20) res.errors.push({ path: (e.key + (e.value ? '\\' + e.value : '')), error: msg });
    }
  }
  if (res.removed) cache.delete(regId);
  res.message = '已删除 ' + res.removed + ' 项' + (res.failed ? '，' + res.failed + ' 项失败' : '');
  return res;
}

module.exports = { scan, clean, cached, SCRIPTS };
