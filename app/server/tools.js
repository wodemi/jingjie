'use strict';
/* 净界 - 实用小工具后端 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const U = require('./util');

/* ================= 通用遍历 ================= */
async function walkFiles(root, opt) {
  opt = opt || {};
  const minSize = opt.minSize || 0;
  const maxDepth = opt.maxDepth == null ? 99 : opt.maxDepth;
  const skipNames = new Set(['$Recycle.Bin', 'System Volume Information', 'Windows', 'Windows.old', 'node_modules', '.git', 'AppData\\Local\\Temp']);
  const out = [];
  const stack = [{ d: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { d, depth } = stack.pop();
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (depth + 1 <= maxDepth) {
          if (skipNames.has(e.name) && depth === 0) continue;
          stack.push({ d: p, depth: depth + 1 });
        }
        continue;
      }
      if (!e.isFile()) continue;
      visited++;
      let st;
      try { st = await fsp.stat(p); } catch (err) { continue; }
      if (st.size < minSize) continue;
      out.push({ path: p, size: st.size, mtime: st.mtimeMs, ext: path.extname(p).toLowerCase() });
    }
    if (visited > 400000) break;
  }
  return out;
}

/* ================= 工具注册表 ================= */
const tools = [];

function tool(o) { tools.push(o); return o; }

/* ---------- 1. 系统信息 ---------- */
tool({
  id: 'sysinfo', name: '系统信息', icon: 'monitor', desc: '硬件、系统版本、内存与显卡一览',
  fields: [],
  async run() {
    const r = await U.psJson(`
      $cs = Get-CimInstance Win32_ComputerSystem
      $os = Get-CimInstance Win32_OperatingSystem
      $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
      # 显卡名从注册表读：Get-CimInstance Win32_VideoController 在这台机器上要 10 秒
      $gpu = (Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue |
        ForEach-Object { (Get-ItemProperty $_.PSPath -Name DriverDesc -ErrorAction SilentlyContinue).DriverDesc } |
        Where-Object { $_ }) -join ' / '
      $board = Get-CimInstance Win32_BaseBoard
      [pscustomobject]@{
        brand = $cs.Manufacturer; model = $cs.Model
        os = $os.Caption; version = $os.Version; build = $os.BuildNumber
        arch = $os.OSArchitecture
        install = ([datetime]$os.InstallDate).ToString('yyyy-MM-dd')
        boot = ([datetime]$os.LastBootUpTime).ToString('yyyy-MM-dd HH:mm')
        uptime = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
        cpu = $cpu.Name; cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors
        gpu = $gpu
        board = ($board.Manufacturer + ' ' + $board.Product)
        ramTotal = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
        ramFree = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
        pageTotal = [math]::Round($os.TotalVirtualMemorySize / 1MB, 1)
        pageFree = [math]::Round($os.FreeVirtualMemory / 1MB, 1)
        user = $env:USERNAME; pc = $env:COMPUTERNAME
        admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
      }`, { timeout: 30000 });
    const disks = U.diskInfo();
    return { info: r || {}, disks };
  },
});

/* ---------- 2. 启动项 ---------- */
const RUN_KEYS = [
  { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', scope: 'hkcu' },
  { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce', scope: 'hkcu' },
  { hive: 'HKLM', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', scope: 'hklm' },
  { hive: 'HKLM', key: 'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', scope: 'hklm' },
];
const DISABLED_ROOT = 'HKCU\\Software\\JingJie\\Disabled';

/** 从命令行里挑出可执行文件路径（处理引号、参数、环境变量、快捷方式） */
function exeOf(cmd) {
  let s = String(cmd || '').trim();
  s = s.replace(/^"([^"]+\.(exe|bat|cmd|lnk|url))".*$/i, '$1');
  if (/^"/.test(s)) { s = s.slice(1, s.indexOf('"', 1) > 0 ? s.indexOf('"', 1) : undefined); }
  else {
    const m = s.match(/^(.*?\.(exe|bat|cmd|lnk|url))(\s|$)/i);
    if (m) s = m[1];
  }
  s = s.replace(/%([^%]+)%/g, (all, k) => process.env[k] || all);
  return s.trim();
}

/** 读启动项背后的程序信息：版本信息 + 数字签名 + 文件属性 */
async function inspectStartup(cmd) {
  let target = exeOf(cmd);
  let viaLnk = '';
  const isLnk = /\.lnk$/i.test(target);
  if (isLnk) {
    viaLnk = target;
    const r = await U.ps("$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + target.replace(/'/g, "''") + "'); $s.TargetPath", { timeout: 15000 });
    const t = (r.out || '').trim();
    if (t) target = t;
  }
  const st = U.statSafe ? U.statSafe(target) : null;
  const exists = !!(st && st.isFile());
  const info = { cmd: String(cmd || ''), path: target, viaLnk, exists, company: '', product: '', desc: '', version: '', signer: '', sigStatus: '', size: st ? st.size : 0, mtime: st ? st.mtime : '' };
  if (!exists) return info;
  const esc = target.replace(/'/g, "''");
  const r = await U.psJson(
    "$f='" + esc + "'; $v=[Diagnostics.FileVersionInfo]::GetVersionInfo($f); " +
    "$s=Get-AuthenticodeSignature $f; " +
    "[pscustomobject]@{company=$v.CompanyName; product=$v.ProductName; desc=$v.FileDescription; version=$v.FileVersion; " +
    "orig=$v.OriginalFilename; signer=($s.SignerCertificate.Subject -replace '^CN=([^,]+).*','$1'); sig=$s.Status.ToString() }",
    { timeout: 25000 }
  );
  if (r && !Array.isArray(r)) {
    info.company = r.company || ''; info.product = r.product || ''; info.desc = r.desc || '';
    info.version = r.version || ''; info.sigStatus = r.sig || ''; info.signer = r.signer || '';
    info.orig = r.orig || '';
  }
  return info;
}

tool({
  id: 'startup', name: '启动项管理', icon: 'power', desc: '查看并禁用开机自启动程序（可随时恢复）',
  fields: [],
  async run() {
    const list = [];
    for (const k of RUN_KEYS) {
      const r = await U.run('reg', ['query', k.hive + '\\' + k.key], { timeout: 8000 });
      if (r.code !== 0) continue;
      for (const line of U.splitLines(r.out)) {
        const m = line.match(/^\s{4}(.+?)\s+REG_SZ\s+(.*)$/);
        if (!m) continue;
        const name = m[1].trim(), cmd = m[2].trim();
        if (/^(default|默认)$/i.test(name)) continue;
        list.push({ id: k.hive + '|' + k.key + '|' + name, name, cmd, scope: k.scope, where: k.hive === 'HKCU' ? '当前用户' : '所有用户', enabled: true, kind: 'run' });
      }
    }
    // 启动文件夹
    const folders = [path.join(U.ROAM, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')];
    for (const f of folders) {
      let ents = [];
      try { ents = await fsp.readdir(f); } catch (e) { }
      for (const n of ents) {
        if (n.toLowerCase() === 'desktop.ini') continue;
        list.push({ id: 'FOLDER|' + path.join(f, n), name: n.replace(/\.(lnk|url)$/i, ''), cmd: path.join(f, n), scope: f.startsWith(U.ROAM) ? 'hkcu' : 'hklm', where: '启动文件夹', enabled: true, kind: 'folder' });
      }
    }
    // 已禁用项
    const dis = await U.run('reg', ['query', DISABLED_ROOT, '/s'], { timeout: 12000 });
    if (dis.code === 0) {
      let cur = '';
      for (const line of U.splitLines(dis.out)) {
        if (line.startsWith('HKEY_')) { cur = line.trim(); continue; }
        const m = line.match(/^\s{4}(.+?)\s+REG_SZ\s+(.*)$/);
        if (!m || !cur) continue;
        const parts = cur.split('\\');
        const name = m[1].trim();
        list.push({ id: parts.slice(parts.indexOf('Disabled') + 1).join('|'), name, cmd: m[2], scope: cur.includes('HKLM') ? 'hklm' : 'hkcu', where: '已禁用', enabled: false, kind: 'run' });
      }
    }
    return { items: list };
  },
  async action(p) {
    /* 查询某个启动项到底是什么：解析出 exe、读版本信息与数字签名 */
    if (p.cmd === 'inspect') {
      const raw = String(p.target || '').trim();
      const info = await inspectStartup(raw);
      return { ok: true, info };
    }
    const it = p.item;
    if (!it) throw new Error('缺少启动项');
    if (it.kind === 'folder') {
      const disabledDir = path.join(U.ROAM, 'JingJie', 'DisabledStartup');
      await fsp.mkdir(disabledDir, { recursive: true });
      const target = path.join(disabledDir, path.basename(it.cmd));
      if (it.enabled) { await U.moveEntry(it.cmd, target + '.disabled'); return { ok: true, enabled: false }; }
      const src = it.cmd.endsWith('.disabled') ? it.cmd : it.cmd + '.disabled';
      await U.moveEntry(src, path.join(path.dirname(it.cmd), path.basename(it.cmd).replace(/\.disabled$/, '')));
      return { ok: true, enabled: true };
    }
    const [hive, key, name] = it.id.split('|');
    if (it.enabled) {
      await U.run('reg', ['add', DISABLED_ROOT + '\\' + hive + '\\' + key.replace(/\\/g, '_'), '/v', name, '/t', 'REG_SZ', '/d', it.cmd, '/f'], { timeout: 8000 });
      const r = await U.run('reg', ['delete', hive + '\\' + key, '/v', name, '/f'], { timeout: 8000 });
      if (r.code !== 0) throw new Error('需要管理员权限');
      return { ok: true, enabled: false };
    }
    const r = await U.run('reg', ['add', hive + '\\' + key, '/v', name, '/t', 'REG_SZ', '/d', it.cmd, '/f'], { timeout: 8000 });
    if (r.code !== 0) throw new Error('需要管理员权限');
    await U.run('reg', ['delete', DISABLED_ROOT + '\\' + hive + '\\' + key.replace(/\\/g, '_'), '/v', name, '/f'], { timeout: 8000 });
    return { ok: true, enabled: true };
  },
});

/* ---------- 3. 服务优化 ---------- */
const SERVICE_LIST = [
  { name: 'DiagTrack', title: '诊断跟踪服务', desc: '向微软发送遥测数据，可关闭', safe: true },
  { name: 'dmwappushservice', title: 'WAP 推送消息路由', desc: '遥测相关，可关闭', safe: true },
  { name: 'MapsBroker', title: '地图下载管理', desc: '离线地图下载，一般不用', safe: true },
  { name: 'lfsvc', title: '地理位置服务', desc: '定位功能，不用可关闭', safe: true },
  { name: 'WSearch', title: 'Windows 搜索索引', desc: '关闭后开始菜单搜索变慢，但可释放大量磁盘与内存', safe: false },
  { name: 'SysMain', title: '超级预读', desc: '机械硬盘有益，SSD 可关闭', safe: false },
  { name: 'PrintNotify', title: '打印通知', desc: '不打印可关闭', safe: true },
  { name: 'Fax', title: '传真服务', desc: '几乎不用', safe: true },
  { name: 'RemoteRegistry', title: '远程注册表', desc: '建议保持禁用', safe: true },
  { name: 'seclogon', title: '辅助登录', desc: '「以其他用户身份运行」依赖，一般可关闭', safe: false },
  { name: 'XblAuthManager', title: 'Xbox 身份验证', desc: '不玩游戏可关闭', safe: true },
  { name: 'XblGameSave', title: 'Xbox 云存档', desc: '不玩游戏可关闭', safe: true },
  { name: 'XboxNetApiSvc', title: 'Xbox 网络服务', desc: '不玩游戏可关闭', safe: true },
  { name: 'TabletInputService', title: '触摸键盘与手写', desc: '无触摸屏可关闭', safe: false },
  { name: 'WMPNetworkSvc', title: '媒体共享', desc: '局域网媒体共享，不用可关闭', safe: true },
  { name: 'Spooler', title: '打印后台处理', desc: '关闭后无法打印（有安全漏洞时临时关闭）', safe: false },
  { name: 'BthAvctpSvc', title: '蓝牙音频', desc: '蓝牙耳机用户勿关', safe: false },
];

tool({
  id: 'services', name: '服务优化', icon: 'settings', desc: '按需启停常见系统服务，附用途说明',
  fields: [],
  async run() {
    /* 一次性取服务状态 + 一次性取启动类型（逐个 Get-CimInstance 太慢，17 个要十几秒） */
    const names = SERVICE_LIST.map((s) => "'" + s.name + "'").join(',');
    const script = "$o=@(); foreach($n in @(" + names + ")){try{$svc=Get-Service -Name $n -ErrorAction Stop;$o+=[pscustomobject]@{name=$n;status=[string]$svc.Status;start='-'}}catch{}};" +
      "$c=@{};try{Get-CimInstance Win32_Service | ForEach-Object{$c[$_.Name]=$_.StartMode}}catch{};" +
      "foreach($i in $o){if($c.ContainsKey($i.name)){$i.start=$c[$i.name]}}; $o";
    const r = await U.psJson(script, { timeout: 30000 });
    const raw = Array.isArray(r) ? r : (r ? [r] : []);
    const map = new Map(raw.map((x) => [x.name, x]));
    return {
      items: SERVICE_LIST.map((s) => {
        const st = map.get(s.name) || {};
        return Object.assign({}, s, { status: st.status || '未安装', startMode: st.start || '-' });
      }),
    };
  },
  async action(p) {
    if (!p.name) throw new Error('缺少服务名');
    const cmd = p.cmd;
    let r;
    if (cmd === 'start') r = await U.run('net', ['start', p.name], { timeout: 30000 });
    else if (cmd === 'stop') r = await U.run('net', ['stop', p.name], { timeout: 30000 });
    else if (cmd === 'disable') r = await U.run('sc', ['config', p.name, 'start=', 'disabled'], { timeout: 15000 });
    else if (cmd === 'manual') r = await U.run('sc', ['config', p.name, 'start=', 'demand'], { timeout: 15000 });
    else if (cmd === 'auto') r = await U.run('sc', ['config', p.name, 'start=', 'auto'], { timeout: 15000 });
    else throw new Error('未知操作');
    return { ok: r.code === 0, out: (r.out + r.err).trim().slice(0, 400) };
  },
});

/* ---------- 4. 右键菜单 ---------- */
const CTX_CLASSES = [
  { key: 'HKCR\\*\\shell', label: '文件' },
  { key: 'HKCR\\Directory\\shell', label: '文件夹' },
  { key: 'HKCR\\Directory\\Background\\shell', label: '桌面/文件夹空白处' },
  { key: 'HKCR\\Drive\\shell', label: '驱动器' },
];

tool({
  id: 'ctxmenu', name: '右键菜单管理', icon: 'menu', desc: '隐藏多余的右键菜单项（可随时恢复）',
  fields: [],
  async run() {
    const out = [];
    for (const c of CTX_CLASSES) {
      const r = await U.run('reg', ['query', c.key], { timeout: 8000 });
      if (r.code !== 0) continue;
      const names = [];
      for (const line of U.splitLines(r.out)) {
        if (!line.startsWith('HKEY_')) continue;
        const name = line.split('\\').pop();
        if (name.toLowerCase() === 'shell') continue;
        names.push(name);
      }
      for (const n of names) {
        const rv = await U.run('reg', ['query', c.key + '\\' + n, '/s'], { timeout: 8000 });
        let title = n, cmd = '', blocked = false;
        for (const line of U.splitLines(rv.out)) {
          const m = line.match(/^\s{4}(MUIVerb|@|=|Position)\s+(\S+)\s+(.*)$/);
          if (m) { if (m[1] === 'MUIVerb' || m[1] === '@') title = m[3] || m[2]; }
          const mm = line.match(/^\s{4}LegacyDisable\s+REG_SZ/);
          if (mm) blocked = true;
          const mc = line.match(/command\s+REG_SZ\s+(.*)$/i);
          if (mc) cmd = mc[1];
        }
        if (title.startsWith('@')) title = path.basename(title.replace(/^@/, '')).replace(/,-?\d+$/, '');
        out.push({ id: c.key + '|' + n, name: title || n, key: n, label: c.label, cmd, blocked });
      }
    }
    return { items: out };
  },
  async action(p) {
    const [key, name] = p.id.split('|');
    if (p.enabled === false) {
      const r = await U.run('reg', ['add', key + '\\' + name, '/v', 'LegacyDisable', '/t', 'REG_SZ', '/d', '', '/f'], { timeout: 8000 });
      return { ok: r.code === 0 };
    }
    const r = await U.run('reg', ['delete', key + '\\' + name, '/v', 'LegacyDisable', '/f'], { timeout: 8000 });
    return { ok: true };
  },
});

/* ---------- 5. 大文件查找 ---------- */
tool({
  id: 'bigfiles', name: '大文件查找', icon: 'search', desc: '按大小揪出占空间的大文件',
  fields: [
    { key: 'root', label: '扫描位置', type: 'path', def: 'C:\\' },
    { key: 'minSize', label: '最小体积 (MB)', type: 'number', def: 200 },
    { key: 'limit', label: '显示条数', type: 'number', def: 100 },
  ],
  async run(p) {
    const root = p.root || 'C:\\';
    const minSize = (parseInt(p.minSize, 10) || 200) * 1024 * 1024;
    const limit = parseInt(p.limit, 10) || 100;
    const files = await walkFiles(root, { minSize, maxDepth: 12 });
    files.sort((a, b) => b.size - a.size);
    return { total: files.length, files: files.slice(0, limit).map((f) => ({ path: f.path, size: f.size, mtime: f.mtime })) };
  },
});

/* ---------- 6. 重复文件 ---------- */
tool({
  id: 'dupfiles', name: '重复文件', icon: 'copy', desc: '按内容找出一模一样的文件',
  fields: [
    { key: 'root', label: '扫描位置', type: 'path', def: '' },
    { key: 'minSize', label: '最小体积 (KB)', type: 'number', def: 64 },
  ],
  async run(p) {
    const root = p.root || U.USER;
    const minSize = (parseInt(p.minSize, 10) || 64) * 1024;
    const files = await walkFiles(root, { minSize, maxDepth: 10 });
    const bySize = new Map();
    for (const f of files) {
      if (!bySize.has(f.size)) bySize.set(f.size, []);
      bySize.get(f.size).push(f);
    }
    const groups = [];
    for (const [size, arr] of bySize) {
      if (arr.length < 2) continue;
      const byHash = new Map();
      for (const f of arr) {
        let h = '';
        try {
          const fd = await fsp.open(f.path, 'r');
          const buf = Buffer.alloc(Math.min(size, 65536));
          await fd.read(buf, 0, buf.length, 0);
          await fd.close();
          h = crypto.createHash('md5').update(buf).digest('hex') + ':' + size;
        } catch (e) { continue; }
        if (!byHash.has(h)) byHash.set(h, []);
        byHash.get(h).push(f);
      }
      for (const [, same] of byHash) {
        if (same.length < 2) continue;
        groups.push({ size, hash: 'x', files: same.map((f) => f.path) });
      }
    }
    groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
    return { groups: groups.slice(0, 200), waste: groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0) };
  },
  async action(p) {
    let freed = 0, n = 0;
    for (const f of p.files || []) {
      const r = await U.removeEntry(f);
      if (r.ok) { n++; }
    }
    return { ok: true, removed: n };
  },
});

/* ---------- 7. 空文件夹 ---------- */
tool({
  id: 'emptyfolders', name: '空文件夹', icon: 'folder', desc: '找出没有任何文件的空目录并批量删除',
  fields: [{ key: 'root', label: '扫描位置', type: 'path', def: '' }],
  async run(p) {
    const root = p.root || U.USER;
    const out = [];
    const stack = [{ d: root, depth: 0 }];
    while (stack.length) {
      const { d, depth } = stack.pop();
      if (depth > 8) continue;
      let ents;
      try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
      if (ents.length === 0) { out.push(d); continue; }
      for (const e of ents) {
        if (e.isDirectory() && !e.isSymbolicLink()) stack.push({ d: path.join(d, e.name), depth: depth + 1 });
      }
      if (out.length > 800) break;
    }
    return { folders: out };
  },
  async action(p) {
    let n = 0;
    for (const f of p.folders || []) { try { await fsp.rmdir(f); n++; } catch (e) { } }
    return { ok: true, removed: n };
  },
});

/* ---------- 8. 磁盘空间分析 ---------- */
tool({
  id: 'diskusage', name: '空间分析', icon: 'pie', desc: '看清哪个文件夹最占空间',
  fields: [{ key: 'root', label: '分析位置', type: 'path', def: 'C:\\' }],
  async run(p) {
    const root = p.root || 'C:\\';
    let ents = [];
    try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch (e) { return { items: [] }; }
    const items = [];
    for (const e of ents) {
      const full = path.join(root, e.name);
      if (e.isDirectory()) {
        const r = await U.walkUsage(full, { concurrency: 12 });
        items.push({ name: e.name, path: full, size: r.size, files: r.files, dir: true });
      } else if (e.isFile()) {
        const s = U.sizeSafe(full);
        if (s > 0) items.push({ name: e.name, path: full, size: s, files: 1, dir: false });
      }
    }
    items.sort((a, b) => b.size - a.size);
    return { root, items: items.slice(0, 30) };
  },
});

/* ---------- 9. 进程管理 ---------- */
tool({
  id: 'processes', name: '进程管理', icon: 'activity', desc: '按内存/CPU 排序查看并结束进程',
  fields: [],
  async run() {
    const r = await U.psJson("Get-Process | Sort-Object -Descending WorkingSet64 | Select-Object -First 60 Id,ProcessName,@{n='mem';e={[math]::Round($_.WorkingSet64/1MB,1)}},@{n='cpu';e={[math]::Round($_.CPU,1)}},Path", { timeout: 30000 });
    const arr = Array.isArray(r) ? r : (r ? [r] : []);
    return { items: arr.filter(Boolean) };
  },
  async action(p) {
    if (!p.pid) throw new Error('缺少进程 ID');
    try { process.kill(Number(p.pid), 'SIGTERM'); return { ok: true }; }
    catch (e) {
      const r = await U.run('taskkill', ['/PID', String(p.pid), '/F'], { timeout: 10000 });
      return { ok: r.code === 0, out: (r.out + r.err).trim() };
    }
  },
});

/* ---------- 10. 网络工具 ---------- */
tool({
  id: 'network', name: '网络诊断', icon: 'wifi', desc: '刷新 DNS、测延迟、查本机网络信息',
  fields: [{ key: 'host', label: '测试目标', type: 'text', def: 'www.baidu.com' }],
  async run(p) {
    const host = p.host || 'www.baidu.com';
    const ping = await U.run('ping', ['-n', '4', host], { timeout: 20000, enc: 'gbk' });
    const info = await U.psJson("[pscustomobject]@{ip=((Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '127.*'} | Select-Object -First 1).IPAddress); gw=((Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1).NextHop); dns=((Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object {$_.ServerAddresses} | Select-Object -First 1).ServerAddresses -join ', '); mac=((Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1).MacAddress)}", { timeout: 20000 });
    return { host, ping: (ping.out || '').trim(), info: info || {} };
  },
  async action(p) {
    if (p.cmd === 'flushdns') { const r = await U.run('ipconfig', ['/flushdns'], { timeout: 20000, enc: 'gbk' }); return { ok: r.code === 0 }; }
    if (p.cmd === 'release') { const r = await U.run('ipconfig', ['/release'], { timeout: 30000, enc: 'gbk' }); return { ok: r.code === 0 }; }
    if (p.cmd === 'renew') { const r = await U.run('ipconfig', ['/renew'], { timeout: 60000, enc: 'gbk' }); return { ok: r.code === 0 }; }
    return { ok: false };
  },
});

/* ---------- 11. 文件粉碎 ---------- */
tool({
  id: 'shred', name: '文件粉碎', icon: 'trash', desc: '覆盖写入后删除，防止被恢复（不可逆）',
  fields: [{ key: 'target', label: '文件或文件夹', type: 'path', def: '' }],
  async run(p) { return { target: p.target || '' }; },
  async action(p) {
    const target = p.target;
    if (!target || !U.exists(target)) throw new Error('路径不存在');
    const stat = U.statSafe(target);
    const files = [];
    if (stat.isDirectory()) {
      const list = await walkFiles(target, { maxDepth: 20 });
      for (const f of list) files.push(f.path);
    } else files.push(target);
    let done = 0;
    for (const f of files) {
      try {
        const st = U.statSafe(f);
        if (st && st.isFile() && st.size > 0) {
          const size = Math.min(st.size, 8 * 1024 * 1024);
          const fd = await fsp.open(f, 'r+');
          for (let pass = 0; pass < 3; pass++) {
            const buf = crypto.randomBytes(Math.min(size, 65536));
            for (let off = 0; off < st.size; off += buf.length) await fd.write(buf, 0, Math.min(buf.length, st.size - off), off);
          }
          await fd.close();
        }
        await fsp.rm(f, { force: true });
        done++;
      } catch (e) { }
    }
    if (stat.isDirectory()) { try { await fsp.rm(target, { recursive: true, force: true }); } catch (e) { } }
    return { ok: true, files: done };
  },
});

/* ---------- 12. 电源与定时 ---------- */
tool({
  id: 'power', name: '电源工具', icon: 'bolt', desc: '定时关机、重启、锁屏、睡眠',
  fields: [{ key: 'seconds', label: '倒计时（秒）', type: 'number', def: 60 }],
  async run() {
    const r = await U.run('powercfg', ['/a'], { timeout: 10000 });
    return { plans: (r.out || '').trim() };
  },
  async action(p) {
    const s = Math.max(0, parseInt(p.seconds, 10) || 0);
    let r;
    if (p.cmd === 'shutdown') r = await U.run('shutdown', ['/s', '/t', String(s)], { timeout: 10000 });
    else if (p.cmd === 'restart') r = await U.run('shutdown', ['/r', '/t', String(s)], { timeout: 10000 });
    else if (p.cmd === 'abort') r = await U.run('shutdown', ['/a'], { timeout: 10000 });
    else if (p.cmd === 'lock') r = await U.run('rundll32.exe', ['user32.dll,LockWorkStation'], { timeout: 10000 });
    else if (p.cmd === 'sleep') r = await U.run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { timeout: 10000 });
    else throw new Error('未知操作');
    return { ok: r.code === 0 };
  },
});

/* ---------- 13. 开机耗时 ---------- */
tool({
  id: 'boottime', name: '开机耗时', icon: 'clock', desc: '查看最近几次开机用了多久',
  fields: [],
  async run() {
    const r = await U.psJson("try { Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Diagnostics-Performance/Operational'; Id=100} -MaxEvents 10 -ErrorAction Stop | ForEach-Object { [pscustomobject]@{ time=$_.TimeCreated.ToString('yyyy-MM-dd HH:mm'); ms=([xml]$_.ToXml()).Event.EventData.Data | Where-Object {$_.Name -eq 'BootTime'} | Select-Object -ExpandProperty '#text' } } } catch { @() }", { timeout: 60000 });
    const arr = Array.isArray(r) ? r : (r ? [r] : []);
    const items = arr.filter(Boolean);
    if (!items.length) {
      /* 这台机器没有「开机性能」事件日志（有些系统精简掉了），退回上一次启动时间 */
      const last = await U.psJson("[pscustomobject]@{ time=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('yyyy-MM-dd HH:mm'); ms=$null }");
      return { items: last ? [last] : [], note: '系统未记录开机性能事件（Diagnostics-Performance 日志不存在），只能显示上次启动时间。' };
    }
    return { items };
  },
});

/* ---------- 14. 环境变量 ---------- */
tool({
  id: 'envvars', name: '环境变量', icon: 'code', desc: '查看与编辑当前用户的 PATH 与环境变量',
  fields: [],
  async run() {
    const r = await U.run('reg', ['query', 'HKCU\\Environment'], { timeout: 8000 });
    const items = [];
    for (const line of U.splitLines(r.out)) {
      const m = line.match(/^\s{4}(.+?)\s+REG_(SZ|EXPAND_SZ)\s+(.*)$/);
      if (m) items.push({ name: m[1].trim(), value: m[3], type: m[2] });
    }
    return { items, pathList: (items.find((i) => i.name.toUpperCase() === 'PATH') || {}).value || '' };
  },
  async action(p) {
    if (p.cmd === 'set') {
      const r = await U.run('reg', ['add', 'HKCU\\Environment', '/v', p.name, '/t', 'REG_EXPAND_SZ', '/d', p.value, '/f'], { timeout: 8000 });
      return { ok: r.code === 0 };
    }
    if (p.cmd === 'del') {
      const r = await U.run('reg', ['delete', 'HKCU\\Environment', '/v', p.name, '/f'], { timeout: 8000 });
      return { ok: r.code === 0 };
    }
    return { ok: false };
  },
});

/* ---------- 15. 系统还原点 ---------- */
tool({
  id: 'restore', name: '系统还原', icon: 'history', desc: '创建 / 查看系统还原点',
  fields: [{ key: 'desc', label: '还原点说明', type: 'text', def: '净界手动创建' }],
  async run() {
    const r = await U.psJson("try { Get-ComputerRestorePoint | Select-Object SequenceNumber,@{n='time';e={$_.ConvertToDateTime($_.CreationTime).ToString('yyyy-MM-dd HH:mm')}},Description } catch { @() }", { timeout: 40000 });
    const arr = Array.isArray(r) ? r : (r ? [r] : []);
    return { items: arr.filter(Boolean) };
  },
  async action(p) {
    if (p.cmd === 'create') {
      const r = await U.ps("Checkpoint-Computer -Description '" + (p.desc || '净界') + "' -RestorePointType 'MODIFY_SETTINGS'; 'ok'", { timeout: 300000 });
      return { ok: (r.out || '').includes('ok'), out: (r.err || '').trim().slice(0, 300) };
    }
    return { ok: false };
  },
});

/* ---------- 16. hosts 文件 ---------- */
tool({
  id: 'hosts', name: 'Hosts 编辑', icon: 'globe', desc: '查看与编辑 hosts（自动备份原文件）',
  fields: [],
  async run() {
    const p = path.join(U.WINDIR, 'System32', 'drivers', 'etc', 'hosts');
    let content = '';
    try { content = await fsp.readFile(p, 'utf8'); } catch (e) { content = '（无法读取，需要管理员权限）'; }
    const backups = [];
    const dir = path.join(U.ROAM, 'JingJie', 'hosts-backup');
    try { backups.push(...(await fsp.readdir(dir)).sort().reverse().slice(0, 10)); } catch (e) { }
    return { path: p, content, backups };
  },
  async action(p) {
    const hosts = path.join(U.WINDIR, 'System32', 'drivers', 'etc', 'hosts');
    if (p.cmd === 'save') {
      const dir = path.join(U.ROAM, 'JingJie', 'hosts-backup');
      await fsp.mkdir(dir, { recursive: true });
      try { await fsp.copyFile(hosts, path.join(dir, 'hosts.' + Date.now() + '.bak')); } catch (e) { }
      try { await fsp.writeFile(hosts, p.content || '', 'utf8'); return { ok: true }; }
      catch (e) { return { ok: false, error: '需要以管理员身份运行' }; }
    }
    return { ok: false };
  },
});

/* ---------- 17. 系统修复 ---------- */
const repairJobs = new Map();

tool({
  id: 'repair', name: '系统修复', icon: 'wrench', desc: 'SFC 扫描修复、DISM 映像修复、磁盘检查',
  fields: [],
  async run() {
    const jobs = [];
    for (const [id, j] of repairJobs) jobs.push({ id, cmd: j.cmd, running: j.running, log: (j.log || '').slice(-4000) });
    return { jobs, admin: await U.isAdmin() };
  },
  async action(p) {
    const cmds = {
      sfc: 'sfc /scannow',
      dism: 'DISM /Online /Cleanup-Image /RestoreHealth',
      chkdsk: 'chkdsk C: /scan',
      defrag: 'defrag C: /O /U',
    };
    const cmd = p.cmd;
    if (!cmds[cmd]) throw new Error('未知命令');
    const id = cmd;
    const j = { cmd, running: true, log: '' };
    repairJobs.set(id, j);
    U.run('cmd.exe', ['/c', cmds[cmd]], { timeout: 3600000, onLine: (l) => { j.log += l + '\n'; } }).then((r) => {
      j.running = false;
      j.log += '\n[结束] 退出码 ' + r.code + '\n';
    });
    return { ok: true, id };
  },
  async status(p) {
    const j = repairJobs.get(p.id);
    if (!j) return { running: false, log: '' };
    return { running: j.running, log: (j.log || '').slice(-8000) };
  },
});

module.exports = {
  list: () => tools.map((t) => ({ id: t.id, name: t.name, icon: t.icon, desc: t.desc, fields: t.fields || [] })),
  find: (id) => tools.find((t) => t.id === id),
};
