/* 净界 - 工具面板 */
(function () {
  const fmt = window.jjFmt, esc = window.jjEsc, api = window.jjApi, toast = window.jjToast;

  const runTool = (id, params) => api('/api/tool/' + id, { method: 'POST', body: JSON.stringify(Object.assign({ __run: true }, params || {})) });
  const actTool = (id, params) => api('/api/tool/' + id, { method: 'POST', body: JSON.stringify(params || {}) });
  const reveal = (p) => api('/api/reveal', { method: 'POST', body: JSON.stringify({ path: p }) }).catch(() => { });

  function table(cols, rows, opts) {
    if (!rows || !rows.length) return '<div class="empty">' + jjIcon('search') + '<div>没有数据</div></div>';
    const head = cols.map((c) => '<th' + (c.style ? ' style="' + c.style + '"' : '') + '>' + esc(c.label) + '</th>').join('');
    const body = rows.map((r, i) => '<tr data-i="' + i + '">' + cols.map((c) => {
      const v = typeof c.v === 'function' ? c.v(r, i) : r[c.k];
      return '<td class="' + (c.cls || '') + '">' + (c.html ? v : esc(v == null ? '' : v)) + '</td>';
    }).join('') + '</tr>').join('');
    return '<div style="overflow:auto;max-height:' + (opts && opts.h ? opts.h : 420) + 'px"><table class="tb"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function fieldInput(f) {
    return '<div class="field"><label>' + esc(f.label) + '</label>' +
      (f.type === 'textarea'
        ? '<textarea id="f_' + f.key + '">' + esc(f.def || '') + '</textarea>'
        : '<input id="f_' + f.key + '" type="' + (f.type === 'number' ? 'number' : 'text') + '" value="' + esc(f.def == null ? '' : f.def) + '" placeholder="' + esc(f.label) + '">') +
      (f.key === 'root' || f.key === 'target' ? '<button class="btn sm" data-browse="' + f.key + '">选择</button>' : '') +
      '</div>';
  }

  function collect(meta) {
    const p = {};
    for (const f of meta.fields || []) {
      const el = document.getElementById('f_' + f.key);
      if (el) p[f.key] = f.type === 'number' ? Number(el.value) : el.value;
    }
    return p;
  }

  /* ---------------- 各工具的渲染 ---------------- */
  const R = {
    sysinfo(d) {
      const i = d.info || {};
      const kv = [
        ['处理器', i.cpu + '（' + i.cores + ' 核 ' + i.threads + ' 线程）'],
        ['内存', i.ramTotal + ' GB（可用 ' + i.ramFree + ' GB）'],
        ['显卡', i.gpu],
        ['主板', i.board],
        ['品牌型号', i.brand + ' ' + i.model],
        ['系统', i.os + ' build ' + i.build + ' ' + i.arch],
        ['安装日期', i.install],
        ['上次启动', i.boot + '（' + i.uptime + ' 小时前）'],
      ].map(([k, v]) => '<div class="cell"><div class="k">' + k + '</div><div class="v">' + esc(v || '-') + '</div></div>').join('');
      const disks = (d.disks || []).map((x) => {
        const p = ((x.total - x.free) / x.total) * 100;
        return '<div class="bar-item"><div class="row"><span class="nm">' + esc(x.name) + ' ' + esc(x.label || '') + '　' + esc(x.fs) + '</span><span class="vl">' + fmt(x.free) + ' 可用 / ' + fmt(x.total) + '</span></div><div class="track"><div class="fill" style="width:' + p.toFixed(1) + '%"></div></div></div>';
      }).join('');
      return '<div class="kv">' + kv + '</div><div class="sec-head"><h3>磁盘</h3><div class="line"></div></div><div class="bar-list">' + disks + '</div>';
    },

    startup(d, meta) {
      const rows = (d.items || []).map((x) => Object.assign({}, x));
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div class="dim" style="font-size:12px">共 ' + rows.length + ' 项，禁用后不再开机启动，可随时恢复</div><div style="flex:1"></div><button class="btn sm" data-startup-refresh>' + jjIcon('refresh') + '刷新</button></div>' +
        table([
          { k: 'enabled', label: '状态', html: true, v: (r) => r.enabled ? '<span class="badge safe">启用</span>' : '<span class="badge off">已禁用</span>' },
          { k: 'name', label: '名称', cls: 'strong' },
          { k: 'act', label: '操作', html: true, v: (r) => '<div style="display:flex;gap:4px">' +
              '<button class="btn sm ghost" data-inspect="' + esc(r.cmd) + '">' + jjIcon('search') + '查询</button>' +
              '<button class="btn sm" data-k="' + esc(JSON.stringify(r)) + '">' + (r.enabled ? '禁用' : '恢复') + '</button></div>' },
          { k: 'cmd', label: '命令', cls: 'row-path', v: (r) => r.cmd },
          { k: 'where', label: '位置', cls: 'dim' },
        ], rows);
    },

    services(d) {
      const rows = d.items || [];
      return '<div class="dim" style="font-size:12px;margin-bottom:10px">修改服务需要管理员权限；标有「谨慎」的服务可能影响系统功能，请阅读说明后操作。</div>' +
        table([
          { k: 'title', label: '服务', cls: 'strong', v: (r) => r.title + ' <span class="dim mono" style="font-size:10.5px">' + r.name + '</span>', html: true },
          { k: 'status', label: '状态', html: true, v: (r) => '<span class="badge ' + (r.status === 'Running' ? 'safe' : 'off') + '">' + (r.status === 'Running' ? '运行中' : r.status === 'Stopped' ? '已停止' : r.status) + '</span> <span class="dim" style="font-size:10.5px">' + r.startMode + '</span>' },
          { k: 'act', label: '操作', html: true, v: (r) => '<div style="display:flex;gap:4px">' +
              (r.status === 'Running' ? '<button class="btn sm" data-svc="stop" data-name="' + r.name + '">停止</button>' : '<button class="btn sm" data-svc="start" data-name="' + r.name + '">启动</button>') +
              '<button class="btn sm ghost" data-svc="' + (r.startMode === 'Disabled' ? 'manual' : 'disable') + '" data-name="' + r.name + '">' + (r.startMode === 'Disabled' ? '启用' : '禁用') + '</button></div>' },
          { k: 'desc', label: '说明', cls: 'dim' },
        ], rows, { h: 460 });
    },

    ctxmenu(d) {
      const rows = d.items || [];
      return '<div class="dim" style="font-size:12px;margin-bottom:10px">隐藏不需要的右键菜单，不影响功能，可随时恢复。</div>' +
        table([
          { k: 'name', label: '菜单项', cls: 'strong' },
          { k: 'label', label: '出现位置' },
          { k: 'cmd', label: '命令', cls: 'row-path', v: (r) => r.cmd || '-' },
          { k: 'act', label: '', html: true, v: (r) => '<button class="btn sm ' + (r.blocked ? 'ghost' : '') + '" data-ctx="' + esc(r.id) + '" data-on="' + (r.blocked ? '1' : '0') + '">' + (r.blocked ? '恢复显示' : '隐藏') + '</button>' },
        ], rows, { h: 460 });
    },

    bigfiles(d) {
      return '<div class="dim" style="font-size:12px;margin-bottom:10px">共找到 <b style="color:var(--txt)">' + d.total + '</b> 个文件，显示体积最大的 ' + d.files.length + ' 个。双击可在资源管理器中定位。</div>' +
        table([
          { k: 'path', label: '文件', cls: 'row-path', v: (r) => r.path },
          { k: 'size', label: '大小', cls: 'right', v: (r) => fmt(r.size) },
          { k: 'mtime', label: '修改时间', cls: 'dim', v: (r) => new Date(r.mtime).toLocaleDateString('zh-CN') },
          { k: 'act', label: '', html: true, v: (r) => '<button class="btn sm ghost" data-reveal="' + esc(r.path) + '">定位</button>' },
        ], d.files, { h: 440 });
    },

    dupfiles(d) {
      if (!d.groups || !d.groups.length) return '<div class="empty">' + jjIcon('copy') + '<div>没有找到重复文件</div></div>';
      const head = '<div class="dim" style="font-size:12px;margin-bottom:12px">发现 <b style="color:var(--txt)">' + d.groups.length + '</b> 组重复文件，可节省 <b style="color:var(--mint)">' + fmt(d.waste) + '</b>（每组保留第一个）</div>';
      const items = d.groups.map((g, gi) => {
        const files = g.files.map((f, fi) => '<div class="part" style="direction:ltr;text-align:left"><span class="p" title="' + esc(f) + '">' + (fi === 0 ? '✓ ' : '· ') + esc(f) + '</span></div>').join('');
        return '<div class="card pad" style="padding:11px 14px;margin-bottom:8px"><div style="display:flex;align-items:center;gap:10px"><span class="badge safe">' + fmt(g.size) + '</span><span class="dim" style="font-size:11.5px">' + g.files.length + ' 个相同文件</span><div style="flex:1"></div><button class="btn sm danger" data-dup="' + gi + '">删除副本</button></div><div style="margin-top:8px">' + files + '</div></div>';
      }).join('');
      return head + items;
    },

    emptyfolders(d) {
      if (!d.folders.length) return '<div class="empty">' + jjIcon('folder') + '<div>没有发现空文件夹</div></div>';
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div class="dim" style="font-size:12px">共 ' + d.folders.length + ' 个空文件夹</div><div style="flex:1"></div><button class="btn sm danger" data-empty-del>' + jjIcon('trash') + '全部删除</button></div>' +
        table([{ k: 'p', label: '路径', v: (r) => r, cls: 'row-path' }], d.folders, { h: 400 });
    },

    diskusage(d) {
      if (!d.items || !d.items.length) return '<div class="empty">没有数据</div>';
      const max = d.items[0].size || 1;
      return '<div class="dim" style="font-size:12px;margin-bottom:12px">' + esc(d.root) + ' 下最占空间的 ' + d.items.length + ' 个条目</div>' +
        '<div class="bar-list">' + d.items.map((x) => '<div class="bar-item"><div class="row"><span class="nm" title="' + esc(x.path) + '">' + (x.dir ? jjIcon('folder') : jjIcon('file')) + ' ' + esc(x.name) + '</span><span class="vl">' + fmt(x.size) + '</span><button class="btn sm ghost" data-reveal="' + esc(x.path) + '">打开</button></div><div class="track"><div class="fill" style="width:' + ((x.size / max) * 100).toFixed(1) + '%"></div></div></div>').join('') + '</div>';
    },

    processes(d) {
      const rows = d.items || [];
      return '<div class="dim" style="font-size:12px;margin-bottom:10px">按内存占用排序，共 ' + rows.length + ' 个进程</div>' +
        table([
          { k: 'ProcessName', label: '进程', cls: 'strong' },
          { k: 'Id', label: 'PID', cls: 'dim' },
          { k: 'mem', label: '内存', cls: 'right', v: (r) => r.mem + ' MB' },
          { k: 'cpu', label: 'CPU 秒', cls: 'right', v: (r) => r.cpu || 0 },
          { k: 'Path', label: '路径', cls: 'row-path', v: (r) => r.Path || '-' },
          { k: 'act', label: '', html: true, v: (r) => '<button class="btn sm danger" data-kill="' + r.Id + '">结束</button>' },
        ], rows, { h: 440 });
    },

    network(d, meta) {
      const i = d.info || {};
      return '<div class="kv" style="margin:4px 0 12px">' +
        '<div class="cell"><div class="k">本机 IP</div><div class="v mono">' + esc(i.ip || '-') + '</div></div>' +
        '<div class="cell"><div class="k">默认网关</div><div class="v mono">' + esc(i.gw || '-') + '</div></div>' +
        '<div class="cell"><div class="k">DNS 服务器</div><div class="v mono">' + esc(i.dns || '-') + '</div></div>' +
        '<div class="cell"><div class="k">网卡 MAC</div><div class="v mono">' + esc(i.mac || '-') + '</div></div></div>' +
        '<div class="sec-head" style="margin-top:6px"><h3>Ping 结果</h3><div class="line"></div></div>' +
        '<pre class="log" style="max-height:220px">' + esc(d.ping || '') + '</pre>' +
        '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn" data-net="flushdns">' + jjIcon('refresh') + '刷新 DNS 缓存</button><button class="btn" data-net="renew">重新获取 IP</button></div>';
    },

    shred(d, meta) {
      return '<div class="danger-note">' +
        '文件粉碎会用随机数据覆盖文件内容 3 次再删除，<b>无法恢复</b>。固态硬盘因磨损均衡机制，覆盖效果有限，请知悉。</div>' +
        '<div class="field"><label>文件或文件夹</label><input id="f_target" value="' + esc(meta.__target || '') + '" placeholder="C:\\路径\\文件"><button class="btn sm" data-browse="target">选择</button></div>' +
        '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn danger" data-shred>开始粉碎</button><span class="dim" style="font-size:11.5px;align-self:center" id="shredOut"></span></div>';
    },

    power() {
      const b = (cmd, label, ic, danger) => '<button class="btn ' + (danger ? 'danger' : '') + '" data-pw="' + cmd + '" style="height:52px;flex-direction:column;gap:4px">' + jjIcon(ic) + '<span style="font-size:12px">' + label + '</span></button>';
      return '<div class="field"><label>倒计时（秒）</label><input id="f_seconds" type="number" value="60"></div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px">' +
        b('shutdown', '定时关机', 'power', false) + b('restart', '定时重启', 'refresh', false) + b('lock', '立即锁屏', 'lock', false) +
        b('sleep', '进入睡眠', 'clock', false) + b('abort', '取消关机', 'close', false) +
        '</div><div class="dim" style="font-size:11.5px;margin-top:12px">关机会有 60 秒倒计时，期间可点击「取消关机」撤回。</div>';
    },

    boottime(d) {
      const rows = (d.items || []).slice().reverse();
      return '<div class="dim" style="font-size:12px;margin-bottom:10px">' + esc(d.note || '来自系统性能日志（最近 10 次）') + '</div>' +
        table([
          { k: 'time', label: '开机时间', cls: 'strong' },
          { k: 'ms', label: '耗时', cls: 'right', v: (r) => (r.ms ? (r.ms / 1000).toFixed(1) + ' 秒' : '-') },
        ], rows);
    },

    envvars(d) {
      const rows = (d.items || []).map((x) => Object.assign({}, x, { isPath: x.name.toUpperCase() === 'PATH' }));
      return '<div style="display:flex;gap:8px;margin-bottom:12px"><input id="f_name" placeholder="变量名（如 JAVA_HOME）" style="flex:1;height:34px;padding:0 11px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid var(--line);outline:none"><input id="f_value" placeholder="值" style="flex:2;height:34px;padding:0 11px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid var(--line);outline:none"><button class="btn sm" data-env-add>添加/修改</button></div>' +
        table([
          { k: 'name', label: '变量', cls: 'strong' },
          { k: 'value', label: '值', cls: 'row-path', v: (r) => r.value },
          { k: 'act', label: '', html: true, v: (r) => '<button class="btn sm ghost" data-env-del="' + esc(r.name) + '">删除</button>' },
        ], rows, { h: 400 });
    },

    restore(d) {
      return '<div class="field"><label>还原点说明</label><input id="f_desc" value="净界手动创建"><button class="btn sm" data-rp="create">立即创建</button></div>' +
        '<div class="dim" style="font-size:11.5px;margin-bottom:10px">创建还原点需要管理员权限，且系统保护必须已开启。</div>' +
        table([
          { k: 'time', label: '时间', cls: 'strong' },
          { k: 'Description', label: '说明' },
          { k: 'SequenceNumber', label: '序号', cls: 'dim' },
        ], (d.items || []).slice().reverse());
    },

    hosts(d) {
      return '<div class="field" style="align-items:flex-start"><label style="padding-top:8px">hosts</label><textarea id="f_content" style="height:330px">' + esc(d.content) + '</textarea></div>' +
        '<div style="display:flex;align-items:center;gap:10px"><button class="btn" data-hosts-save>保存（自动备份）</button><span class="dim mono" style="font-size:11px">' + esc(d.path) + '</span><div style="flex:1"></div><span class="dim" style="font-size:11px">备份 ' + d.backups.length + ' 份</span></div>';
    },

    repair(d) {
      return '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">' +
        '<button class="btn" data-fix="sfc">SFC 系统文件扫描</button>' +
        '<button class="btn" data-fix="dism">DISM 映像修复</button>' +
        '<button class="btn" data-fix="chkdsk">磁盘检查（扫描）</button>' +
        '<button class="btn" data-fix="defrag">SSD 优化 / 碎片整理</button>' +
        '</div><div class="dim" style="font-size:11.5px;margin-bottom:8px">需要管理员权限；SFC / DISM 可能运行 5~30 分钟，可关闭窗口后台继续。</div>' +
        '<pre class="log" id="fixLog" style="max-height:300px">' + esc((d.jobs[0] && d.jobs[0].log) || '（尚无输出）') + '</pre>';
    },
  };

  /* ---------------- 面板打开 ---------------- */
  /* 启动项「查询」：解析程序 + 版本信息 + 数字签名，并可一键联网搜索 */
  async function inspectStartup(cmd) {
    const body = '<div id="insBody"><div style="display:flex;gap:8px;align-items:center;color:var(--txt-3);font-size:12.5px;padding:14px 0"><span class="skel" style="width:13px;height:13px;border-radius:50%"></span>正在读取程序信息…</div></div>';
    window.openModal({ icon: 'search', title: '这是什么东西？', desc: '读取程序的厂商、版本与数字签名', body, foot: '<div class="spacer"></div><button class="btn" data-close>关闭</button>' });
    const el = () => document.getElementById('insBody');
    try {
      const r = await actTool('startup', { cmd: 'inspect', target: cmd });
      const i = r.info || {};
      const row = (k, v) => v ? '<div class="cell"><div class="k">' + k + '</div><div class="v">' + esc(v) + '</div></div>' : '';
      const signed = /Valid/i.test(i.sigStatus || '');
      const sigText = i.sigStatus ? (signed ? '已签名（' + esc(i.signer || '') + '）' : '未签名 / ' + esc(i.sigStatus)) : '未知';
      const q = [i.company, i.product].filter(Boolean).join(' ') || (i.path || '').split('\\').pop() || cmd;
      const url = 'https://www.bing.com/search?q=' + encodeURIComponent(q + ' 是什么程序 启动项');
      el().innerHTML =
        (i.exists ? '' : '<div class="danger-note" style="margin-bottom:12px">找不到这个文件 —— 程序可能已卸载，或路径写错了，这条启动项可以放心禁用。</div>') +
        '<div class="kv">' +
          row('程序名称', i.desc || i.product) + row('厂商', i.company) + row('产品', i.product) +
          row('版本', i.version) + row('数字签名', sigText) +
          row('文件大小', fmt(i.size)) + row('修改时间', (i.mtime || '').replace('T', ' ').slice(0, 19)) +
          row('程序路径', i.path) + (i.viaLnk ? row('快捷方式', i.viaLnk) : '') +
          row('启动命令', i.cmd) +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
          (i.exists ? '<button class="btn sm" data-ins-reveal="' + esc(i.path) + '">' + jjIcon('folder') + '打开所在位置</button>' : '') +
          '<button class="btn sm" data-ins-web="' + esc(url) + '">' + jjIcon('globe') + '联网查一查</button>' +
        '</div>' +
        '<div class="dim" style="font-size:11.5px;margin-top:10px;line-height:1.6">' +
          (i.exists && signed ? '这个程序有有效数字签名，来源基本可信。' : '没有有效签名不等于有毒，但来源不明的启动项建议先联网确认，再决定是否禁用。') +
        '</div>';
      const b1 = el().querySelector('[data-ins-reveal]');
      if (b1) b1.onclick = () => reveal(b1.dataset.insReveal);
      const b2 = el().querySelector('[data-ins-web]');
      if (b2) b2.onclick = () => { window.jjOpenUrl(b2.dataset.insWeb); toast('已在默认浏览器中打开搜索'); };
    } catch (e) {
      el().innerHTML = '<div class="empty">查询失败：' + esc(e.message) + '</div>';
    }
  }

  async function openTool(id) {
    const meta = (window.APP.st.tools || []).find((t) => t.id === id);
    if (!meta) return;
    const body = '<div id="toolBody"><div style="display:flex;gap:8px;align-items:center;color:var(--txt-3);font-size:12.5px;padding:16px 0"><span class="skel" style="width:14px;height:14px;border-radius:50%"></span><span id="toolWait">正在读取…</span></div></div>';
    window.openModal({ icon: meta.icon, title: meta.name, desc: meta.desc, body, foot: '<div class="spacer"></div><button class="btn" data-close>关闭</button>' });
    /* 有些工具要调 PowerShell，第一次可能要几秒，把已用时间显示出来免得像卡住 */
    const t0 = Date.now();
    const waitTimer = setInterval(() => {
      const el = document.getElementById('toolWait');
      if (!el) { clearInterval(waitTimer); return; }
      el.textContent = '正在读取…（已用 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒）';
    }, 200);
    const stopWait = () => clearInterval(waitTimer);
    const state = {};
    const render = (html) => { stopWait(); document.getElementById('toolBody').innerHTML = html; bindBody(); };

    function bindBody() {
      const el = document.getElementById('toolBody');
      el.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = () => reveal(b.dataset.reveal));
      el.querySelectorAll('[data-browse]').forEach((b) => b.onclick = async () => {
        const p = await api('/api/pick').catch(() => null);
        if (p && p.path) { const inp = document.getElementById('f_' + b.dataset.browse); if (inp) inp.value = p.path; }
        else toast('选择器不可用，请手动输入路径');
      });
      el.querySelectorAll('[data-kill]').forEach((b) => b.onclick = async () => {
        const r = await actTool('processes', { pid: Number(b.dataset.kill) });
        toast(r.ok ? '进程已结束' : '结束失败（可能需要权限）', r.ok ? 'good' : 'bad');
        if (r.ok) refresh();
      });
      el.querySelectorAll('[data-ctx]').forEach((b) => b.onclick = async () => {
        const on = b.dataset.on === '1';
        await actTool('ctxmenu', { id: b.dataset.ctx, enabled: on });
        refresh();
      });
      el.querySelectorAll('[data-svc]').forEach((b) => b.onclick = async () => {
        if (b.dataset.svc === 'disable' && !confirm('禁用服务 ' + b.dataset.name + ' ？\n禁用后相关功能会失效，需要时可再点「启用」恢复。')) return;
        const r = await actTool('services', { name: b.dataset.name, cmd: b.dataset.svc });
        toast(r.ok ? '操作成功' : ('失败：' + (r.out || '需要管理员权限')), r.ok ? 'good' : 'bad');
        refresh();
      });
      el.querySelectorAll('[data-startup-refresh]').forEach((b) => b.onclick = refresh);
      el.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => {
        let item = null;
        try { item = JSON.parse(b.dataset.k); } catch (e) { return toast('数据异常', 'bad'); }
        b.disabled = true;
        try {
          const r = await actTool('startup', { item });
          toast(r.enabled ? '已恢复开机启动' : '已禁用，可随时恢复', 'good');
        } catch (e) {
          toast('操作失败：' + e.message, 'bad');
        }
        refresh();
      });
      el.querySelectorAll('[data-inspect]').forEach((b) => b.onclick = () => inspectStartup(b.dataset.inspect));
      el.querySelectorAll('table.tb tbody tr').forEach((tr) => {
        tr.ondblclick = () => { const btn = tr.querySelector('[data-reveal]'); if (btn) reveal(btn.dataset.reveal); };
      });
      el.querySelectorAll('[data-dup]').forEach((b) => b.onclick = async () => {
        const g = state.data.groups[Number(b.dataset.dup)];
        const files = g.files.slice(1);
        if (!confirm('删除 ' + files.length + ' 个副本？此操作不可撤销')) return;
        const r = await actTool('dupfiles', { files });
        toast('已删除 ' + r.removed + ' 个副本', 'good');
        refresh();
      });
      el.querySelectorAll('[data-empty-del]').forEach((b) => b.onclick = async () => {
        const list = (state.data && state.data.folders) || [];
        const preview = list.slice(0, 5).map((x) => '· ' + x).join('\n');
        if (!confirm('确认删除这 ' + list.length + ' 个空文件夹？\n\n' + preview + (list.length > 5 ? '\n· …' : '') + '\n\n只删除空目录，里面只要有一个文件就会跳过；操作不可撤销。')) return;
        const r = await actTool('emptyfolders', { folders: list });
        toast('已删除 ' + r.removed + ' 个空文件夹', 'good');
        refresh();
      });
      el.querySelectorAll('[data-env-add]').forEach((b) => b.onclick = async () => {
        const n = document.getElementById('f_name').value.trim(), v = document.getElementById('f_value').value;
        if (!n) return toast('请填写变量名', 'bad');
        const r = await actTool('envvars', { cmd: 'set', name: n, value: v });
        toast(r.ok ? '已保存' : '保存失败', r.ok ? 'good' : 'bad');
        refresh();
      });
      el.querySelectorAll('[data-env-del]').forEach((b) => b.onclick = async () => {
        if (!confirm('删除变量 ' + b.dataset.envDel + ' ?')) return;
        await actTool('envvars', { cmd: 'del', name: b.dataset.envDel });
        refresh();
      });
      el.querySelectorAll('[data-net]').forEach((b) => b.onclick = async () => {
        const r = await actTool('network', { cmd: b.dataset.net });
        toast(r.ok ? '操作完成' : '操作失败', r.ok ? 'good' : 'bad');
      });
      el.querySelectorAll('[data-net-ping]').forEach((b) => b.onclick = async () => {
        const host = document.getElementById('f_host').value;
        const r = await runTool('network', { host });
        state.data = r.data;
        render(R.network(r.data, { __host: host }));
      });
      el.querySelectorAll('[data-shred]').forEach((b) => b.onclick = async () => {
        const t = document.getElementById('f_target').value;
        if (!t) return toast('请填写路径', 'bad');
        if (!confirm('确认粉碎 ' + t + ' ？此操作不可恢复')) return;
        const out = document.getElementById('shredOut');
        out.textContent = '正在粉碎…';
        const r = await actTool('shred', { target: t });
        out.textContent = '完成，处理 ' + (r.files || 0) + ' 个文件';
        toast('粉碎完成', 'good');
      });
      el.querySelectorAll('[data-pw]').forEach((b) => b.onclick = async () => {
        const cmd = b.dataset.pw;
        const sec = Number((document.getElementById('f_seconds') || {}).value || 0);
        if (cmd === 'shutdown' || cmd === 'restart') {
          if (!confirm('确认在 ' + sec + ' 秒后' + (cmd === 'shutdown' ? '关机' : '重启') + ' ?')) return;
        }
        const r = await actTool('power', { cmd, seconds: sec });
        toast(r.ok ? '指令已执行' : '执行失败', r.ok ? 'good' : 'bad');
      });
      el.querySelectorAll('[data-rp]').forEach((b) => b.onclick = async () => {
        const desc = document.getElementById('f_desc').value;
        toast('正在创建还原点，请稍候…');
        const r = await actTool('restore', { cmd: 'create', desc });
        toast(r.ok ? '还原点已创建' : '创建失败：' + (r.out || '需要管理员权限'), r.ok ? 'good' : 'bad');
        refresh();
      });
      el.querySelectorAll('[data-hosts-save]').forEach((b) => b.onclick = async () => {
        const content = document.getElementById('f_content').value;
        const r = await actTool('hosts', { cmd: 'save', content });
        toast(r.ok ? '已保存并备份原文件' : '保存失败：' + (r.error || ''), r.ok ? 'good' : 'bad');
      });
      el.querySelectorAll('[data-fix]').forEach((b) => b.onclick = async () => {
        const r = await actTool('repair', { cmd: b.dataset.fix });
        if (!r.ok) return toast('启动失败（需要管理员权限）', 'bad');
        toast('已开始，日志会实时刷新');
        pollFix(r.id);
      });
    }

    let pollTimer = null;
    async function pollFix(id) {
      if (pollTimer) clearInterval(pollTimer);
      const tick = async () => {
        const r = await api('/api/tool/repair?id=' + id);
        const log = document.getElementById('fixLog');
        if (log) { log.textContent = r.log || '（等待输出）'; log.scrollTop = log.scrollHeight; }
        if (!r.running) { clearInterval(pollTimer); pollTimer = null; toast('任务已完成'); }
      };
      tick();
      pollTimer = setInterval(tick, 1500);
    }

    async function refresh() {
      try {
        const r = await runTool(meta.id, collect(meta));
        state.data = r.data;
        render((R[meta.id] || R.generic)(r.data, state.data));
      } catch (e) { render('<div class="empty">读取失败：' + esc(e.message) + '</div>'); }
    }
    R.generic = (d) => '<pre class="log">' + esc(JSON.stringify(d, null, 2)) + '</pre>';

    // 首次加载
    if (meta.fields && meta.fields.length) {
      render((meta.fields.length ? (meta.fields.map(fieldInput).join('') + '<div style="margin-top:12px"><button class="btn primary" id="toolRun">' + jjIcon('play') + '开始</button></div><div id="toolResult" style="margin-top:14px"></div>') : ''));
      const btn = document.getElementById('toolRun');
      const runOnce = async () => {
        const res = document.getElementById('toolResult');
        res.innerHTML = '<div class="dim" style="font-size:12px;padding:8px 0"><span class="skel" style="width:12px;height:12px;display:inline-block;border-radius:50%"></span> 正在处理…</div>';
        try {
          const r = await runTool(meta.id, collect(meta));
          state.data = r.data;
          res.innerHTML = (R[meta.id] || R.generic)(r.data, state.data);
          bindBody();
        } catch (e) { res.innerHTML = '<div class="empty">失败：' + esc(e.message) + '</div>'; }
      };
      btn.onclick = runOnce;
      const auto = ['bigfiles', 'dupfiles', 'emptyfolders', 'diskusage', 'envvars', 'hosts', 'restore', 'boottime'].includes(meta.id);
      if (meta.id === 'shred') {
        render(fieldInput(meta.fields[0]) + '<div style="margin-top:14px">' + R.shred({}, {}) + '</div>');
        bindBody();
      } else if (auto) runOnce();
    } else {
      try { await refresh(); } catch (e) { render('<div class="empty">读取失败：' + esc(e.message) + '</div>'); }
    }
  }

  window.openTool = openTool;
})();
