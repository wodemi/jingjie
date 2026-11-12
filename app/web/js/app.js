/* 净界 - 前端主程序 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const TOKEN = document.querySelector('meta[name="jj-token"]').content;
  const VER = document.querySelector('meta[name="jj-version"]').content;
  const H = { 'Content-Type': 'application/json', 'x-jj-token': TOKEN };

  const APP = {
    st: null,
    view: 'home',
    gid: 'sys',
    sizes: {},
    scannedAt: 0,
    age: 0,
    sel: {},
    busy: false,
  };
  window.APP = APP;

  /* ---------------- 基础 ---------------- */
  const fmt = (n) => {
    if (n === null || n === undefined) return '-';
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1, v = n;
    do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
    return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + u[i];
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function api(p, opt) {
    const r = await fetch(p, Object.assign({ headers: H }, opt || {}));
    if (!r.ok) throw new Error((await r.text()) || ('HTTP ' + r.status));
    return r.json();
  }

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = icon(kind === 'bad' ? 'info' : 'check') + '<span>' + esc(msg) + '</span>';
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = '.3s'; el.style.opacity = '0'; el.style.transform = 'translateY(-8px)'; setTimeout(() => el.remove(), 300); }, 2600);
  }

  /* ---------------- 流式请求 ---------------- */
  async function streamPost(url, body, onEvent) {
    const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (e) { continue; }
        onEvent(ev);
      }
    }
  }

  /* ---------------- 数据 ---------------- */
  function allItems() {
    const out = [];
    for (const g of APP.st.groups) for (const it of g.items) out.push(Object.assign({}, it, { groupName: g.name, groupColor: g.color }));
    return out;
  }
  function itemById(id) { return allItems().find((x) => x.id === id); }
  function sizeOf(id) { const s = APP.sizes[id]; return s ? s.size || 0 : 0; }
  function countOf(id) { const s = APP.sizes[id]; return s ? s.count || 0 : 0; }
  function needAdmin(it) { return !!(it.admin && APP.st && APP.st.admin === false); }
  function defaultSel() {
    for (const it of allItems()) {
      if (!(it.id in APP.sel)) APP.sel[it.id] = !!it.def && (it.available !== false) && !needAdmin(it);
    }
  }
  function groupTotal(gid) {
    let s = 0;
    for (const it of APP.st.groups.find((g) => g.id === gid).items) s += sizeOf(it.id);
    return s;
  }
  /* 注册表这类项目体积为 0，按“条数”统计 */
  function groupCount(gid) {
    let n = 0;
    const g = APP.st.groups.find((x) => x.id === gid);
    if (!g) return 0;
    for (const it of g.items) if (it.unit === '项') n += countOf(it.id);
    return n;
  }
  /* 选择是按当前分组算的：在「微信专清」页清理，就只清微信组的项目 */
  function viewItems() {
    const gid = (APP.view === 'wx' || APP.view === 'qq') ? APP.view : APP.gid;
    const g = APP.st && APP.st.groups ? APP.st.groups.find((x) => x.id === gid) : null;
    if (!g) return allItems();
    return g.items.map((it) => Object.assign({}, it, { groupName: g.name, groupColor: g.color }));
  }
  const selectedIds = () => viewItems().filter((it) => APP.sel[it.id] && (it.available !== false) && !needAdmin(it)).map((it) => it.id);
  const selectedBytes = () => selectedIds().reduce((a, id) => a + sizeOf(id), 0);
  const selectedRegCount = () => selectedIds().reduce((a, id) => a + (itemById(id) && itemById(id).unit === '项' ? countOf(id) : 0), 0);

  /* 给外壳（C#）发消息：外层作用域也能用，boot() 里的 post 是局部变量 */
  const shellPost = (obj) => { try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(obj); } catch (e) { } };

  /* ---------------- 导航 ---------------- */
  const NAV = [
    { id: 'home', name: '首页', icon: 'home' },
    { id: 'clean', name: '清理加速', icon: 'broom' },
    { id: 'wx', name: '微信专清', icon: 'chat' },
    { id: 'qq', name: 'QQ 专清', icon: 'qq' },
    { id: 'tools', name: '实用工具', icon: 'tools' },
    { id: 'about', name: '关于', icon: 'info' },
  ];
  function renderNav() {
    $('#nav').innerHTML = NAV.map((n) => {
      let badge = '';
      if (n.id === 'clean' && APP.scannedAt) {
        const total = APP.st.groups.reduce((a, g) => a + groupTotal(g.id), 0);
        if (total > 0) badge = '<span class="badge hot">' + fmt(total) + '</span>';
      }
      if (n.id === 'wx' || n.id === 'qq') {
        const t = groupTotal(n.id);
        if (t > 0) badge = '<span class="badge">' + fmt(t) + '</span>';
      }
      return '<a class="nav-item' + (APP.view === n.id ? ' active' : '') + '" data-nav="' + n.id + '">' + icon(n.icon) + '<span>' + n.name + '</span>' + badge + '</a>';
    }).join('');
  }

  /* ---------------- 首页 ---------------- */
  function gaugeSVG(pct) {
    const r = 82, c = 2 * Math.PI * r;
    const off = c * (1 - pct / 100);
    return `<div class="gauge">
      <svg width="188" height="188" viewBox="0 0 188 188">
        <defs><linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#34e5a4"/><stop offset="55%" stop-color="#2bc9ff"/><stop offset="100%" stop-color="#5b8cff"/>
        </linearGradient></defs>
        <circle class="track" cx="94" cy="94" r="${r}" fill="none" stroke-width="13"/>
        <circle class="bar" cx="94" cy="94" r="${r}" fill="none" stroke-width="13"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
      </svg>
      <div class="gauge-center">
        <div class="pct">${pct.toFixed(0)}<small>%</small></div>
        <div class="lbl">系统盘已用</div>
      </div>
    </div>`;
  }

  function viewHome() {
    const c = (APP.st.disks.find((d) => d.name.toUpperCase().startsWith('C')) || APP.st.disks[0] || { total: 1, free: 0 });
    const used = c.total - c.free;
    const pct = (used / c.total) * 100;
    const scannable = APP.scannedAt ? APP.st.groups.reduce((a, g) => a + groupTotal(g.id), 0) : 0;
    const wx = groupTotal('wx'), qq = groupTotal('qq'), sys = groupTotal('sys');
    const totalSel = scannable;

    const disks = APP.st.disks.map((d) => {
      const u = d.total - d.free;
      const p = d.total ? (u / d.total) * 100 : 0;
      const cls = p > 90 ? 'danger' : (p > 78 ? 'warn' : '');
      return `<div class="disk-row" data-disk="${esc(d.name.charAt(0))}" title="${esc(d.name)} 已用 ${fmt(u)}，剩余 ${fmt(d.free)}，共 ${fmt(d.total)}">
        <span class="nm">${esc(d.name)}</span>
        <span class="track"><span class="fill ${cls}" style="width:${Math.max(p, 1.5).toFixed(1)}%"></span></span>
        <span class="val"><b>${p.toFixed(0)}%</b> 已用 · 剩 ${fmt(d.free)} / ${fmt(d.total)}</span>
      </div>`;
    }).join('');

    const quick = (APP.st.tools || []).slice(0, 8).map((t) => `
      <div class="quick" data-tool="${t.id}">
        <div class="ic">${icon(t.icon)}</div>
        <div class="nm">${esc(t.name)}</div>
        <div class="ds">${esc(t.desc)}</div>
      </div>`).join('');

    return `
    ${(APP.st.probe && APP.st.probe.canDelete === false) ? `
    <div class="warn-banner" id="warnBanner">
      <div class="wi">${icon('shield')}</div>
      <div class="wt">
        <b>删除操作没有生效</b>
        <span>程序所在的目录可能被沙箱 / 策略限制（例如从某些受管目录运行），或被杀软拦住。把整个程序文件夹挪到普通目录（例如 C:\净界 或 D:\Programs\净界）再试，多半就好了。</span>
      </div>
      <button class="btn sm ghost" id="btnWarnHelp">怎么做</button>
    </div>` : ''}
    <div class="hero">
      <div class="card gauge-card">
        ${gaugeSVG(pct)}
        <div class="gauge-foot">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--txt-2);margin-bottom:2px">
            <span>${esc(c.name)} 系统盘</span><span class="mono">${fmt(used)} / ${fmt(c.total)}</span>
          </div>
          ${disks}
        </div>
      </div>
      <div class="hero-right">
        <div class="action-card cta">
          <div class="top">
            <div>
              <div class="cap">可释放空间</div>
              <div class="big">${APP.scannedAt ? fmt(scannable) : '尚未扫描'}</div>
            </div>
            <div class="ic" style="background:rgba(52,229,164,.15);color:var(--mint)">${icon('broom')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
            <button class="btn primary" id="btnScanAll">${icon('search')}一键扫描</button>
            <button class="btn onekey" id="btnOneKey" title="扫描并清理所有推荐项（默认勾选的安全项）">${icon('zap')}一键清理推荐</button>
            ${APP.scannedAt ? '<button class="btn sm ghost" id="btnGoClean">' + icon('arrow') + '去清理</button>' : ''}
          </div>
        </div>
        <div class="action-card">
          <div class="top">
            <div>
              <div class="cap">微信垃圾</div>
              <div class="big">${APP.scannedAt ? fmt(wx) : '—'}<small>${APP.scannedAt ? countOf('wx_cache') + countOf('wx_image') + countOf('wx_file') + ' 个文件' : '待扫描'}</small></div>
            </div>
            <div class="ic" style="background:rgba(34,197,94,.14);color:var(--green)">${icon('chat')}</div>
          </div>
          <div style="margin-top:10px"><button class="btn sm" data-go="wx">微信专清 ${icon('arrow')}</button></div>
        </div>
        <div class="action-card">
          <div class="top">
            <div>
              <div class="cap">QQ 垃圾</div>
              <div class="big">${APP.scannedAt ? fmt(qq) : '—'}<small>${APP.scannedAt ? countOf('qq_cache') + countOf('qq_emoji') + ' 个文件' : '待扫描'}</small></div>
            </div>
            <div class="ic" style="background:rgba(56,189,248,.14);color:var(--sky)">${icon('qq')}</div>
          </div>
          <div style="margin-top:10px"><button class="btn sm" data-go="qq">QQ 专清 ${icon('arrow')}</button></div>
        </div>
        <div class="action-card">
          <div class="top">
            <div>
              <div class="cap">系统垃圾</div>
              <div class="big">${APP.scannedAt ? fmt(sys) : '—'}<small>${APP.scannedAt ? countOf('temp_user') + countOf('thumb_cache') + ' 个文件' : '待扫描'}</small></div>
            </div>
            <div class="ic" style="background:rgba(91,140,255,.14);color:var(--blue)">${icon('shield')}</div>
          </div>
          <div style="margin-top:10px"><button class="btn sm" data-go="clean">查看详情 ${icon('arrow')}</button></div>
        </div>
      </div>
    </div>

    <div class="sec-head">
      <h3>常用工具</h3><div class="line"></div>
      <a class="more" data-go="tools">全部 ${APP.st.tools.length} 个 ${icon('arrow')}</a>
    </div>
    <div class="quick-grid">${quick}</div>

    <div class="sec-head"><h3>状态</h3><div class="line"></div></div>
    <div class="card pad stat-line">
      <span>${icon('monitor')}${esc(APP.st.os.caption)}</span>
      <span>${icon('cpu')}${esc(APP.st.os.arch)} · ${esc(APP.st.os.host)}</span>
      <span>${icon('clock')}已运行 ${(APP.st.uptime / 3600).toFixed(1)} 小时</span>
      <span style="margin-left:auto">${APP.scannedAt ? '上次扫描 ' + new Date(APP.scannedAt).toLocaleTimeString('zh-CN') : '尚未扫描'}</span>
    </div>`;
  }

  /* ---------------- 清理页 ---------------- */
  function riskBadge(it) {
    if (it.risk === 'data') return '<span class="badge data">个人数据</span>';
    if (it.risk === 'deep') return '<span class="badge deep">谨慎</span>';
    return '<span class="badge safe">安全</span>';
  }


  /* ---------------- 「这是什么东西？」小知识库 + 联网搜索 ---------------- */
  const KNOW = {
    temp_user: '程序运行中产生的临时文件，正常退出时会被清掉；没清掉的多是崩溃或安装残留。删除后系统/软件会自动重建。',
    temp_sys: 'WINDOWS\Temp 是服务与安装程序共用的临时目录，需要管理员权限。',
    win_update: 'Windows 更新下载的安装包，装完就没用了。删掉不影响已安装的更新。',
    wer: '程序崩溃时生成的错误报告（WER），给开发者排错用，普通用户可删。',
    dumps: '蓝屏/崩溃时的内存转储文件，动辄几百 MB。除非要分析蓝屏原因，否则可以删。',
    sys_logs: 'CBS/DISM/更新日志，排查系统问题时才用得到，日常可删。',
    thumb_cache: '资源管理器生成的缩略图与图标缓存（thumbcache_*.db）。删掉后第一次打开文件夹会稍慢，之后自动重建。',
    dx_cache: 'DirectX 着色器缓存，游戏首次启动会重新编译，所以删完头一两次进游戏会略卡。',
    nv_cache: 'NVIDIA 显卡的着色器缓存（DXCache/GLCache），体积常常很大，删掉安全，只是游戏首启要重新编译。',
    prefetch: '预读文件，能加快程序启动。删除后常用软件首次启动会变慢，一般不建议清。',
    recycle: '回收站里的文件，清空即彻底删除。',
    edge_cache: 'Edge 的网页缓存、脚本缓存和 GPU 缓存。删完网页首次加载会略慢，登录状态与书签不受影响。',
    chrome_cache: 'Chromium 内核浏览器（Chrome/360/Brave 等）的网页缓存。',
    ff_cache: 'Firefox 的网页缓存。',
    wx_cache: '微信小程序、公众号网页、广告与日志缓存。聊天记录和图片文件不受影响。',
    wx_image: '聊天里收到/发出的图片与缩略图。删掉后聊天记录里的图片需要重新下载（服务器上还有的能下回来，过期的就没了）。',
    wx_video: '聊天视频与视频号缓存，通常是大头。',
    wx_file: '对方发来的 Word/PDF/压缩包等文件，删除后聊天记录里打不开。',
    qq_cache: 'QQ NT 的临时文件、迷你窗口与更新包缓存。',
    qq_emoji: 'QQ 表情与贴图缓存，删除后需要重新下载。',
    baidu_netdisk: '百度网盘的网页内核缓存、GPU 缓存与日志。已下载到本地的文件不受影响。',
    jianying_cache: '剪映的预览缓存、日志与 CEF 缓存。草稿工程（Projects 目录）不会被动。',
    dev_cache: 'npm/yarn/pnpm/pip/NuGet/electron 的下载缓存。删掉后下次装依赖要重新下载，省空间但会慢一点。',
    dev_heavy: 'Gradle/Maven 的依赖仓库，Java 项目重新构建时会重新下载。',
    ms_store_cache: '微软商店应用的本地缓存。',
    edge_update: 'Edge 升级后留下的旧安装包。',
    nvidia_installer: 'NVIDIA 驱动安装包解压后的残留。',
  };
  function knowOf(it) {
    if (KNOW[it.id]) return KNOW[it.id];
    if (it.id.indexOf('reg_') === 0) {
      return '注册表里的失效记录：它指向的程序/文件已经不存在了，留着不会立刻出问题，但会让系统多做无用功。\n净界在删除前会把相关键导出成 .reg 备份，出问题可以双击还原。';
    }
    if (it.id.indexOf('auto_') === 0) {
      return '这是自动识别出来的网页内核应用缓存（Chromium 结构）。删除只会清缓存，不影响登录状态和你的文件。';
    }
    if (it.risk === 'data') return it.hint || '这是你的个人数据，删除后无法恢复。默认为不勾选。';
    if (it.risk === 'deep') return it.hint || '深度清理项，可能影响系统功能或需要重新下载，执行后不可撤销。';
    return it.hint || '缓存/临时数据，删除后相关软件会自动重建，不影响你的文件和设置。';
  }
  function explainItem(it) {
    const body = '<div style="font-size:13px;line-height:1.75;color:var(--txt-2)">' +
      '<div style="color:var(--txt);font-weight:600;font-size:15px;margin-bottom:8px">' + esc(it.name) + '</div>' +
      '<div style="white-space:pre-wrap">' + esc(knowOf(it)) + '</div>' +
      '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:var(--w05);border:1px solid var(--line);font-size:12px">' +
      '<div>分组：' + esc(it.groupName || '') + ' · 风险：' + (it.risk === 'safe' ? '安全' : it.risk === 'data' ? '个人数据' : '谨慎') + (it.admin ? ' · 需要管理员' : '') + '</div>' +
      (it.hint ? '<div style="margin-top:4px;color:var(--txt-3)">' + esc(it.hint) + '</div>' : '') +
      '</div></div>';
    openModal({
      size: 'sm', icon: 'info', title: '这是什么东西？', desc: '本地说明 + 一键联网搜索',
      body,
      foot: '<button class="btn" data-close>知道了</button><div class="spacer"></div><button class="btn primary" id="btnWebSearch">联网搜一下</button>',
    });
    const b = $('#btnWebSearch');
    if (b) b.onclick = () => {
      const q = encodeURIComponent(it.name.replace(/\s*缓存.*$/, '') + ' 缓存 可以删除吗 是什么');
      shellPost({ cmd: 'openurl', url: 'https://www.bing.com/search?q=' + q });
      toast('已在默认浏览器中打开搜索');
    };
  }

  function itemRow(it) {
    const sz = sizeOf(it.id), cnt = countOf(it.id);
    const s = APP.sizes[it.id];
    const isReg = it.unit === '项';
    const open = APP.openParts === it.id;
    const parts = (s && s.parts && s.parts.length && open) ? s.parts.map((p) =>
      `<div class="part"><span class="p" title="${esc(p.path)}">${esc(p.path)}</span><span class="s">${isReg ? '' : fmt(p.size)}</span></div>`).join('') : '';
    const dis = it.available === false;
    const lock = needAdmin(it);
    const sizeMain = s ? (isReg ? cnt + ' 项' : fmt(sz)) : '—';
    const sizeSub = s ? (isReg ? '注册表记录' : (cnt ? cnt + ' 个文件' : '无文件')) : '待扫描';
    return `<div class="item ${APP.sel[it.id] ? 'checked' : ''} ${open ? 'open' : ''} ${lock ? 'locked' : ''}" data-item="${it.id}" ${lock ? 'title="需要以管理员身份运行才能清理"' : ''}>
      <div class="checkbox ${APP.sel[it.id] && !lock ? 'on' : ''}" data-check="${it.id}">${icon(lock ? 'lock' : 'check')}</div>
      <div class="body">
        <div class="nm">${esc(it.name)} ${it.risk !== 'safe' ? riskBadge(it) : ''} ${it.admin ? '<span class="badge admin">管理员</span>' : ''} ${it.age ? '<span class="badge off">按时间</span>' : ''}</div>
        <div class="hint">${esc(it.hint || '')}${dis ? ' · <span style="color:var(--amber)">未检测到</span>' : ''}${lock ? ' · <span style="color:var(--txt-3)">需管理员，已跳过</span>' : ''}</div>
      </div>
      <div class="size">
        <div class="v ${(isReg ? cnt : sz) ? '' : 'zero'}">${sizeMain}</div>
        <div class="c">${sizeSub}</div>
      </div>
      <button class="exp" data-know="${it.id}" title="这是什么东西？">${icon('help')}</button>
      ${s && s.parts && s.parts.length > 1 ? '<button class="exp" data-exp="' + it.id + '">' + icon('chevron') + '</button>' : '<div style="width:26px"></div>'}
    </div>${parts ? '<div class="parts">' + parts + '</div>' : ''}`;
  }

  function viewClean(gid) {
    const groups = APP.st.groups;
    const g = groups.find((x) => x.id === gid) || groups[0];
    const tabs = groups.map((x) => {
      const t = APP.scannedAt ? groupTotal(x.id) : 0;
      const c = APP.scannedAt ? groupCount(x.id) : 0;
      const badge = t ? fmt(t) : (c ? c + ' 项' : '');
      return '<button class="pill ' + (x.id === g.id ? 'active' : '') + '" data-tab="' + x.id + '">' + esc(x.name) + (badge ? ' <span class="count">' + badge + '</span>' : '') + '</button>';
    }).join('');

    const items = g.items.map(itemRow).join('') || '<div class="empty">' + icon('broom') + '<div>这一组没有可清理的项目</div></div>';
    const selCount = selectedIds().length;
    const selBytes = selectedBytes();
    /* 非管理员时，把“因权限被跳过”的项目汇总成一条提示，给一个提权入口 */
    const locked = APP.st.admin ? [] : allItems().filter((it) => needAdmin(it) && sizeOf(it.id) > 0);
    const lockedBytes = locked.reduce((a, it) => a + sizeOf(it.id), 0);
    const adminBar = (!APP.st.admin && locked.length)
      ? `<div class="warn-banner"><span class="ic">${icon('lock')}</span>
           <div class="body"><div class="t">有 ${locked.length} 个系统项目需要管理员权限${lockedBytes ? '（约 ' + fmt(lockedBytes) + '）' : ''}</div>
           <div class="d">这些项目在普通权限下会被跳过，以管理员身份重启后即可清理。</div></div>
           <button class="btn sm" id="btnElevate">${icon('shield')}以管理员身份重启</button></div>`
      : '';

    return `
    <div class="page-head">
      <div>
        <h2>${gid === 'wx' ? '微信专清' : gid === 'qq' ? 'QQ 专清' : '清理加速'}</h2>
        <div class="desc">${esc(g.desc)}${g.accounts && g.accounts.length ? ' · ' + g.accounts.map((a) => esc(a.name)).join('、') : ''}</div>
      </div>
      <div class="spacer"></div>
      <button class="btn" id="btnScanGroup">${icon('refresh')}扫描本组</button>
      <button class="btn primary" id="btnClean" ${selCount && (selBytes || selectedRegCount()) ? '' : 'disabled'}>${icon('broom')}清理已选</button>
    </div>
    <div class="toolbar">
      ${gid === 'wx' || gid === 'qq' || gid === 'clean' ? '' : ''}
      <div class="seg">${tabs}</div>
      <div class="spacer" style="flex:1"></div>
      <select class="sel" id="ageSel">
        <option value="0" ${APP.age === 0 ? 'selected' : ''}>时间：不限</option>
        <option value="7" ${APP.age === 7 ? 'selected' : ''}>仅 7 天前</option>
        <option value="30" ${APP.age === 30 ? 'selected' : ''}>仅 30 天前</option>
        <option value="90" ${APP.age === 90 ? 'selected' : ''}>仅 90 天前</option>
        <option value="180" ${APP.age === 180 ? 'selected' : ''}>仅半年以前</option>
        <option value="365" ${APP.age === 365 ? 'selected' : ''}>仅一年以前</option>
      </select>
      <button class="btn sm" id="btnSelAll">${icon('check')}全选</button>
      <button class="btn sm ghost" id="btnSelSafe">只选安全项</button>
    </div>
    ${adminBar}
    <div class="item-list">${items}</div>
    <div class="summary-bar">
      <div class="disk" style="display:flex;align-items:center;gap:6px;color:var(--txt-3)">${icon('disk')}</div>
      <div class="txt">已选 <b>${selCount}</b> 项，预计释放 <b>${fmt(selBytes)}</b>${selectedRegCount() ? ' · 另删除 <b>' + selectedRegCount() + '</b> 条注册表记录' : ''}${APP.scannedAt ? '' : ' · 请先扫描'}</div>
      <div style="flex:1"></div>
      <button class="btn sm ghost" id="btnScanAll2">${icon('search')}一键扫描</button>
      <button class="btn primary" id="btnClean2" ${selCount && (selBytes || selectedRegCount()) ? '' : 'disabled'}>${icon('broom')}开始清理</button>
    </div>`;
  }

  /* ---------------- 提权（方案 B：点一次弹一次 UAC） ---------------- */
  function elevate() {
    openModal({
      title: '以管理员身份重启',
      desc: '系统盘清理、注册表清理等操作需要管理员权限',
      icon: 'shield',
      size: 'sm',
      body: '<div style="font-size:13px;line-height:1.9;color:var(--txt-2)">' +
        '<div>接下来会弹出一个 Windows 的「用户账户控制」窗口，点「是」即可。</div>' +
        '<div style="margin-top:8px">重启后：</div>' +
        '<div>· 之前因为权限被跳过的系统项目会变成可清理</div>' +
        '<div>· 注册表清理的 HKLM 部分才能生效</div>' +
        '<div style="margin-top:10px;color:var(--txt-3)">如果你点了「否」，净界会继续以普通权限运行，不影响其它功能。</div></div>',
      foot: '<button class="btn" data-close>再想想</button><div class="spacer"></div><button class="btn primary" id="btnElevOk">' + icon('shield') + '立即重启</button>'
    });
    const ok = $('#btnElevOk');
    if (ok) ok.onclick = () => { closeModal(); shellPost({ cmd: 'elevate' }); };
  }

  /* ---------------- 工具页 ---------------- */
  function viewTools() {
    const cards = APP.st.tools.map((t) => `
      <div class="tool-card" data-tool="${t.id}">
        <div class="ic" style="background:rgba(91,140,255,.12);color:#8fb0ff">${icon(t.icon)}</div>
        <div class="nm">${esc(t.name)}</div>
        <div class="ds">${esc(t.desc)}</div>
        <div class="go">打开 ${icon('arrow')}</div>
      </div>`).join('');
    return `<div class="page-head"><div><h2>实用工具</h2><div class="desc">常用系统维护与优化功能，共 ${APP.st.tools.length} 项</div></div></div>
      <div class="tools-grid">${cards}</div>`;
  }

  function viewAbout() {
    const admin = APP.st.admin;
    return `
    <div class="page-head"><div><h2>关于净界</h2><div class="desc">一站式系统清理与优化工具</div></div></div>
    <div class="card pad" style="display:flex;gap:20px;align-items:center;margin-bottom:14px">
      <div class="brand-logo" style="width:56px;height:56px;border-radius:16px">${icon('sparkle')}</div>
      <div>
        <div style="font-size:19px;font-weight:700;letter-spacing:.5px">净界 JingJie <span class="dim" style="font-size:12px;font-weight:400">v${VER}</span></div>
        <div class="dim" style="font-size:12px;margin-top:4px">系统垃圾 · 微信 / QQ 专清 · 软件缓存 · 17 项实用工具</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div class="badge ${admin ? 'safe' : 'data'}">${admin ? '管理员权限' : '普通权限'}</div>
        <div class="dim" style="font-size:11px;margin-top:6px">${admin ? '深度清理功能可用' : '深度清理需以管理员身份运行'}</div>
      </div>
    </div>
    <div class="kv">
      <div class="cell"><div class="k">操作系统</div><div class="v">${esc(APP.st.os.caption)}</div></div>
      <div class="cell"><div class="k">计算机名</div><div class="v">${esc(APP.st.os.host)} · ${esc(APP.st.os.user)}</div></div>
      <div class="cell"><div class="k">程序目录</div><div class="v mono" style="font-size:11.5px">${esc(APP.st.dataDir)}</div></div>
      <div class="cell"><div class="k">已运行</div><div class="v">${(APP.st.uptime / 3600).toFixed(1)} 小时（系统）</div></div>
    </div>
    <div class="sec-head"><h3>清理说明</h3><div class="line"></div></div>
    <div class="card pad" style="font-size:12.5px;line-height:1.9;color:var(--txt-2)">
      · <b>安全</b>：缓存、临时文件、日志，删除后程序会自动重建，不影响使用。<br>
      · <b>个人数据</b>：聊天图片 / 视频 / 接收的文件，删除后聊天记录中无法再打开，默认不勾选。<br>
      · <b>谨慎</b>：系统级深度清理项，涉及休眠文件、还原点、WinSxS 等，执行后不可撤销。<br>
      · 扫描只读取文件信息，不会修改任何数据；清理前会再次确认，且可在结果中查看失败的占用文件。
    </div>`;
  }

  /* ---------------- 渲染 ---------------- */
  const TITLES = { home: ['首页', ''], clean: ['清理加速', '系统与应用垃圾'], wx: ['微信专清', '聊天缓存与媒体文件'], qq: ['QQ 专清', '缓存与接收文件'], tools: ['实用工具', ''], about: ['关于', ''] };

  let _lastViewKey = null;
  function render() {
    renderNav();
    const t = TITLES[APP.view] || ['', ''];
    $('#pageTitle').textContent = t[0];
    $('#pageSub').textContent = t[1] || '';
    const inner = $('#viewInner');
    let html = '';
    if (APP.view === 'home') html = viewHome();
    else if (APP.view === 'clean') html = viewClean(APP.gid);
    else if (APP.view === 'wx') html = viewClean('wx');
    else if (APP.view === 'qq') html = viewClean('qq');
    else if (APP.view === 'tools') html = viewTools();
    else if (APP.view === 'about') html = viewAbout();
    inner.innerHTML = html;
    /* 只有真正换「页面」时才做淡入；同页内切页签、勾选、展开详情都不重放动画，
       否则每点一下整块内容都会重新淡入一次，看起来就是“顿一下” */
    const key = APP.view;
    if (key !== _lastViewKey) {
      inner.classList.remove('fade-in');
      void inner.offsetWidth;
      inner.classList.add('fade-in');
      _lastViewKey = key;
    }
    bind();
  }

  function go(view, gid) {
    APP.view = view;
    if (gid) APP.gid = gid;
    /* 微信 / QQ 专清是固定的分组，别让 APP.gid 还停在上一个分组上 */
    if (view === 'wx' || view === 'qq') APP.gid = view;
    if (view === 'clean' && !gid) APP.gid = APP.gid || 'sys';
    try { history.replaceState(null, '', '#' + view + (view === 'clean' ? '/' + APP.gid : '')); } catch (e) { }
    const v = $('#view'); if (v) v.scrollTop = 0;
    render();
  }

  /* ---------------- 扫描 ---------------- */
  let progressEl = null;
  function showProgress(title, current, pct, meta) {
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.className = 'progress-panel';
      document.body.appendChild(progressEl);
    }
    progressEl.innerHTML = `
      <div class="hd"><span class="spin"></span><span>${esc(title)}</span></div>
      <div class="cur">${esc(current || '')}</div>
      <div class="progress-track"><div class="fill" style="width:${Math.max(2, Math.min(100, pct)).toFixed(1)}%"></div></div>
      <div class="meta"><span>${esc(meta || '')}</span><span>${pct.toFixed(0)}%</span></div>`;
  }
  function hideProgress() { if (progressEl) { progressEl.remove(); progressEl = null; } }

  async function doScan(ids, silent) {
    if (APP.busy) return;
    APP.busy = true;
    const list = ids || allItems().map((x) => x.id);
    let done = 0;
    APP.sizes = {};
    showProgress('正在扫描…', '准备中', 0, '0 / ' + list.length);
    try {
      await streamPost('/api/scan', { ids: list, ageDays: APP.age }, (ev) => {
        if (ev.type === 'item-start') {
          showProgress('正在扫描…', ev.name, (done / list.length) * 100, done + ' / ' + list.length);
        } else if (ev.type === 'item-done') {
          APP.sizes[ev.id] = Object.assign({}, APP.sizes[ev.id] || {}, { size: ev.size, count: ev.count });
          done++;
          showProgress('正在扫描…', ev.id, (done / list.length) * 100, done + ' / ' + list.length);
        } else if (ev.type === 'done') {
          for (const r of ev.results) APP.sizes[r.id] = r;
          APP.scannedAt = Date.now();
        } else if (ev.type === 'error') {
          toast('扫描出错：' + ev.message, 'bad');
        }
      });
      if (!silent) {
        const total = Object.values(APP.sizes).reduce((a, s) => a + (s.size || 0), 0);
        toast('扫描完成，共发现 ' + fmt(total) + ' 可清理');
      }
    } catch (e) {
      toast('扫描失败：' + e.message, 'bad');
    }
    hideProgress();
    APP.busy = false;
    defaultSel();
    render();
  }

  /* ---------------- 清理 ---------------- */
  /* 推荐项：和「默认勾选」完全同一套判定（安全项、非管理员限定、扫到有体积） */
  function recommendedIds() {
    return allItems()
      .filter((it) => it.def === true && it.available !== false && !needAdmin(it) && (sizeOf(it.id) > 0 || (it.unit === '项' && countOf(it.id) > 0)))
      .map((it) => it.id);
  }

  /* 一键清理推荐：没扫过就先扫，扫完把推荐项列出来让用户确认 */
  async function oneKeyClean() {
    if (APP.busy) return;
    if (!APP.scannedAt) {
      await doScan(null, true);
    }
    const ids = recommendedIds();
    if (!ids.length) {
      toast('没有可清理的推荐项，可能已经很干净了');
      return;
    }
    confirmClean(ids);
  }

  function confirmClean(ids) {
    const items = allItems().filter((x) => ids.includes(x.id));
    const bytes = items.reduce((a, x) => a + sizeOf(x.id), 0);
    const risky = items.filter((x) => x.risk !== 'safe');
    const regN = items.reduce((a, x) => a + (x.unit === '项' ? countOf(x.id) : 0), 0);
    const rows = items.slice(0, 12).map((x) => `<div class="part" style="margin-bottom:2px"><span class="p" style="direction:ltr;text-align:left">${esc(x.name)}</span><span class="s">${fmt(sizeOf(x.id))}</span></div>`).join('');
    openModal({
      size: 'sm', icon: 'broom', title: '确认清理', desc: '清理后无法恢复，请核对以下内容',
      body: `<div style="font-size:13px;color:var(--txt-2);margin-bottom:12px">
          将清理 <b style="color:var(--txt)">${items.length}</b> 个项目，释放约 <b style="color:var(--mint);font-size:16px">${fmt(bytes)}</b>${regN ? '，并删除 <b style="color:var(--txt)">' + regN + '</b> 条注册表记录' : ''}
        </div>
        <div class="card pad" style="padding:12px 14px;max-height:190px;overflow:auto">${rows}${items.length > 12 ? '<div class="dim" style="font-size:11.5px;margin-top:6px">… 等 ' + items.length + ' 项</div>' : ''}</div>
        ${risky.length ? '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(245,181,68,.1);border:1px solid rgba(245,181,68,.2);font-size:12px;color:#ffd28a">包含 ' + risky.length + ' 个个人数据/深度项目：' + esc(risky.slice(0, 4).map((x) => x.name).join('、')) + (risky.length > 4 ? ' 等' : '') + '，删除后不可恢复。</div>' : ''}`,
      foot: `<button class="btn" data-close>再想想</button><div class="spacer"></div><button class="btn danger" id="okClean">确认清理 ${fmt(bytes)}</button>`,
    });
    $('#okClean').onclick = () => { closeModal(); doClean(ids); };
  }

  async function doClean(ids) {
    if (APP.busy) return;
    APP.busy = true;
    let done = 0;
    const total = ids.length;
    showProgress('正在清理…', '准备中', 0, '0 / ' + total);
    try {
      await streamPost('/api/clean', { ids, ageDays: APP.age }, (ev) => {
        if (ev.type === 'item-start') {
          const t = ev.total || total;
          showProgress('正在清理…', ev.idx ? '(' + ev.idx + '/' + t + ') ' + ev.name : ev.name, (Math.max(0, (ev.idx || 1) - 1) / t) * 100, (ev.idx || 1) + ' / ' + t);
        } else if (ev.type === 'item-done') {
          done++;
          const t = ev.total || total;
          const cur = ((ev.idx || done) / t) * 100;
          showProgress('正在清理…', ev.name + (ev.message ? ' · ' + ev.message : '') + ' · 已释放 ' + fmt(ev.freed), cur, done + ' / ' + t);
        } else if (ev.type === 'done') {
          const freed = ev.freed;
          const regRemoved = (ev.results || []).filter((r) => r.group === 'reg').reduce((x, r) => x + (r.removed || 0), 0);
          const notes = (ev.results || []).filter((r) => r.message).slice(0, 5);
          const blocked = (ev.results || []).some((r) => String(r.message || '').indexOf('安全软件') >= 0);
          const tip = blocked
            ? '<div style="margin-top:12px;padding:11px 13px;border-radius:11px;background:rgba(245,181,68,.1);border:1px solid rgba(245,181,68,.22);font-size:12px;line-height:1.7;color:#ffd28a">'
            + '有项目报「被拦截 / 权限不足」。常见两种原因：<br>'
            + '① 程序放在了受限制的目录（某些沙箱、同步盘、只读盘），把它挪到普通目录（如 <b>D:\\Programs\\净界</b>）后重试；<br>'
            + '② 安全软件（火绒 / 360 / 电脑管家）拦了删除，把 <b>净界.exe</b> 加入信任区即可。</div>'
            : '';
          setTimeout(() => {
            hideProgress();
            openModal({
              size: 'sm', icon: 'check', title: '清理完成', desc: '本次清理结果',
              body: `<div style="text-align:center;padding:10px 0 4px">
                  <div class="dim" style="font-size:12px">共释放</div>
                  <div style="font-size:40px;font-weight:700;letter-spacing:-1.4px;background:linear-gradient(135deg,#34e5a4,#5b8cff);-webkit-background-clip:text;background-clip:text;color:transparent;margin:4px 0 2px">${fmt(freed)}</div>
                  <div class="dim" style="font-size:12px">清理 ${Math.max(0, ev.removed - regRemoved)} 个文件${regRemoved ? '，删除 ' + regRemoved + ' 条注册表记录' : ''}${ev.errors ? '，' + ev.errors + ' 个文件未能删除' : ''}</div>
                </div>
                <div class="kv" style="margin-top:16px">
                  ${ev.disks.map((d) => `<div class="cell"><div class="k">${esc(d.name)} 剩余空间</div><div class="v">${fmt(d.free)}</div></div>`).join('')}
                </div>
                ${notes.length ? '<div class="card pad" style="margin-top:14px;padding:12px 14px">' +
                '<div style="font-size:12px;color:var(--txt-3);margin-bottom:8px">以下项目未能全部清理</div>' +
                notes.map((r) => '<div class="part"><span class="p">' + esc(r.name) + '</span><span class="s" style="color:var(--txt-3);max-width:210px;text-align:right">' + esc(r.message) + '</span></div>').join('') +
                (ev.results.filter((r) => r.message).length > 5 ? '<div class="dim" style="font-size:11px;margin-top:4px">… 等</div>' : '') +
                '</div>' : ''}${tip}`,
              foot: `<div class="spacer"></div><button class="btn primary" data-close>完成</button>`,
            });
          }, 380);
          APP.sizes = {};
          APP.scannedAt = 0;
          setTimeout(() => { api('/api/disk').then((r) => { APP.st.disks = r.disks; if (APP.view === 'home') render(); }).catch(() => { }); }, 500);
        } else if (ev.type === 'error') toast('清理出错：' + ev.message, 'bad');
      });
    } catch (e) { toast('清理失败：' + e.message, 'bad'); }
    hideProgress();
    APP.busy = false;
    render();
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(o) {
    const ov = $('#overlay');
    ov.innerHTML = `<div class="mask" data-mask>
      <div class="modal ${o.size || ''}">
        <div class="modal-head">
          ${o.icon ? '<div class="ic" style="color:var(--mint)">' + icon(o.icon) + '</div>' : ''}
          <div><div class="t">${esc(o.title || '')}</div>${o.desc ? '<div class="d">' + esc(o.desc) + '</div>' : ''}</div>
          <button class="x" data-close>${icon('close')}</button>
        </div>
        <div class="modal-body">${o.body || ''}</div>
        ${o.foot ? '<div class="modal-foot">' + o.foot + '</div>' : ''}
      </div></div>`;
    ov.querySelectorAll('[data-close]').forEach((b) => b.onclick = closeModal);
    ov.querySelector('[data-mask]').addEventListener('mousedown', (e) => { if (e.target.hasAttribute('data-mask')) closeModal(); });
    return ov;
  }
  function closeModal() { $('#overlay').innerHTML = ''; }
  window.closeModal = closeModal;
  window.openModal = openModal;
  window.jjIcon = icon;
  /* 用外壳的默认浏览器打开链接（toolkit.js 也用这个，避免走 explorer.exe） */
  window.jjOpenUrl = (url) => { if (/^https?:\/\//i.test(url)) shellPost({ cmd: 'openurl', url }); };
  window.jjFmt = fmt;
  window.jjEsc = esc;
  window.jjApi = api;
  window.jjToast = toast;

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    const v = $('#viewInner');
    /* 侧栏导航（#nav 在 #viewInner 之外，需单独委托） */
    const navEl = $('#nav');
    if (navEl && !navEl.dataset.bound) {
      navEl.dataset.bound = '1';
      navEl.addEventListener('click', (e) => {
        const a = e.target.closest('[data-nav]');
        if (a) { e.preventDefault(); go(a.dataset.nav); }
      });
    }
    v.querySelectorAll('[data-nav]').forEach((el) => el.onclick = () => go(el.dataset.nav));
    v.querySelectorAll('[data-go]').forEach((el) => el.onclick = () => go(el.dataset.go));
    v.querySelectorAll('[data-tool]').forEach((el) => el.onclick = () => { if (window.openTool) window.openTool(el.dataset.tool); });

    const bAll = $('#btnScanAll'); if (bAll) bAll.onclick = () => doScan(null);
    const bElev = $('#btnElevate'); if (bElev) bElev.onclick = () => elevate();
    const bOne = $('#btnOneKey'); if (bOne) bOne.onclick = () => oneKeyClean();
    const bGo = $('#btnGoClean'); if (bGo) bGo.onclick = () => go('clean', 'sys');
    const bAll2 = $('#btnScanAll2'); if (bAll2) bAll2.onclick = () => doScan(null);
    const bHelp = $('#btnWarnHelp'); if (bHelp) bHelp.onclick = () => openModal({
      size: 'sm', icon: 'shield', title: '为什么删不掉', desc: '删除操作被拒绝时的排查顺序',
      body: `<div style="font-size:13px;color:var(--txt-2);line-height:1.9">
        <b style="color:var(--txt)">1. 先看程序放在哪。</b>如果「净界」放在被策略限制的目录里（企业管控目录、某些同步盘 / 只读盘、沙箱工作目录），任何程序在那里都无法删除用户目录里的文件。把整个文件夹挪到普通位置，例如
        <span class="mono">D:\\Programs\\净界</span> 或 <span class="mono">C:\\Users\\你\\AppData\\Local\\Programs\\净界</span>，然后从新位置启动。<br>
        <b style="color:var(--txt)">2. 再看安全软件。</b>火绒 → 防护中心 → 系统防护 → 文件实时监控 → 信任区；360 → 设置 → 信任与阻止；电脑管家 → 设置中心 → 信任区；Defender → 病毒和威胁防护 → 排除项。把这些位置加入信任，选择 <span class="mono">净界.exe</span>。<br>
        <b style="color:var(--txt)">3. 系统级项目要管理员。</b>Windows 临时文件、系统日志、更新缓存、Windows.old 这些需要右键「以管理员身份运行」。<br>
        <div style="margin-top:10px;color:var(--txt-3);font-size:12px">点「重新检测」可以立刻验证是否已经放行。</div>
      </div>`,
      foot: `<div class="spacer"></div><button class="btn" id="btnReprobe">重新检测</button><button class="btn primary" data-close>知道了</button>`,
    });
    const bRe = $('#btnReprobe'); if (bRe) bRe.onclick = async () => {
      try {
        const r = await api('/api/probe?force=1');
        APP.st.probe = r.probe;
        closeModal();
        render();
        toast(r.probe.canDelete ? '现在可以正常删除了' : '仍然删不掉，按上面三步再排查', r.probe.canDelete ? 'good' : 'bad');
      } catch (e) { toast('检测失败：' + e.message, 'bad'); }
    };
    const bGrp = $('#btnScanGroup'); if (bGrp) bGrp.onclick = () => {
      const gid = APP.view === 'wx' ? 'wx' : APP.view === 'qq' ? 'qq' : APP.gid;
      const ids = (APP.st.groups.find((g) => g.id === gid) || { items: [] }).items.map((x) => x.id);
      doScan(ids);
    };
    const bClean = $('#btnClean'); if (bClean) bClean.onclick = () => confirmClean(selectedIds());
    const bClean2 = $('#btnClean2'); if (bClean2) bClean2.onclick = () => confirmClean(selectedIds());
    const age = $('#ageSel'); if (age) age.onchange = () => { APP.age = parseInt(age.value, 10) || 0; if (APP.scannedAt) doScan(null); else render(); };
    const all = $('#btnSelAll'); if (all) all.onclick = () => { viewItems().forEach((it) => { if (it.available !== false && !needAdmin(it)) APP.sel[it.id] = true; }); render(); };
    const safe = $('#btnSelSafe'); if (safe) safe.onclick = () => { viewItems().forEach((it) => { APP.sel[it.id] = it.risk === 'safe' && it.def && !needAdmin(it); }); render(); };
    v.querySelectorAll('[data-tab]').forEach((el) => el.onclick = () => { APP.gid = el.dataset.tab; go('clean', el.dataset.tab); });
    v.querySelectorAll('[data-check]').forEach((el) => el.onclick = (e) => {
      e.stopPropagation();
      const id = el.dataset.check;
      if (needAdmin(itemById(id))) { toast('「' + itemById(id).name + '」需要管理员权限，请右键以管理员身份运行', 'warn'); return; }
      APP.sel[id] = !APP.sel[id];
      el.classList.toggle('on', !!APP.sel[id]);
      const row = el.closest('.item'); if (row) row.classList.toggle('checked', !!APP.sel[id]);
      updateSummary();
    });
    v.querySelectorAll('[data-exp]').forEach((el) => el.onclick = (e) => { e.stopPropagation(); APP.openParts = APP.openParts === el.dataset.exp ? null : el.dataset.exp; render(); });
    v.querySelectorAll('[data-know]').forEach((el) => el.onclick = (e) => {
      e.stopPropagation();
      const it = itemById(el.dataset.know);
      if (it) explainItem(it);
    });
    v.querySelectorAll('.item').forEach((el) => el.onclick = () => {
      const id = el.dataset.item;
      if (needAdmin(itemById(id))) { toast('「' + itemById(id).name + '」需要管理员权限，请右键以管理员身份运行', 'warn'); return; }
      /* 只切换这一个条目的状态，不整页重绘（重绘会打断滚动、也会重放淡入动画） */
      APP.sel[id] = !APP.sel[id];
      el.classList.toggle('checked', !!APP.sel[id]);
      const cb = el.querySelector('[data-check]'); if (cb) cb.classList.toggle('on', !!APP.sel[id]);
      updateSummary();
    });
  }

  /* 只改动磁盘条与环形图，避免每 15 秒整页重绘造成的卡顿感 */
  function paintDisks() {
    const disks = (APP.st && APP.st.disks) || [];
    document.querySelectorAll('.disk-row[data-disk]').forEach((row) => {
      const key = row.getAttribute('data-disk');
      const d = disks.find((x) => String(x.name).charAt(0) === key);
      if (!d) return;
      const used = d.total - d.free;
      const p = d.total ? (used / d.total) * 100 : 0;
      const fill = row.querySelector('.fill');
      if (fill) {
        fill.className = 'fill' + (p > 90 ? ' danger' : (p > 78 ? ' warn' : ''));
        fill.style.width = Math.max(p, 1.5).toFixed(1) + '%';
      }
      const val = row.querySelector('.val');
      if (val) val.innerHTML = '<b>' + p.toFixed(0) + '%</b> 已用 · 剩 ' + fmt(d.free) + ' / ' + fmt(d.total);
    });
  }

  function updateSummary() {
    const bar = document.querySelector('.summary-bar .txt');
    if (!bar) return;
    bar.innerHTML = `已选 <b>${selectedIds().length}</b> 项，预计释放 <b>${fmt(selectedBytes())}</b>${APP.scannedAt ? '' : ' · 请先扫描'}`;
    const b = $('#btnClean2'); if (b) b.disabled = !(selectedIds().length && (selectedBytes() || selectedRegCount()));
    const b1 = $('#btnClean'); if (b1) b1.disabled = !(selectedIds().length && selectedBytes());
  }

  /* ---------------- 主题 ---------------- */
  const THEME_KEY = 'jj-theme';
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
    const btn = $('#themeBtn');
    if (!btn) return;
    btn.innerHTML = icon(t === 'light' ? 'sun' : 'moon')
      + '<span>' + (t === 'light' ? '浅色主题' : '深色主题') + '</span>';
  }
  function initTheme() {
    /* 主题以 data\settings.json 为准（服务端已把它写进 <html data-theme>，所以首帧就是对的）；
       state 还没拿到时，优先读 DOM 上的值，避免用 localStorage 覆盖成旧主题 */
    const fromServer = APP.st && APP.st.settings ? APP.st.settings.theme : null;
    const fromDom = document.documentElement.getAttribute('data-theme');
    const saved = fromServer || (fromDom === 'light' || fromDom === 'dark' ? fromDom : null)
      || localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved);
    const btn = $('#themeBtn');
    if (!btn) return;
    btn.onclick = () => {
      const now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      localStorage.setItem(THEME_KEY, now);
      applyTheme(now);
      api('/api/settings', { method: 'POST', body: JSON.stringify({ theme: now }) }).catch(() => { });
    };
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    window.addEventListener('error', (e) => { try { toast('脚本错误：' + e.message, 'bad'); } catch (x) { } });
    window.addEventListener('unhandledrejection', (e) => {
      try { toast('请求失败：' + ((e.reason && (e.reason.message || e.reason)) || '未知'), 'bad'); } catch (x) { }
    });
    $('#verLine').textContent = 'v' + VER;
    initTheme();
    $('#brandLogo').innerHTML = icon('sparkle');
    $('#btnMin').innerHTML = icon('minus');
    $('#btnMax').innerHTML = icon('square');
    $('#btnClose').innerHTML = icon('close');
    $('#btnClose').title = '最小化到托盘（右键托盘图标可退出）';
    $('#btnMin').title = '最小化';
    const post = (cmdOrObj) => { try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(typeof cmdOrObj === 'string' ? { cmd: cmdOrObj } : cmdOrObj); } catch (e) { } };
    $('#btnMin').onclick = () => post('min');
    $('#btnMax').onclick = () => post('max');
    $('#btnClose').onclick = () => post('close');
    /* 无边框窗口拖动：标题栏区域按下左键时通知外壳；双击切换最大化 */
    const tb = $('#topbar');
    if (tb) {
      tb.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        post('drag');
      });
      tb.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        post('max');
      });
    }

    /* 无边框窗口缩放：在窗口四边/四角按下鼠标时，把位移交给外壳改窗口大小。
       用 document 捕获阶段判断位置，不再依赖细小的热区元素（那种容易点不中）。 */
    (function initResize() {
      const SEL = 8;               /* 边缘判定宽度（CSS px） */
      const send = (obj) => { try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(obj); } catch (e) { } };
      document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const W = window.innerWidth, H = window.innerHeight;
        let dir = '';
        if (e.clientY <= SEL) dir += 'n'; else if (e.clientY >= H - SEL) dir += 's';
        if (e.clientX <= SEL) dir += 'w'; else if (e.clientX >= W - SEL) dir += 'e';
        if (!dir) return;
        e.preventDefault();
        e.stopPropagation();
        const sx = e.screenX, sy = e.screenY, dpr = window.devicePixelRatio || 1;
        send({ cmd: 'rzStart', edge: dir });
        const onMove = (e2) => send({
          cmd: 'rzMove',
          dx: Math.round((e2.screenX - sx) * dpr),
          dy: Math.round((e2.screenY - sy) * dpr)
        });
        const onUp = () => {
          document.removeEventListener('pointermove', onMove, true);
          document.removeEventListener('pointerup', onUp, true);
          document.removeEventListener('pointercancel', onUp, true);
          send({ cmd: 'rzEnd' });
        };
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onUp, true);
      }, true);
    })();

    try {
      APP.st = await api('/api/state');
    } catch (e) {
      document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;color:#9aa6bd;font-size:13px">无法连接本地服务：' + esc(e.message) + '</div>';
      return;
    }
    $('#sysChip').innerHTML = '<span class="dot"></span><span>' + esc(APP.st.os.caption.replace(/Windows 10/, 'Windows 11')) +
      '</span><span class="admin-tag">' + (APP.st.admin ? '管理员' : '普通') + '</span>';
    initTheme();   /* 拿到 state 后按服务端保存的主题再定一次 */
    /* 恢复上次扫描结果 */
    if (APP.st.scan && APP.st.scan.items) {
      APP.sizes = APP.st.scan.items;
      APP.scannedAt = APP.st.scan.at || 0;
      APP.age = APP.st.scan.age || 0;
    }
    defaultSel();
    /* 刷新后回到原来的页面（#tools / #clean/sys 之类） */
    const hash = (location.hash || '').replace(/^#/, '');
    if (hash) {
      const parts = hash.split('/');
      const known = ['home', 'clean', 'wx', 'qq', 'tools', 'about'];
      if (known.indexOf(parts[0]) >= 0) {
        APP.view = parts[0];
        if (parts[0] === 'clean' && parts[1]) APP.gid = parts[1];
      }
    }
    render();
    /* 首页磁盘占用每 15 秒自动刷新（清理/下载时会动） */
    setInterval(async () => {
      if (APP.view !== 'home' || APP.busy) return;
      try { const r = await api('/api/disk'); APP.st.disks = r.disks; paintDisks(); } catch (e) { }
    }, 15000);
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('DOMContentLoaded', boot);
})();
