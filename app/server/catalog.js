'use strict';
/* 净界 - 清理项目录（所有可清理位置的权威定义） */
const fs = require('fs');
const path = require('path');
const U = require('./util');

const { isDir, exists, DOCS, LOCAL, ROAM, WINDIR, PROGRAMDATA, USER } = U;

function listDirs(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(p, d.name)); }
  catch (e) { return []; }
}
function uniq(arr) {
  const seen = new Set(), out = [];
  for (const x of arr) { const k = x.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

/* ---------------- 账号 / 安装目录探测 ---------------- */

function wechatAccounts() {
  const roots = uniq([
    path.join(DOCS, 'xwechat_files'),
    path.join(USER, 'Documents', 'xwechat_files'),
    path.join(DOCS, 'WeChat Files'),
    path.join(USER, 'Documents', 'WeChat Files'),
  ]);
  const out = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    const v4 = root.toLowerCase().endsWith('xwechat_files');
    for (const p of listDirs(root)) {
      const name = path.basename(p);
      if (name.toLowerCase() === 'all_users') continue;
      const looks = isDir(path.join(p, 'msg')) || isDir(path.join(p, 'FileStorage')) || isDir(path.join(p, 'cache')) || isDir(path.join(p, 'db_storage'));
      if (!looks) continue;
      out.push({ root: p, name, kind: v4 ? 'v4' : 'v3' });
    }
  }
  const seen = new Set();
  return out.filter((a) => { const k = a.root.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

function wechatBaseDir() {
  for (const r of [path.join(DOCS, 'xwechat_files'), path.join(USER, 'Documents', 'xwechat_files'), path.join(DOCS, 'WeChat Files'), path.join(USER, 'Documents', 'WeChat Files')]) {
    if (isDir(r)) return r;
  }
  return null;
}

function qqAccounts() {
  const roots = uniq([
    path.join(DOCS, 'Tencent Files'),
    path.join(USER, 'Documents', 'Tencent Files'),
  ]);
  const out = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const p of listDirs(root)) {
      const name = path.basename(p);
      const low = name.toLowerCase();
      if (low === 'all users') continue;
      if (low === 'nt_qq') { out.push({ root: p, name: 'QQNT', kind: 'nt' }); continue; }
      if (/^\d{5,12}$/.test(name)) {
        /* 新版 QQ 会把 nt_qq 套在数字账号目录里（如 1554335113\nt_qq），按 NT 结构处理 */
        const inner = path.join(p, 'nt_qq');
        if (isDir(inner)) out.push({ root: inner, name, kind: 'nt' });
        else out.push({ root: p, name, kind: 'legacy' });
      }
    }
  }
  const seen = new Set();
  return out.filter((a) => { const k = a.root.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

function browserCacheTargets() {
  const t = [];
  const edge = path.join(LOCAL, 'Microsoft', 'Edge', 'User Data');
  if (isDir(edge)) {
    for (const prof of listDirs(edge)) {
      const b = path.basename(prof);
      if (!/^(Default|Profile \d+|Guest Profile|System Profile)$/i.test(b)) continue;
      t.push(path.join(prof, 'Cache'), path.join(prof, 'Code Cache'), path.join(prof, 'GPUCache'),
        path.join(prof, 'Service Worker', 'CacheStorage'), path.join(prof, 'Service Worker', 'ScriptCache'),
        path.join(prof, 'DawnGraphiteCache'), path.join(prof, 'GrShaderCache'), path.join(prof, 'ShaderCache'),
        path.join(prof, 'CacheStorage'));
    }
    /* 根级的着色器缓存与崩溃报告不属于任何 profile */
    for (const sub of ['ShaderCache', 'GrShaderCache', 'Crashpad', 'component_crx_cache', 'extensions_crx_cache']) {
      t.push(path.join(edge, sub));
    }
  }
  return t.map((p) => T(p));
}
function chromeCacheTargets() {
  const t = [];
  for (const base of [path.join(LOCAL, 'Google', 'Chrome', 'User Data'), path.join(LOCAL, 'Chromium', 'User Data'), path.join(LOCAL, '360Chrome', 'Chrome', 'User Data'), path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data')]) {
    if (!isDir(base)) continue;
    for (const prof of listDirs(base)) {
      const b = path.basename(prof);
      if (!/^(Default|Profile \d+|Guest Profile|System Profile)$/i.test(b)) continue;
      t.push(path.join(prof, 'Cache'), path.join(prof, 'Code Cache'), path.join(prof, 'GPUCache'), path.join(prof, 'Service Worker', 'CacheStorage'), path.join(prof, 'GrShaderCache'));
    }
  }
  return t.map((p) => T(p));
}
function firefoxCacheTargets() {
  const out = [];
  for (const base of [path.join(LOCAL, 'Mozilla', 'Firefox', 'Profiles'), path.join(ROAM, 'Mozilla', 'Firefox', 'Profiles')]) {
    if (!isDir(base)) continue;
    for (const prof of listDirs(base)) out.push(path.join(prof, 'cache2'));
  }
  return out.map((p) => T(p));
}

function steamPaths() {
  const out = [];
  try {
    const r = fs.readFileSync(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steamapps', 'libraryfolders.vdf'), 'utf8');
    out.push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'));
    for (const m of r.matchAll(/"path"\s+"([^"]+)"/g)) out.push(m[1].replace(/\\\\/g, '\\'));
  } catch (e) { }
  for (const p of [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), 'D:\\Steam', 'E:\\Steam', 'D:\\SteamLibrary']) out.push(p);
  return uniq(out.filter((p) => isDir(p)));
}

/* ---------------- 项目构造辅助 ---------------- */

function T(p, mode, extra) { return Object.assign({ path: p, mode: mode || 'contents' }, extra || {}); }
function dirs(list) { return list.map((p) => T(p, 'contents')); }
function files(list) { return list.map((p) => T(p, 'file')); }

/* 百度网盘：主程序把浏览器内核缓存放在 Roaming\BaiduNetdisk 下 */
function baiduNetdiskTargets() {
  const t = [];
  for (const base of [path.join(ROAM, 'BaiduNetdisk'), path.join(ROAM, 'baidu', 'BaiduNetdisk'), path.join(LOCAL, 'baidu', 'BaiduNetdisk')]) {
    if (!isDir(base)) continue;
    for (const sub of ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'blob_storage', 'ShaderCache', 'GrShaderCache']) {
      t.push(path.join(base, sub));
    }
    for (const sub of ['log', 'logs']) t.push(path.join(base, sub));
  }
  return t.map((p) => T(p));
}
/* 百度网盘中断下载后残留的临时文件 */
function baiduTempTargets() {
  const out = [];
  for (const root of [DOCS, path.join(USER, 'Downloads'), path.join(USER, 'Desktop')]) {
    if (!isDir(root)) continue;
    try {
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (!e.isFile()) continue;
        if (/\.baiduyun\.downloading(\.cfg)?$/i.test(e.name)) out.push(T(path.join(root, e.name), 'file'));
      }
    } catch (err) { }
  }
  return out;
}
/* 剪映：缓存与日志可删，草稿（Projects / Drafts）绝不能动 */
function jianyingTargets() {
  const t = [];
  const bases = [path.join(LOCAL, 'JianyingPro', 'User Data'), path.join(ROAM, 'JianyingPro', 'User Data')];
  for (const base of bases) {
    if (!isDir(base)) continue;
    for (const sub of ['Cache', 'Log', 'CEF', 'Crash', 'TTNet', 'VELog', 'LVOPTmp', 'ByteBench']) {
      t.push(path.join(base, sub));
    }
  }
  return t.map((p) => T(p));
}
/* 开发工具下载缓存（删掉后重装依赖会重新下载） */
function devCacheTargets() {
  const t = [];
  for (const sub of ['npm-cache', 'yarn-cache', 'pnpm-cache', 'pip\\Cache', 'NuGet\\v3-cache', 'node-gyp', 'electron', 'electron-builder']) {
    t.push(path.join(LOCAL, sub));
  }
  return t.map((p) => T(p));
}
function devHeavyTargets() {
  return [T(path.join(USER, '.gradle', 'caches')), T(path.join(USER, '.m2', 'repository'))];
}

function item(o) {
  return Object.assign({ risk: 'safe', def: true, admin: false, age: false, hint: '', targets: () => [] }, o);
}


/* ---------------- 注册表 ---------------- */
function regGroup() {
  const items = [
    item({
      id: 'reg_uninstall', name: '卸载残留', risk: 'safe', def: true, unit: '项',
      hint: '已卸载软件的注册表记录：安装目录和卸载程序都不在了',
      special: 'reg', regId: 'uninstall', admin: true,
    }),
    item({
      id: 'reg_startup', name: '失效启动项', risk: 'safe', def: true, unit: '项',
      hint: '开机启动里指向的程序已经被删除了',
      special: 'reg', regId: 'startup', admin: true,
    }),
    item({
      id: 'reg_apppaths', name: '无效程序注册', risk: 'safe', def: true, unit: '项',
      hint: 'App Paths 里登记的程序文件已不存在（比如在运行框里敲名字没反应）',
      special: 'reg', regId: 'apppaths', admin: true,
    }),
    item({
      id: 'reg_mui', name: 'MUI 名字缓存', risk: 'data', def: false, unit: '项',
      hint: 'Windows 记着的程序名字缓存，程序已经删掉了，属于冗余记录',
      special: 'reg', regId: 'mui',
    }),
    item({
      id: 'reg_shareddlls', name: '共享 DLL 记录', risk: 'data', def: false, unit: '项',
      hint: 'SharedDLLs 里登记的文件已经不存在，属于冗余记录',
      special: 'reg', regId: 'shareddlls', admin: true,
    }),
  ];
  return {
    id: 'reg', name: '注册表', icon: 'wrench', color: '#a78bfa',
    desc: '清理已失效的注册表记录，删除前会自动导出 .reg 备份',
    items,
  };
}

/* ---------------- 目录定义 ---------------- */

function systemGroup() {
  const items = [
    item({
      id: 'temp_user', name: '用户临时文件', hint: '程序运行时产生的临时数据，删除后自动重建',
      targets: () => [T(process.env.TEMP || path.join(LOCAL, 'Temp'))],
    }),
    item({
      id: 'temp_sys', name: '系统临时文件', admin: true, adminTip: '部分文件被系统占用时会跳过',
      targets: () => [T(path.join(WINDIR, 'Temp'), 'contents')],
    }),
    item({
      id: 'win_update', name: 'Windows 更新缓存', admin: true, hint: '已下载的更新安装包，删除不影响系统更新',
      targets: () => [T(path.join(WINDIR, 'SoftwareDistribution', 'Download'))],
    }),
    item({
      id: 'delivery_opt', name: '传递优化缓存', admin: true, hint: 'Windows 更新分发缓存',
      targets: () => [T(path.join(WINDIR, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache'))],
    }),
    item({
      id: 'wer', name: '系统错误报告', admin: true, hint: '程序崩溃时生成的报告文件',
      targets: () => [
        T(path.join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER', 'ReportQueue')),
        T(path.join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER', 'ReportArchive')),
        T(path.join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER', 'Temp')),
        T(path.join(LOCAL, 'Microsoft', 'Windows', 'WER', 'ReportQueue')),
        T(path.join(LOCAL, 'Microsoft', 'Windows', 'WER', 'ReportArchive')),
      ],
    }),
    item({
      id: 'dumps', name: '内存转储文件', risk: 'data', def: false, hint: '蓝屏 / 程序崩溃时的内存快照，可用于排查问题',
      targets: () => [
        T(path.join(WINDIR, 'Minidump')),
        T(path.join(WINDIR, 'MEMORY.DMP'), 'file'),
        T(path.join(LOCAL, 'CrashDumps')),
      ],
    }),
    item({
      id: 'sys_logs', name: '系统日志文件', admin: true, hint: 'CBS / DISM / 更新日志，排查系统问题时才需要',
      targets: () => [
        T(path.join(WINDIR, 'Logs', 'CBS')), T(path.join(WINDIR, 'Logs', 'DISM')), T(path.join(WINDIR, 'Logs', 'MoSetup')),
        T(path.join(WINDIR, 'Logs', 'WindowsUpdate')), T(path.join(WINDIR, 'Panther')),
      ],
    }),
    item({
      id: 'thumb_cache', name: '缩略图与图标缓存', hint: '资源管理器缓存，删除后重建；若被占用请先关闭资源管理器',
      targets: () => [
        T(path.join(LOCAL, 'Microsoft', 'Windows', 'Explorer'), 'glob', { pattern: /^(thumbcache_.*\.db|iconcache_.*\.db)$/i }),
        T(path.join(LOCAL, 'IconCache.db'), 'file'),
      ],
    }),
    item({
      id: 'dx_cache', name: 'DirectX 着色器缓存', hint: '游戏与显卡驱动的编译缓存，删除后首次运行稍慢',
      targets: () => [T(path.join(LOCAL, 'D3DSCache')), T(path.join(LOCAL, 'AMD', 'DxCache')), T(path.join(LOCAL, 'AMD', 'GLCache'))],
    }),
    item({
      id: 'nv_cache', name: 'NVIDIA 显卡缓存', hint: 'NVIDIA 着色器与 GLCache',
      targets: () => [
        T(path.join(LOCAL, 'NVIDIA', 'DXCache')), T(path.join(LOCAL, 'NVIDIA', 'GLCache')),
        T(path.join(LOCAL, 'NVIDIA Corporation', 'NV_Cache')), T(path.join(LOCAL, 'NVIDIA Corporation', 'NvBackend')),
      ],
    }),
    item({
      id: 'prefetch', name: '预读取文件', risk: 'deep', def: false, admin: true, hint: '加快程序启动的缓存，删除后常用软件首次启动变慢',
      targets: () => [T(path.join(WINDIR, 'Prefetch'), 'glob', { pattern: /\.pf$/i })],
    }),
    item({
      id: 'recycle', name: '回收站', risk: 'data', def: false, hint: '清空所有磁盘回收站中的文件',
      targets: () => [],
      special: 'recycle',
    }),
    item({
      id: 'font_cache', name: '字体缓存', admin: true, hint: '字体缓存文件，删除后系统自动重建',
      targets: () => [
        T(path.join(WINDIR, 'ServiceProfiles', 'LocalService', 'AppData', 'Local', 'FontCache')),
      ],
    }),
    item({
      id: 'dns_cache', name: 'DNS 解析缓存', hint: '刷新本机 DNS 缓存，可解决部分网站打不开',
      targets: () => [], special: 'flushdns',
    }),
  ];
  return {
    id: 'sys', name: '系统垃圾', icon: 'shield', color: '#4f8cff',
    desc: 'Windows 自身产生的临时文件、更新缓存、日志与错误报告',
    items,
  };
}


/* ---------------- 国产/常见软件：Chromium 缓存自动发现 ----------------
   不逐条写死路径：扫 %LOCALAPPDATA% / %APPDATA% 的一级目录，
   只要目录里同时存在 2 个以上 Chromium 缓存特征目录，就认为它是网页内核应用。 */
const AUTO_APP_NAMES = {
  douyin: '抖音', Douyin: '抖音', bilibili: '哔哩哔哩', Bilibili: '哔哩哔哩', BiliBili: '哔哩哔哩',
  Netease: '网易云音乐', netease: '网易云音乐', CloudMusic: '网易云音乐',
  QQMusic: 'QQ 音乐', qqmusic: 'QQ 音乐', Kugou: '酷狗音乐', kwmusic: '酷我音乐',
  'Thunder Network': '迅雷', Thunder: '迅雷', Xunlei: '迅雷',
  DingTalk: '钉钉', dingtalk: '钉钉', Feishu: '飞书', Lark: '飞书', feishu: '飞书',
  Kingsoft: 'WPS', kingsoft: 'WPS', WPS: 'WPS', JianyingPro: '剪映', CapCut: '剪映',
  BaiduNetdisk: '百度网盘', baidu: '百度', Quark: '夸克网盘', quark: '夸克网盘',
  aliyundrive: '阿里云盘', aDrive: '阿里云盘', Youdao: '有道', YoudaoDict: '有道词典',
  TencentMeeting: '腾讯会议', wemeet: '腾讯会议', WeMeet: '腾讯会议',
  WeChat: '微信', xwechat: '微信', Tencent: '腾讯', QQNT: 'QQ',
  Adobe: 'Adobe', Unity: 'Unity', Steam: 'Steam', EpicGamesLauncher: 'Epic',
  'obs-studio': 'OBS', Slack: 'Slack', Discord: 'Discord', Spotify: 'Spotify',
  Zoom: 'Zoom', 'Microsoft Teams': 'Teams', Code: 'VS Code', VSCode: 'VS Code',
  Notion: 'Notion', Figma: 'Figma', Postman: 'Postman', Docker: 'Docker',
  '123pan': '123 云盘', biubiu: 'Biubiu 加速器', 'Flydigi Space Station': '飞智空间站',
  'heybox-acc-electron': '小黑盒加速器', qqex: 'QQ 组件', ACLOS: 'ACLOS',
  PostmanLabs: 'Postman', Cursor: 'Cursor', cursor: 'Cursor',
};
const CHROMIUM_MARKS = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Network', 'Local Storage', 'Service Worker', 'Session Storage'];
const AUTO_SKIP = new Set(['microsoft', 'google', 'packages', 'temp', 'programs', 'connecteddevicesplatform',
  'comms', 'publishers', 'virtualstore', 'nvidia', 'amd', 'intel', 'd3dscache', 'crashpad', 'placeholdertilelogodatamodel',
  'activecontentwizard', 'application data', 'history', 'iconcache',
  /* 净界自己的 WebView2 数据目录，绝不能清 */
  'ebwebview',
  /* 下面这些已经有显式规则，交给专门条目，避免重复出现 */
  'baidunetdisk', 'thunder', 'qq', 'qqnt', 'wechat', 'xwechat', 'jianyingpro', 'capcut',
  'netease', 'cloudmusic', 'qqmusic', 'wps', 'kingsoft', 'feishu', 'lark', 'dingtalk',
  'code', 'vscode', 'steam', 'adobe', 'unity', 'epicgameslauncher',
  /* 明显的内部组件/开发残留，不是用户软件 */
  'pc_client_clone', 'glacc', 'aclos', 'dsh-pet-electron-helper']);
function isNoiseDir(name) {
  const low = name.toLowerCase();
  if (AUTO_SKIP.has(low)) return true;
  if (/^electron_?\d+$/.test(low)) return true;   /* electron_18 这类内部目录 */
  if (low.startsWith('dsh-')) return true;         /* 本会话自己的调试组件 */
  if (low.startsWith('temp') || low.startsWith('cache')) return true;
  return false;
}

function autoChromiumApps() {
  const out = [];
  const seen = new Set();
  for (const root of [LOCAL, ROAM]) {
    let ents = [];
    try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { continue; }
    for (const d of ents) {
      if (!d.isDirectory()) continue;
      const name = d.name;
      const low = name.toLowerCase();
      if (isNoiseDir(name) || low.startsWith('.')) continue;
      const base = path.join(root, name);
      const cands = [base, path.join(base, 'User Data'), path.join(base, 'data'), path.join(base, 'Default')];
      for (const cand of cands) {
        if (!isDir(cand)) continue;
        const hits = [];
        for (const m of CHROMIUM_MARKS) {
          const q = path.join(cand, m);
          if (isDir(q)) hits.push(q);
        }
        if (hits.length >= 2) {
          const key = (AUTO_APP_NAMES[name] || name) + '|' + cand.toLowerCase();
          if (!seen.has(key)) { seen.add(key); out.push({ dirName: name, root: cand, targets: hits }); }
          break;
        }
      }
    }
  }
  return out;
}

function appGroup() {
  const items = [
    item({
      id: 'edge_cache', name: 'Edge 浏览器缓存', hint: '网页缓存、脚本缓存与 GPU 缓存；建议关闭浏览器后清理',
      targets: () => browserCacheTargets(),
    }),
    item({
      id: 'chrome_cache', name: 'Chrome 内核浏览器缓存', hint: 'Chrome / 360 / Brave 等 Chromium 内核浏览器',
      targets: () => chromeCacheTargets(),
    }),
    item({
      id: 'ff_cache', name: 'Firefox 浏览器缓存',
      targets: () => firefoxCacheTargets(),
    }),
    item({
      id: 'steam_cache', name: 'Steam 下载缓存', hint: '已安装游戏的下载残留与 depot 缓存',
      targets: () => {
        const t = [];
        for (const s of steamPaths()) {
          for (const sub of ['steamapps\\downloading', 'steamapps\\temp', 'depotcache', 'appcache\\httpcache', 'appcache\\librarycache']) {
            t.push(T(path.join(s, sub)));
          }
        }
        return t;
      },
    }),
    item({
      id: 'wxwork_cache', name: '企业微信缓存', hint: '企业微信的图片、文件缓存',
      targets: () => {
        const t = [];
        for (const base of [path.join(DOCS, 'WXWork'), path.join(USER, 'Documents', 'WXWork')]) {
          if (!isDir(base)) continue;
          for (const acc of listDirs(base)) {
            for (const sub of ['Cache', 'Temp', 'Emotion', 'Video', 'Image']) t.push(T(path.join(acc, sub)));
          }
        }
        return t;
      },
    }),
    item({
      id: 'dingtalk_cache', name: '钉钉缓存',
      targets: () => [T(path.join(ROAM, 'DingTalk')), T(path.join(LOCAL, 'DingTalk'))],
    }),
    item({
      id: 'feishu_cache', name: '飞书缓存',
      targets: () => [T(path.join(LOCAL, 'Feishu')), T(path.join(ROAM, 'Feishu'))],
    }),
    item({
      id: 'netease_cache', name: '网易云音乐缓存', hint: '已缓存的歌曲与封面',
      targets: () => [
        T(path.join(LOCAL, 'NetEase', 'CloudMusic', 'Cache')),
        T(path.join(LOCAL, 'NetEase', 'CloudMusic', 'WebviewCache')),
      ],
    }),
    item({
      id: 'qqmusic_cache', name: 'QQ 音乐缓存',
      targets: () => [T(path.join(LOCAL, 'Tencent', 'QQMusic', 'cache')), T(path.join(ROAM, 'Tencent', 'QQMusic', 'cache'))],
    }),
    item({
      id: 'thunder_cache', name: '迅雷缓存',
      targets: () => [T(path.join(LOCAL, 'Thunder Network', 'Thunder', 'Cache')), T(path.join(ROAM, 'Thunder Network', 'Thunder', 'Temp'))],
    }),
    item({
      id: 'wps_cache', name: 'WPS 缓存',
      targets: () => [T(path.join(ROAM, 'kingsoft', 'office6', 'cache')), T(path.join(LOCAL, 'Kingsoft', 'WPS Office')), T(path.join(ROAM, 'kingsoft', 'office6', 'backup'))],
    }),
    item({
      id: 'vscode_cache', name: 'VS Code 缓存',
      targets: () => [T(path.join(ROAM, 'Code', 'Cache')), T(path.join(ROAM, 'Code', 'CachedData')), T(path.join(ROAM, 'Code', 'CachedExtensionVSIXs'))],
    }),
    item({
      id: 'nvidia_installer', name: '显卡驱动安装包', risk: 'deep', def: false, admin: true, hint: 'NVIDIA 安装包解压残留（NVIDIA Corporation\\Installer2）',
      targets: () => [T(path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'NVIDIA Corporation', 'Installer2'))],
    }),
    item({
      id: 'ms_store_cache', name: '微软商店缓存', hint: 'Store 应用缓存',
      targets: () => [T(path.join(LOCAL, 'Packages', 'Microsoft.WindowsStore_8wekyb3d8bbwe', 'LocalCache'))],
    }),
    item({
      id: 'baidu_netdisk', name: '百度网盘缓存', hint: '网页内核缓存、GPU 缓存与日志；不影响已下载的文件',
      targets: () => baiduNetdiskTargets(),
    }),
    item({
      id: 'baidu_temp', name: '百度网盘下载残留', risk: 'data', def: false, hint: '中断的下载留下的 .baiduyun.downloading 临时文件',
      targets: () => baiduTempTargets(),
    }),
    item({
      id: 'jianying_cache', name: '剪映缓存与日志', hint: '预览缓存、日志与网络缓存；草稿与工程文件不会动',
      targets: () => jianyingTargets(),
    }),
    item({
      id: 'edge_update', name: 'Edge 更新安装包', risk: 'deep', def: false, admin: true, hint: 'Edge 升级后留下的旧安装包（EdgeUpdate\\Download）',
      targets: () => [
        T(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'EdgeUpdate', 'Download')),
        T(path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft', 'EdgeUpdate', 'Download')),
      ],
    }),
    item({
      id: 'dev_cache', name: '开发工具缓存', hint: 'npm / yarn / pnpm / pip / NuGet / electron 的下载缓存，清理后重装依赖时会重新下载',
      targets: () => devCacheTargets(),
    }),
    item({
      id: 'dev_heavy', name: 'Gradle / Maven 依赖', risk: 'deep', def: false, hint: 'Java 构建的依赖仓库，体积可能很大，删掉后构建需重新下载',
      targets: () => devHeavyTargets(),
    }),
  ];
  /* 自动发现的软件（不写死路径，装了什么就会出现什么） */
  const builtinIds = new Set(items.map((x) => x.id));
  for (const a of autoChromiumApps()) {
    const cn = AUTO_APP_NAMES[a.dirName] || a.dirName;
    const id = 'auto_' + a.dirName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (builtinIds.has(id)) continue;
    builtinIds.add(id);
    items.push(item({
      id,
      name: cn + ' 缓存',
      hint: '自动识别：' + a.root.replace(USER, '%USERPROFILE%') + ' 下的网页内核缓存',
      targets: () => a.targets.map((q) => T(q)),
    }));
  }

  return {
    id: 'app', name: '应用缓存', icon: 'grid', color: '#8b7cff',
    desc: '浏览器与常用软件的缓存、临时文件（不影响聊天记录与设置）',
    items,
  };
}

function wechatGroup() {
  const accs = wechatAccounts();
  const base = wechatBaseDir();
  const wxItems = [];

  wxItems.push(item({
    id: 'wx_cache', name: '微信缓存与日志', hint: '小程序 / 网页 / 广告缓存、日志与崩溃记录，可安全清理',
    targets: () => {
      const t = [];
      for (const a of wechatAccounts()) {
        if (a.kind === 'v4') {
          for (const sub of ['cache', 'temp', 'apm_record', 'business\\ad', 'business\\xweb', 'business\\sns', 'business\\migrate', 'business\\emoticon']) t.push(T(path.join(a.root, sub)));
        } else {
          for (const sub of ['FileStorage\\Cache', 'FileStorage\\Temp', 'FileStorage\\Sns', 'FileStorage\\CustomEmotion', 'FileStorage\\General']) t.push(T(path.join(a.root, sub)));
        }
      }
      for (const sub of ['log', 'crashinfo', 'update', 'xplayer', 'xplugin', 'radium']) t.push(T(path.join(ROAM, 'Tencent', 'xwechat', sub)));
      for (const sub of ['log', 'crashinfo']) t.push(T(path.join(ROAM, 'Tencent', 'WeChat', sub)));
      return t;
    },
    note: accs.length ? '' : '未检测到微信数据目录',
  }));

  wxItems.push(item({
    id: 'wx_image', name: '聊天图片缓存', risk: 'data', def: false, age: true,
    hint: '聊天中收发的图片、缩略图；清理后聊天记录中图片需重新加载',
    targets: (opt) => {
      const t = [];
      for (const a of wechatAccounts()) {
        if (a.kind === 'v4') {
          t.push(T(path.join(a.root, 'msg', 'attach'), 'agewalk', { filter: /\.(dat|jpg|jpeg|png|gif|bmp|webp|heic|thumb)$/i }));
          t.push(T(path.join(a.root, 'msg', 'attach'), 'agewalk', { onlyImgDirs: true }));
        } else {
          t.push(T(path.join(a.root, 'FileStorage', 'Image'), 'agewalk', { filter: /\.(dat|jpg|jpeg|png|gif|bmp)$/i }));
          t.push(T(path.join(a.root, 'FileStorage', 'MsgAttach'), 'agewalk', { onlyImgDirs: true }));
        }
      }
      return uniqTargets(t);
    },
  }));

  wxItems.push(item({
    id: 'wx_video', name: '聊天视频与语音', risk: 'data', def: false, age: true,
    hint: '聊天中收发的视频、视频号缓存；清理后需重新加载',
    targets: () => {
      const t = [];
      for (const a of wechatAccounts()) {
        if (a.kind === 'v4') {
          t.push(T(path.join(a.root, 'msg', 'video'), 'agewalk'));
          t.push(T(path.join(a.root, 'business', 'sns'), 'agewalk'));
        } else {
          t.push(T(path.join(a.root, 'FileStorage', 'Video'), 'agewalk'));
          t.push(T(path.join(a.root, 'FileStorage', 'VideoThumb'), 'agewalk'));
        }
      }
      return t;
    },
  }));

  wxItems.push(item({
    id: 'wx_file', name: '聊天接收的文件', risk: 'data', def: false, age: true,
    hint: '对方发来的 Word / PDF / 压缩包等文件；删除后聊天记录中的文件将无法打开',
    targets: () => {
      const t = [];
      for (const a of wechatAccounts()) {
        if (a.kind === 'v4') t.push(T(path.join(a.root, 'msg', 'file'), 'agewalk'));
        else t.push(T(path.join(a.root, 'FileStorage', 'File'), 'agewalk'));
      }
      return t;
    },
  }));

  wxItems.push(item({
    id: 'wx_backup', name: '手机聊天备份', risk: 'data', def: false,
    hint: '手机备份到电脑的聊天记录（xwechat_files\\Backup）',
    targets: () => {
      const t = [];
      if (base) t.push(T(path.join(base, 'Backup')));
      for (const a of wechatAccounts()) t.push(T(path.join(a.root, 'Backup')));
      return uniqTargets(t);
    },
  }));

  return {
    id: 'wx', name: '微信', icon: 'wechat', color: '#22c55e',
    desc: accs.length ? `检测到 ${accs.length} 个微信数据目录` : '未检测到微信数据目录',
    accounts: accs.map((a) => ({ name: a.name, kind: a.kind, root: a.root })),
    items: wxItems.filter((i) => i.targets(null).length > 0 || i.id === 'wx_cache'),
  };
}

function qqGroup() {
  const accs = qqAccounts();
  const items = [];
  items.push(item({
    id: 'qq_cache', name: 'QQ 缓存与日志', hint: 'QQ NT 临时文件、迷你窗口、天气背景、更新包等缓存',
    targets: () => {
      const t = [];
      for (const a of qqAccounts()) {
        if (a.kind === 'nt') {
          for (const sub of ['nt_temp', 'nt_data\\Log', 'nt_data\\MiniApp', 'nt_data\\WeatherBgCache', 'nt_data\\VasUpdateSystem', 'nt_data\\search', 'nt_data\\PokeFace']) {
            t.push(T(path.join(a.root, sub)));
            t.push(T(path.join(a.root, 'global', sub)));
          }
        } else {
          for (const sub of ['QQ\\Cache', 'QQ\\Temp', 'Temp', 'Chat\\Temp']) t.push(T(path.join(a.root, sub)));
        }
      }
      for (const sub of ['QQNT\\STemp', 'QQ\\STemp', 'QQ\\InstallPackageDR']) t.push(T(path.join(ROAM, 'Tencent', sub)));
      t.push(T(path.join(LOCAL, 'Tencent', 'QQTempSys')));
      return t;
    },
  }));
  items.push(item({
    id: 'qq_emoji', name: 'QQ 表情与贴图缓存', hint: '表情包缓存文件，删除后自动重新下载',
    targets: () => {
      const t = [];
      for (const a of qqAccounts()) if (a.kind === 'nt') { t.push(T(path.join(a.root, 'nt_data', 'Emoji'))); t.push(T(path.join(a.root, 'global', 'nt_data', 'Emoji'))); }
      return t;
    },
  }));
  items.push(item({
    id: 'qq_image', name: '聊天图片', risk: 'data', def: false, age: true,
    hint: '聊天收发图片缓存，清理后需重新加载',
    targets: () => {
      const t = [];
      for (const a of qqAccounts()) {
        if (a.kind === 'legacy') t.push(T(path.join(a.root, 'Image'), 'agewalk'));
        else {
          t.push(T(path.join(a.root, 'nt_data', 'Pic'), 'agewalk'));
          t.push(T(path.join(a.root, 'global', 'nt_data', 'Pic'), 'agewalk'));
        }
      }
      return t;
    },
  }));
  items.push(item({
    id: 'qq_video', name: '聊天视频', risk: 'data', def: false, age: true,
    targets: () => {
      const t = [];
      for (const a of qqAccounts()) {
        if (a.kind === 'legacy') t.push(T(path.join(a.root, 'Video'), 'agewalk'));
        else {
          t.push(T(path.join(a.root, 'nt_data', 'Video'), 'agewalk'));
          t.push(T(path.join(a.root, 'global', 'nt_data', 'Video'), 'agewalk'));
        }
      }
      return t;
    },
  }));
  items.push(item({
    id: 'qq_file', name: '接收的文件', risk: 'data', def: false, age: true,
    hint: 'QQ 接收的文件（FileRecv），删除后不可恢复，请确认后再清理',
    targets: () => {
      const t = [];
      for (const a of qqAccounts()) if (a.kind === 'legacy') t.push(T(path.join(a.root, 'FileRecv'), 'agewalk'));
      return t;
    },
  }));
  return {
    id: 'qq', name: 'QQ', icon: 'qq', color: '#38bdf8',
    desc: accs.length ? `检测到 ${accs.length} 个 QQ 目录` : '未检测到 QQ 数据目录',
    accounts: accs.map((a) => ({ name: a.name, kind: a.kind, root: a.root })),
    items,
  };
}

function advGroup() {
  const items = [
    item({
      id: 'windows_old', name: '旧版 Windows 安装文件', risk: 'deep', def: false, admin: true,
      hint: '升级系统后保留的 Windows.old，通常 10~30GB，删除后无法回退到旧版本',
      targets: () => [T(path.join(U.SYSTEMDRIVE + '\\', 'Windows.old'), 'dir')],
      special: 'windowsold',
    }),
    item({
      id: 'winsxs', name: '组件存储 WinSxS 清理', risk: 'deep', def: false, admin: true,
      hint: '使用 DISM 清理旧组件，通常可释放 1~10GB；启用 ResetBase 后不可卸载已装更新',
      targets: () => [],
      special: 'dism',
    }),
    item({
      id: 'hibfile', name: '休眠文件 hiberfil.sys', risk: 'deep', def: false, admin: true,
      hint: '关闭休眠可释放内存大小的磁盘空间（通常 8~32GB），快速启动会一并失效',
      targets: () => [T(path.join(U.SYSTEMDRIVE + '\\', 'hiberfil.sys'), 'file')],
      special: 'hibernate',
    }),
    item({
      id: 'restore_points', name: '系统还原点', risk: 'deep', def: false, admin: true,
      hint: '删除除最新之外的所有系统还原点，可释放数 GB；删除后无法还原到更早状态',
      targets: () => [], special: 'vss',
    }),
    item({
      id: 'driver_store', name: '旧驱动包', risk: 'deep', def: false, admin: true,
      hint: '第三方驱动安装包（pnputil），删除旧版本可释放空间；请勿删除当前在用的驱动',
      targets: () => [], special: 'drivers',
    }),
    item({
      id: 'installer_cache', name: 'Windows Installer 缓存', risk: 'deep', def: false, admin: true,
      hint: 'MSI 安装缓存，删除后部分软件无法修复/卸载，一般不建议清理',
      targets: () => [T(path.join(WINDIR, 'Installer', '$PatchCache$'))],
    }),
    item({
      id: 'upgrade_logs', name: '系统升级残留日志', risk: 'deep', def: false, admin: true,
      hint: 'Panther / 升级日志与 $WINDOWS.~BT 残留',
      targets: () => [
        T(path.join(U.SYSTEMDRIVE + '\\', '$WINDOWS.~BT'), 'dir'),
        T(path.join(U.SYSTEMDRIVE + '\\', '$GetCurrent'), 'dir'),
        T(path.join(WINDIR, 'Panther')),
      ],
    }),
  ];
  return {
    id: 'adv', name: '深度清理', icon: 'zap', color: '#f59e0b',
    desc: '系统级深度清理，需要管理员权限，部分操作不可逆',
    items,
  };
}

function uniqTargets(list) {
  const seen = new Set(), out = [];
  for (const t of list) {
    const k = t.path.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out;
}

function buildCatalog() {
  const groups = [systemGroup(), appGroup(), wechatGroup(), qqGroup(), regGroup(), advGroup()];
  // 去掉不存在目标的普通项（特殊项、微信/QQ 保留以便展示说明）
  for (const g of groups) {
    g.items = g.items.filter((it) => {
      if (it.special) return true;
      if (g.id === 'wx' || g.id === 'qq') return true;
      try { return it.targets(null).some((t) => exists(t.path)); } catch (e) { return false; }
    });
  }
  return groups;
}

function metaCatalog(groups) {
  return groups.map((g) => ({
    id: g.id, name: g.name, icon: g.icon, color: g.color, desc: g.desc,
    accounts: g.accounts || [],
    items: g.items.map((it) => ({
      id: it.id, group: g.id, name: it.name, hint: it.hint || '', risk: it.risk,
      def: it.def, admin: it.admin, age: it.age, special: it.special || null,
      unit: it.unit || '', regId: it.regId || '',
      available: (() => { try { return it.special ? true : it.targets(null).some((t) => exists(t.path)); } catch (e) { return false; } })(),
    })),
  }));
}

function findItem(groups, id) {
  for (const g of groups) for (const it of g.items) if (it.id === id) return { group: g, item: it };
  return null;
}

module.exports = { buildCatalog, metaCatalog, findItem, wechatAccounts, qqAccounts, wechatBaseDir };
