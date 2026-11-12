/* 净界 - 图标集 */
(function () {
  const P = {
    home: '<path d="M3 10.6 12 3l9 7.6V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z"/>',
    broom: '<path d="M15 3l6 6"/><path d="M13.2 4.8 8 10l6 6 5.2-5.2a2 2 0 0 0 0-2.8l-3.2-3.2a2 2 0 0 0-2.8 0z"/><path d="M8 10 3.5 14.5 9.5 20.5 14 16"/><path d="M4 16l2 2"/><path d="M2 21l1.5-5"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.8-.4L4 21l1.3-4.2A8.2 8.2 0 0 1 3.6 11.5a8.4 8.4 0 0 1 8.7-8.4 8.4 8.4 0 0 1 8.7 8.4z"/>',
    qq: '<path d="M12 3a4.6 4.6 0 0 1 4.6 4.6v1.6c1.4 1 2.2 2.7 2.2 4.7 0 .9-.6 1.6-1.4 1.6-.6 0-1.1-.3-1.4-.9l-.4-1.1c-.3 2.6-1.9 4.5-3.6 4.5s-3.3-1.9-3.6-4.5l-.4 1.1c-.3.6-.8.9-1.4.9-.8 0-1.4-.7-1.4-1.6 0-2 .8-3.7 2.2-4.7V7.6A4.6 4.6 0 0 1 12 3z"/><circle cx="10.3" cy="8.4" r=".8"/><circle cx="13.7" cy="8.4" r=".8"/>',
    tools: '<path d="M14.5 6.5a4 4 0 0 0 5 5L9.7 21.3a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17.6 3.4a4 4 0 0 1 3 3l-3.1 3.1"/><path d="M3 7h6M3 12h4M3 17h6"/>',
    shield: '<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    zap: '<path d="M13 3 4.5 14H10l-1 7 8.5-11H12z"/>',
    monitor: '<rect x="2.5" y="4" width="19" height="12.5" rx="2.5"/><path d="M8.5 21h7M12 16.5V21"/>',
    power: '<path d="M12 3v9"/><path d="M6.8 6.6a8 8 0 1 0 10.4 0"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.6 7.6l2 1.2M17.4 15.2l2 1.2M4.6 16.4l2-1.2M17.4 8.8l2-1.2"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h9"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.5 4.5"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 5.5A2 2 0 0 0 13.5 3.5h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2"/>',
    folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    pie: '<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M12 3a9 9 0 0 1 9 9h-9z"/>',
    activity: '<path d="M3 12h4l2.5-7 4.5 14 2.5-7h5"/>',
    wifi: '<path d="M4 9a12 12 0 0 1 16 0"/><path d="M7 12.5a8 8 0 0 1 10 0"/><path d="M10 16a4 4 0 0 1 4 0"/><circle cx="12" cy="19.5" r=".9"/>',
    trash: '<path d="M3.5 6.5h17M9 6.5V4h6v2.5M6 6.5l1 14h10l1-14"/><path d="M10 10.5v6M14 10.5v6"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.3l3.4 2"/>',
    code: '<path d="m8 8-4.5 4L8 16M16 8l4.5 4L16 16"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 8.5"/><path d="M3 4v4.5h4.5"/><path d="M12 8v4.4l3 1.8"/>',
    globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2"/><path d="M12 3.4a15 15 0 0 1 0 17.2 15 15 0 0 1 0-17.2z"/>',
    wrench: '<path d="M9.5 4a4.5 4.5 0 0 0 5.6 5.8L8.4 16.5a2.2 2.2 0 1 0 3.1 3.1l6.7-6.7A4.5 4.5 0 0 0 19.9 7l-3 3-2.4-2.4 3-3a4.5 4.5 0 0 0-5.9-.6z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    minus: '<path d="M5 12h14"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m4.5 12 4.8 4.8L19.5 6.5"/>',
    play: '<path d="M7.5 4.5 19 12 7.5 19.5z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.4 6.2"/><path d="M20 4.5V11h-6.4"/>',
    arrow: '<path d="M4.5 12h14m-5.5-5.5L19 12l-5.5 5.5"/>',
    disk: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 14h18"/><circle cx="7.5" cy="16.5" r="1"/>',
    cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.4 6.4l2.7 2.7M14.9 14.9l2.7 2.7M17.6 6.4l-2.7 2.7M9.1 14.9l-2.7 2.7"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.6-4.4 3.2 3 2.6-2.2 4.6 4"/>',
    file: '<path d="M6 3.5h7l5 5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M13 3.5v5h5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1 1-1.1 1.8v.3"/><path d="M12 17.2v.01"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.5M12 7.8v.4"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/>',
    moon: '<path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z"/>',
  };
  window.icon = function (name, extra) {
    const p = P[name] || P.sparkle;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' + (extra || '') + '>' + p + '</svg>';
  };
  window.ICON_NAMES = Object.keys(P);
})();
