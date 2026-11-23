/* Query Desk, AppADay 200. The shell: boot, the one open project, autosave, routing between the seven tabs,
 * the project bar, the open sheet, Settings, the first run screen and the tour. Every tab is a component in
 * QDeskTabs that builds itself inside its own root and talks to the shell only through ctx.
 * window.QDesk exposes the state for the end to end test. */
(function () {
  'use strict';
  var APP = '200';
  var ENGINE_DIR = '../appaday/vendor/sql.js-1.16.0/';
  var LS_LAST = 'querydesk-last', LS_WELCOMED = 'querydesk-welcomed', LS_TOUR = 'querydesk-tour';
  /* Reused on purpose: a setting chosen in a daily app carries into Query Desk. */
  var LS_SAMPLES = 'plainask-samples', LS_ORDER = 'csvintake-dateorder', LS_CHANGES_OK = 'querybench-changes-ok';
  var LS_LIMIT = 'resultcharts-limit', LS_HORIZ = 'resultcharts-horiz', LS_TABLE = 'resultcharts-table';
  var LS_DRAFT = 'querybench-draft:';
  var DOT = ' \u00b7 ';
  var ORDER = ['load', 'relate', 'ask', 'query', 'chart', 'report', 'learn'];
  var LABEL = { load: 'Load', relate: 'Relate', ask: 'Ask', query: 'Query', chart: 'Chart', report: 'Report', learn: 'Learn' };
  /* The change kinds each tab redraws for when it next opens. */
  var INTEREST = {
    load: ['schema'], relate: ['schema', 'keys', 'relations'], ask: ['schema', 'relations', 'queries'],
    query: ['schema', 'queries', 'history'], chart: ['schema', 'queries', 'charts'],
    report: ['schema', 'queries', 'charts', 'notebook', 'meta'], learn: []
  };
  var APP_NAMES = { '194': 'CSV Intake', '195': 'Query Bench', '196': 'Key Finder', '197': 'Plain Ask', '198': 'Result Charts', '199': 'Query Clinic', '200': 'Query Desk' };
  var LIMIT_STEPS = [5, 10, 20, 30, 50, 100, 200, 500];
  var TOUR = [
    { tab: 'load', text: 'Your tables, each column typed for you. Drop in your own CSV files any time.' },
    { tab: 'relate', text: 'Query Desk proposes how tables connect. Confirm the strong ones.' },
    { tab: 'ask', text: 'Ask a question in plain English. Your confirmed links help Claude join tables correctly.' },
    { tab: 'chart', text: 'Any result becomes a chart. Pin the ones you want to keep.' },
    { tab: 'report', text: 'Collect notes, results and charts, then export one file you can print to PDF.' }
  ];

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function show(el, on) { el.classList[on ? 'remove' : 'add']('hidden'); }
  function fmtTime(iso) {
    try { var d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return iso; }
  }
  var $ = function (id) { return document.getElementById(id); };
  function wide() { return window.matchMedia('(min-width: 720px)').matches; }

  var S = { p: null, auto: null, autoFor: null, unsub: null, tab: null, tabs: {}, stale: {}, changes: false, booted: false, tour: null, keysMounted: false };
  var SET = {
    limit: Math.max(1, Math.min(1000, parseInt(lsGet(LS_LIMIT, '50'), 10) || 50)),
    horiz: lsGet(LS_HORIZ, '1') !== '0',
    table: lsGet(LS_TABLE, '0') === '1'
  };

  /* =================================================================== toast */

  var toastTimer = null, toastAction = null;
  function toast(msg, action) {
    var t = $('toast'), b = $('toastAct');
    t.querySelector('.txt').textContent = msg;
    toastAction = action && typeof action.run === 'function' ? action : null;
    b.textContent = toastAction ? toastAction.label : '';
    show(b, !!toastAction);
    show(t, true);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { show(t, false); toastAction = null; }, toastAction ? (toastAction.ms || 5000) : 3200);
  }

  /* ================================================================ projects */

  function setSaveState(kind, text) {
    var el = $('saveState');
    el.className = 'save-state ' + kind;
    el.querySelector('.txt').textContent = text;
  }

  /** Autosave only once the project holds a table, so an empty new project never fills the open list. */
  function startAutosave(p) {
    if (!p || !p.userTables().length) return;
    if (S.auto && S.autoFor === p) return;
    if (S.auto) S.auto.stop();
    S.autoFor = p;
    S.auto = QD.autosave(p, {
      app: APP,
      onSave: function (ok, size) {
        if (S.p !== p) return;
        if (ok) { lsSet(LS_LAST, p.name); if (S.tab !== 'learn') setSaveState('saved', 'Saved ' + QD.formatBytes(size)); }
        else if (S.tab !== 'learn') setSaveState('off', 'Not saved on this device');
      }
    });
  }

  function uniqueName(base, taken) {
    var name = base, k = 2, low = taken.map(function (t) { return t.toLowerCase(); });
    while (low.indexOf(name.toLowerCase()) !== -1) { name = base + ' ' + k; k += 1; }
    return name;
  }
  function storedNames() { return QD.store.list().then(function (l) { return l.map(function (x) { return x.name; }); }); }

  function closeProject() {
    var done = Promise.resolve();
    if (S.auto) {
      var a = S.auto;
      done = (S.p && S.p.isDirty() && S.p.userTables().length ? a.flush() : Promise.resolve()).then(function () { a.stop(); });
      S.auto = null; S.autoFor = null;
    }
    return done.then(function () {
      if (S.unsub) { S.unsub(); S.unsub = null; }
      if (S.p) S.p.close();
      S.p = null;
    });
  }

  function markStale(kind) {
    ORDER.forEach(function (t) {
      if (t === S.tab || !S.tabs[t] || INTEREST[t].indexOf(kind) < 0) return;
      var list = S.stale[t] || (S.stale[t] = []);
      if (list.indexOf(kind) < 0) list.push(kind);
    });
  }

  function openProject(p, saved) {
    S.p = p;
    S.changes = false;
    renderChangesSwitch();
    S.unsub = p.onChange(function (kind) {
      if (S.p !== p) return;
      markStale(kind);
      if (kind === 'schema') { startAutosave(p); renderBar(); }
      if (kind !== 'history' && S.autoFor === p && S.tab !== 'learn') setSaveState('dirty', 'Saving');
    });
    startAutosave(p);
    if (saved) lsSet(LS_LAST, p.name);
    if (S.tab !== 'learn') {
      if (saved) setSaveState('saved', 'Saved');
      else setSaveState('', p.userTables().length ? 'Not saved yet' : 'Saves when it holds a table');
    }
    S.stale = {};
    ORDER.forEach(function (t) { var i = S.tabs[t]; if (i && i.projectChanged) { try { i.projectChanged(p); } catch (e) { report(e); } } });
    renderBar();
    return p;
  }

  function newProject(base) {
    return closeProject().then(storedNames).then(function (names) {
      return openProject(QD.create(uniqueName(base || 'Untitled project', names)), false);
    });
  }

  function openStored(name) {
    if (name === QDClinic.PROJECT_NAME) { goTo('learn'); return Promise.resolve(null); }
    if (S.p && S.p.name === name) return Promise.resolve(S.p);
    return QD.store.load(name).then(function (rec) {
      if (!rec) { toast('That project could not be found.'); return null; }
      return closeProject().then(function () {
        var p = openProject(QD.open(rec.bytes, rec.name), true);
        toast('Opened ' + rec.name + (rec.app && rec.app !== APP && APP_NAMES[rec.app] ? ', last saved by ' + APP_NAMES[rec.app] : ''));
        if (S.tab === 'learn') goTo('load');
        return p;
      });
    }).catch(function (e) { toast(e.message); return null; });
  }

  function sizeLine(bytes, name) {
    var phone = QD.isPhone(), lim = phone ? QD.LIMITS.phone : QD.LIMITS.desktop;
    return name + ' is ' + QD.formatBytes(bytes) + '. The limit on ' + (phone ? 'this phone' : 'a computer') + ' is ' + QD.formatBytes(lim.max) + ', so it was not opened.';
  }

  function openDbFile(file) {
    var lvl = QD.sizeVerdict(file.size);
    if (lvl === 'refuse') { toast(sizeLine(file.size, file.name)); return Promise.resolve(null); }
    return QD.readFile(file, false).then(function (bytes) {
      if (lvl === 'warn') toast(file.name + ' is large. The tab may slow down.');
      return closeProject().then(storedNames).then(function (names) {
        var p = QD.open(bytes, uniqueName(file.name.replace(/\.(sqlite3?|db)$/i, '') || 'Opened file', names));
        p.setMeta('project_name', p.name);
        openProject(p, false);
        if (S.auto) S.auto.flush();
        toast('Opened ' + file.name);
        if (S.tab === 'learn') goTo('load');
        return p;
      });
    }).catch(function (e) { toast('Could not open ' + file.name + '. ' + e.message); return null; });
  }

  function renameProject(raw) {
    var p = S.p, wanted = String(raw || '').trim() || 'Untitled project';
    if (!p || wanted === p.name) { renderBar(); return; }
    if (wanted === QDClinic.PROJECT_NAME) { toast('That name belongs to the Learn course. Pick another.'); renderBar(); return; }
    var old = p.name;
    storedNames().then(function (names) {
      var hadOld = names.indexOf(old) !== -1;
      var name = uniqueName(wanted, names.filter(function (n) { return n !== old; }));
      p.rename(name);
      lsSet(LS_DRAFT + name, lsGet(LS_DRAFT + old, ''));
      lsSet(LS_DRAFT + old, '');
      renderBar();
      if (!S.auto) return;
      return S.auto.flush().then(function (ok) { if (ok && hadOld) return QD.store.remove(old); });
    });
  }

  function loadSample() {
    return closeProject().then(storedNames).then(function (names) {
      var p = QD.create(uniqueName('Prairie Ridge sample', names));
      QDClinic.seed(p, { declareKeys: false });
      openProject(p, false);
      if (S.auto) S.auto.flush();
      lsSet(LS_WELCOMED, '1');
      goTo('load');
      toast('Sample college loaded: ten tables, no keys declared');
      if (lsGet(LS_TOUR, '') !== 'done') setTimeout(function () { startTour(0); }, 350);
      return p;
    }).catch(function (e) { toast('The sample data did not load. ' + e.message); return null; });
  }

  function download() {
    var p = S.p;
    if (!p || S.tab === 'learn') return;
    var bytes = p.export(APP);
    QD.download(bytes, QD.fileName(p), 'application/vnd.sqlite3');
    if (S.auto) S.auto.flush();
    toast('Downloaded ' + QD.fileName(p) + ' (' + QD.formatBytes(bytes.length) + ')');
  }

  /* ===================================================================== bar */

  function renderBar() {
    var name = $('projName'), learn = S.tab === 'learn';
    if (learn) {
      name.value = 'Course progress saves on its own';
      name.disabled = true;
      $('btnDownload').disabled = true;
      $('saveState').classList.add('hidden');
      return;
    }
    $('saveState').classList.remove('hidden');
    name.disabled = !S.p;
    if (document.activeElement !== name) name.value = S.p ? S.p.name : '';
    $('btnDownload').disabled = !(S.p && S.p.userTables().length);
    if (!S.p) setSaveState('', 'No project open');
  }

  /* ================================================================== routing */

  function report(e) { if (window.console && console.error) console.error(e); }

  function mountTab(t) {
    if (S.tabs[t]) return S.tabs[t];
    var def = window.QDeskTabs[t], root = document.querySelector('.tab-root[data-tab="' + t + '"]');
    S.tabs[t] = def.mount(root, ctx) || {};
    return S.tabs[t];
  }

  function rootOf(t) { return document.querySelector('.tab-root[data-tab="' + t + '"]'); }

  function hashTab() {
    var h = String(location.hash || '').replace(/^#/, '');
    return ORDER.indexOf(h) >= 0 ? h : null;
  }

  function goTo(t, payload, opts) {
    opts = opts || {};
    if (ORDER.indexOf(t) < 0) t = 'load';
    if (!S.booted) return;
    var prev = S.tab;
    if (prev && prev !== t) {
      var old = S.tabs[prev];
      if (old && old.deactivate) { try { old.deactivate(); } catch (e) { report(e); } }
      show(rootOf(prev), false);
    }
    var inst = mountTab(t);
    S.tab = t;
    show(rootOf(t), true);
    Array.prototype.forEach.call($('tabbar').querySelectorAll('button'), function (b) {
      var on = b.getAttribute('data-go') === t;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (S.stale[t] && S.stale[t].length) {
      var kinds = S.stale[t]; S.stale[t] = [];
      if (inst.stale) { try { inst.stale(kinds); } catch (e) { report(e); } }
    }
    if (inst.activate) { try { inst.activate(payload || null); } catch (e) { report(e); toast(e.message); } }
    renderBar();
    if (prev === 'learn' && t !== 'learn' && S.p) setSaveState(S.p.isDirty() ? 'dirty' : 'saved', S.p.isDirty() ? 'Saving' : 'Saved');
    if (!opts.noHash && location.hash !== '#' + t) {
      try { history[opts.replace ? 'replaceState' : 'pushState'](null, '', '#' + t); } catch (e) { location.hash = t; }
    }
    if (S.tour !== null) positionTour();
  }

  /* =================================================================== sheets */

  var SHEETS = ['openScrim', 'setScrim', 'chgScrim'];
  function openSheet(id) {
    if (id === 'openScrim') renderProjectLists();
    show($(id), true);
    var b = $(id).querySelector('[data-close]'); if (b) b.focus({ preventScroll: true });
  }
  function closeSheet(id) { show($(id), false); }

  function renderProjectLists() {
    return QD.store.list().then(function (list) {
      var cur = S.p ? S.p.name : null;
      function meta(x) {
        return esc(QD.formatBytes(x.size)) + DOT + esc(fmtTime(x.savedAt)) + (x.app ? DOT + 'Saved by ' + esc(APP_NAMES[x.app] || 'app ' + x.app) : '') + (x.name === cur ? DOT + 'open now' : '');
      }
      function openItem(x) {
        var learn = x.name === QDClinic.PROJECT_NAME;
        return '<div class="pitem' + (x.name === cur ? ' current' : '') + '"><button class="open" type="button" data-open="' + esc(x.name) + '"><b>' + esc(x.name) +
          (learn ? '<span class="badge">Learn</span>' : '') + '</b><span>' + meta(x) + '</span></button></div>';
      }
      function setItem(x) {
        return '<div class="pitem' + (x.name === cur ? ' current' : '') + '"><button class="open" type="button" data-open="' + esc(x.name) + '"><b>' + esc(x.name) + '</b><span>' + meta(x) + '</span></button>' +
          '<button class="btn small danger" type="button" data-del="' + esc(x.name) + '">Delete</button></div>';
      }
      var empty = '<p class="muted">Nothing saved yet. Projects save themselves as soon as they hold a table.</p>';
      $('openList').innerHTML = list.length ? list.map(openItem).join('') : empty;
      $('setList').innerHTML = list.length ? list.map(setItem).join('') : empty;
    });
  }

  function seg(id, attr, value) {
    Array.prototype.forEach.call($(id).querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value)); });
  }

  function renderSettings() {
    seg('segSamples', 'data-samples', lsGet(LS_SAMPLES, '3') === '0' ? '0' : '3');
    seg('segOrder', 'data-order', lsGet(LS_ORDER, 'mdy') === 'dmy' ? 'dmy' : 'mdy');
    renderChangesSwitch();
    $('setLim').textContent = String(SET.limit);
    $('swHoriz').setAttribute('aria-checked', String(SET.horiz));
    $('swTable').setAttribute('aria-checked', String(SET.table));
    var phone = QD.isPhone(), L = QD.LIMITS;
    $('limitsTable').innerHTML = '<tr><th>Device</th><th>Warn above</th><th>Refuse above</th></tr>' +
      '<tr class="' + (phone ? 'here' : '') + '"><td>Phone' + (phone ? ' (this one)' : '') + '</td><td>' + QD.formatBytes(L.phone.warn) + '</td><td>' + QD.formatBytes(L.phone.max) + '</td></tr>' +
      '<tr class="' + (phone ? '' : 'here') + '"><td>Computer' + (phone ? '' : ' (this one)') + '</td><td>' + QD.formatBytes(L.desktop.warn) + '</td><td>' + QD.formatBytes(L.desktop.max) + '</td></tr>';
    if (!S.keysMounted) {
      var m = $('keyMount');
      if (window.AppKeys && typeof window.AppKeys.mountSettings === 'function') {
        try { window.AppKeys.mountSettings(m); S.keysMounted = true; } catch (e) { m.innerHTML = '<p class="muted">The key manager could not open here.</p>'; }
      } else m.innerHTML = '<p class="muted">The key ring has not loaded yet. Check the connection, then open Settings again.</p>';
    }
    return renderProjectLists();
  }

  var SECTION = { keys: 'setKeys', ask: 'setAsk', load: 'setLoad', changes: 'setChanges', charts: 'setCharts', tour: 'setHelp', storage: 'setStorage' };
  function openSettings(section) {
    renderSettings();
    show($('setScrim'), true);
    var el = section && SECTION[section] ? $(SECTION[section]) : null;
    if (el) { el.scrollIntoView({ block: 'start' }); var f = el.querySelector('button, input'); if (f) f.focus({ preventScroll: true }); }
    else { var b = $('setScrim').querySelector('[data-close]'); if (b) b.focus({ preventScroll: true }); }
  }

  function renderChangesSwitch() { $('swChanges').setAttribute('aria-checked', String(S.changes)); }
  function notify(tab, kind) { var i = S.tabs[tab]; if (i && i.stale) { try { i.stale([kind]); } catch (e) { report(e); } } }

  function setChanges(on) {
    if (on && lsGet(LS_CHANGES_OK, '') !== '1') { openSheet('chgScrim'); return; }
    S.changes = !!on;
    renderChangesSwitch();
    notify('query', 'changes');
    toast(on ? 'Changes allowed in Query for this project' : 'Query is read only again');
  }

  function stepLimit(cur, dir) {
    var i, n = LIMIT_STEPS.length;
    if (dir > 0) { for (i = 0; i < n; i += 1) if (LIMIT_STEPS[i] > cur) return LIMIT_STEPS[i]; return LIMIT_STEPS[n - 1]; }
    for (i = n - 1; i >= 0; i -= 1) if (LIMIT_STEPS[i] < cur) return LIMIT_STEPS[i];
    return LIMIT_STEPS[0];
  }

  /* ================================================================ first run */

  function showFirst(on) { show($('first'), on); if (on) { var b = $('fSample'); if (b) b.focus({ preventScroll: true }); } }
  function welcomed() { lsSet(LS_WELCOMED, '1'); showFirst(false); }

  /* ===================================================================== tour */

  function startTour(i) {
    S.tour = Math.max(0, Math.min(TOUR.length - 1, i || 0));
    lsSet(LS_TOUR, String(S.tour));
    show($('tourScrim'), true); show($('tourCard'), true);
    $('tabbar').classList.add('touring');
    goTo(TOUR[S.tour].tab);
    renderTour();
  }
  function renderTour() {
    if (S.tour === null) return;
    var st = TOUR[S.tour];
    $('tourStep').textContent = 'Step ' + (S.tour + 1) + ' of ' + TOUR.length + DOT + LABEL[st.tab];
    $('tourText').textContent = st.text;
    $('tourBack').disabled = S.tour === 0;
    $('tourNext').textContent = S.tour === TOUR.length - 1 ? 'Done' : 'Next';
    Array.prototype.forEach.call($('tabbar').querySelectorAll('button'), function (b) { b.classList[b.getAttribute('data-go') === st.tab ? 'add' : 'remove']('lit'); });
    positionTour();
  }
  function positionTour() {
    if (S.tour === null) return;
    var card = $('tourCard'), b = $('tabbar').querySelector('[data-go="' + TOUR[S.tour].tab + '"]');
    if (!b) return;
    var r = b.getBoundingClientRect();
    if (wide()) { card.style.top = Math.round(r.bottom + 10) + 'px'; card.style.bottom = 'auto'; }
    else { card.style.bottom = Math.round(window.innerHeight - r.top + 10) + 'px'; card.style.top = 'auto'; }
  }
  function tourStep(dir) {
    if (S.tour === null) return;
    var n = S.tour + dir;
    if (n >= TOUR.length) { endTour(true); return; }
    S.tour = Math.max(0, n);
    lsSet(LS_TOUR, String(S.tour));
    goTo(TOUR[S.tour].tab);
    renderTour();
  }
  function endTour(done) {
    S.tour = null;
    if (done !== false) lsSet(LS_TOUR, 'done');
    show($('tourScrim'), false); show($('tourCard'), false);
    $('tabbar').classList.remove('touring');
    Array.prototype.forEach.call($('tabbar').querySelectorAll('button.lit'), function (b) { b.classList.remove('lit'); });
  }
  function tourEvent(name) {
    if (S.tour === 1 && name === 'confirmStrong') tourStep(1);
  }

  /* ======================================================================= ctx */

  var ctx = {
    project: function () { return S.p; },
    goTo: function (t, payload) { goTo(t, payload); },
    toast: toast,
    openSettings: openSettings,
    requireProject: function () {
      if (S.p) return Promise.resolve(S.p);
      openSheet('openScrim');
      return Promise.resolve(null);
    },
    loadSample: loadSample,
    newProject: newProject,
    openProjects: function () { openSheet('openScrim'); },
    openDbFile: openDbFile,
    charts: null,
    report: {
      add: function (block) {
        var p = S.p;
        if (!p) return null;
        try {
          var id = p.addBlock(block);
          toast('Added to the report', { label: 'Open report', run: function () { goTo('report'); } });
          return id;
        } catch (e) { toast(e.message); return null; }
      }
    },
    wide: wide,
    changes: function () { return S.changes; },
    setChanges: setChanges,
    chartSettings: SET,
    dateOrder: function () { return lsGet(LS_ORDER, 'mdy') === 'dmy' ? 'dmy' : 'mdy'; },
    saveNow: function () { return S.auto ? S.auto.flush() : Promise.resolve(false); },
    tourEvent: tourEvent,
    uniqueName: function (base) { return storedNames().then(function (n) { return uniqueName(base, n); }); }
  };

  /* ==================================================================== events */

  function buildTabbar() {
    var bar = $('tabbar');
    bar.innerHTML = ORDER.map(function (t) {
      var def = window.QDeskTabs[t];
      return '<button type="button" role="tab" data-go="' + t + '" aria-selected="false" aria-controls="">' + (def ? def.icon : '') + '<span>' + LABEL[t] + '</span></button>';
    }).join('');
  }

  function measure() {
    var tb = $('tabbar'), stage = $('stage');
    document.documentElement.style.setProperty('--tabbar-h', wide() ? '0px' : tb.offsetHeight + 'px');
    document.documentElement.style.setProperty('--stage-h', stage.clientHeight + 'px');
    if (S.tour !== null) positionTour();
  }

  function wire() {
    $('tabbar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (!b) return;
      goTo(b.getAttribute('data-go'));
      if (S.tour !== null) renderTour();
    });
    $('tabbar').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = ORDER.indexOf(S.tab), n = ORDER[(i + (e.key === 'ArrowRight' ? 1 : ORDER.length - 1)) % ORDER.length];
      goTo(n); var b = $('tabbar').querySelector('[data-go="' + n + '"]'); if (b) b.focus();
    });
    window.addEventListener('popstate', function () { goTo(hashTab() || 'load', null, { noHash: true }); });
    $('btnOpen').addEventListener('click', function () { openSheet('openScrim'); });
    $('btnGear').addEventListener('click', function () { openSettings(); });
    $('btnDownload').addEventListener('click', download);
    $('projName').addEventListener('change', function (e) { if (S.tab !== 'learn') renameProject(e.target.value); });
    $('projName').addEventListener('keydown', function (e) { if (e.key === 'Enter') e.target.blur(); });
    $('btnNew').addEventListener('click', function () { closeSheet('openScrim'); newProject().then(function () { goTo('load'); }); });
    $('btnOpenFile').addEventListener('click', function () { $('fileDb').click(); });
    $('btnSampleOpen').addEventListener('click', function () { closeSheet('openScrim'); loadSample(); });
    $('fileDb').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) { closeSheet('openScrim'); openDbFile(f); } });
    $('fileCsvShell').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
      goTo('load');
      if (files.length && S.tabs.load && S.tabs.load.addFiles) S.tabs.load.addFiles(files);
    });
    $('btnChangesOk').addEventListener('click', function () { lsSet(LS_CHANGES_OK, '1'); closeSheet('chgScrim'); setChanges(true); });
    $('swChanges').addEventListener('click', function () { setChanges(!S.changes); });
    $('swHoriz').addEventListener('click', function () { SET.horiz = !SET.horiz; lsSet(LS_HORIZ, SET.horiz ? '1' : '0'); renderSettings(); notify('chart', 'settings'); });
    $('swTable').addEventListener('click', function () { SET.table = !SET.table; lsSet(LS_TABLE, SET.table ? '1' : '0'); renderSettings(); notify('chart', 'settings'); });
    $('setLimDown').addEventListener('click', function () { SET.limit = stepLimit(SET.limit, -1); lsSet(LS_LIMIT, String(SET.limit)); renderSettings(); });
    $('setLimUp').addEventListener('click', function () { SET.limit = stepLimit(SET.limit, 1); lsSet(LS_LIMIT, String(SET.limit)); renderSettings(); });
    $('btnReplayTour').addEventListener('click', function () { closeSheet('setScrim'); startTour(0); });
    $('toastAct').addEventListener('click', function () {
      var a = toastAction; toastAction = null; show($('toast'), false);
      if (a) a.run();
    });

    $('fSample').addEventListener('click', function () { welcomed(); loadSample(); });
    $('fCsv').addEventListener('click', function () { welcomed(); $('fileCsvShell').click(); });
    $('fOpen').addEventListener('click', function () { welcomed(); openSheet('openScrim'); });
    $('fTour').addEventListener('click', function () { welcomed(); startTour(0); });
    $('tourNext').addEventListener('click', function () { tourStep(1); });
    $('tourBack').addEventListener('click', function () { tourStep(-1); });
    $('tourSkip').addEventListener('click', function () { endTour(true); });

    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) { if (e.target.classList && e.target.classList.contains('scrim') && SHEETS.indexOf(e.target.id) >= 0) closeSheet(e.target.id); return; }
      var a;
      if ((a = b.getAttribute('data-close')) && SHEETS.indexOf(a) >= 0) closeSheet(a);
      else if ((a = b.getAttribute('data-samples')) && b.closest('#segSamples')) {
        lsSet(LS_SAMPLES, a);
        if (window.PlainAsk && typeof window.PlainAsk.setSampleRows === 'function') window.PlainAsk.setSampleRows(a);
        renderSettings();
      }
      else if ((a = b.getAttribute('data-order')) && b.closest('#segOrder')) { lsSet(LS_ORDER, a); renderSettings(); }
      else if ((a = b.getAttribute('data-open')) && b.closest('#openList, #setList')) {
        closeSheet('openScrim'); closeSheet('setScrim');
        openStored(a);
      }
      else if ((a = b.getAttribute('data-del')) && b.closest('#setList')) {
        if (b.getAttribute('data-armed') !== '1') { b.setAttribute('data-armed', '1'); b.textContent = 'Tap again'; return; }
        var isCur = S.p && S.p.name === a;
        var gone = isCur ? (function () { var x = S.auto; S.auto = null; S.autoFor = null; if (x) x.stop(); return Promise.resolve(); })() : Promise.resolve();
        gone.then(function () { return QD.store.remove(a); }).then(function () {
          if (isCur) {
            lsSet(LS_LAST, '');
            if (S.unsub) { S.unsub(); S.unsub = null; }
            S.p.close(); S.p = null;
            ORDER.forEach(function (t) { var i = S.tabs[t]; if (i && i.projectChanged) { try { i.projectChanged(null); } catch (err) { report(err); } } });
            renderBar();
          }
        }).then(renderProjectLists).then(function () { toast('Deleted ' + a); });
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var openOne = SHEETS.filter(function (id) { return !$(id).classList.contains('hidden'); });
      if (openOne.length) { openOne.forEach(closeSheet); return; }
      if (S.tour !== null) endTour(false);
    });
    window.addEventListener('resize', measure);
    window.addEventListener('pagehide', function () { if (S.auto && S.p && S.p.isDirty()) S.auto.flush(); });
  }

  /* ====================================================================== boot */

  function fatal(title, text) {
    ORDER.forEach(function (t) { show(rootOf(t), false); });
    var f = $('fatal'); f.innerHTML = '<h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>'; show(f, true);
    setSaveState('off', 'Not running');
  }

  function boot() {
    buildTabbar();
    wire();
    measure();
    var missing = ['QD', 'QDKeys', 'QDClinic', 'QDAsk', 'QDCharts', 'PlainAsk', 'QueryClinic'].filter(function (g) { return typeof window[g] === 'undefined'; });
    if (missing.length) { fatal('Something is missing', 'The shared Query Desk code did not load. Reload the page.'); return; }
    if (typeof window.initSqlJs !== 'function') { fatal('The database engine did not load', 'Check the connection and reload. The engine is a one time download of about 700 KB.'); return; }
    ctx.charts = window.QDeskTabs.chart.renderer;
    setSaveState('', 'Loading engine');
    QD.boot(null, { locateFile: function (f) { return ENGINE_DIR + f; } }).then(function () {
      S.booted = true;
      mountTab('load');
      var start = hashTab() || 'load', last = lsGet(LS_LAST, '');
      return (last && last !== QDClinic.PROJECT_NAME ? QD.store.load(last) : Promise.resolve(null)).then(function (rec) {
        var opened = false;
        if (rec) { try { openProject(QD.open(rec.bytes, rec.name), true); opened = true; } catch (e) { opened = false; } }
        goTo(start, null, { replace: true });
        if (!opened) {
          renderBar();
          if (start === 'learn') return;
          if (lsGet(LS_WELCOMED, '') !== '1') showFirst(true);
          else openSheet('openScrim');
        }
        measure();
      });
    }).catch(function (e) { fatal('The database engine did not start', (e && e.message) || 'Reload the page to try again.'); });
  }

  window.QDesk = {
    state: S, ctx: ctx, goTo: goTo, openStored: openStored, loadSample: loadSample, startTour: startTour, endTour: endTour,
    settings: SET, version: APP
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
