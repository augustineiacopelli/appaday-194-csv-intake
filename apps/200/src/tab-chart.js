/* Chart tab, from Result Charts (AppADay 198): a saved or typed query becomes the chart its shape suggests,
 * with overrides, a board of pinned charts that reruns on open, and PNG export. The drawing code is factored
 * into one renderer, QDeskTabs.chart.renderer, which the shell passes to every tab as ctx.charts. It takes
 * a theme: dark for the app and light for the printed report. */
(function () {
  'use strict';
  var DOT = ' \u00b7 ';
  var LIMIT_STEPS = [5, 10, 20, 30, 50, 100, 200, 500];
  var LABEL_MAX = 14;
  /* The dataviz categorical order, as in 198. It holds 3:1 or better against both the dark and the white surface. */
  var PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
  var FONT = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var THEMES = {
    dark: { surface: '#171e1b', ink: '#e8eeeb', ink2: '#9fb0a8', grid: 'rgba(232, 238, 235, 0.09)', line: '#2e3a35', tip: '#26312c' },
    light: { surface: '#ffffff', ink: '#1d1d1f', ink2: '#555555', grid: '#e3e3e3', line: '#cfcfcf', tip: '#ffffff' }
  };
  var SAMPLES = [
    { key: 'tile', kind: 'tile', type: 'tile', label: 'Count of students', sql: 'SELECT count(*) AS students FROM students' },
    { key: 'bar', kind: 'bar', type: 'bar', label: 'Students per campus',
      sql: 'SELECT c.name AS campus, count(*) AS students\nFROM students s\nJOIN campuses c ON c.campus_id = s.home_campus_id\nGROUP BY c.name' },
    { key: 'pie', kind: 'pie', type: 'pie', label: 'Work orders by status',
      sql: "SELECT CASE WHEN closed_on IS NULL THEN 'Open' ELSE 'Closed' END AS status, count(*) AS work_orders\nFROM work_orders\nGROUP BY 1" },
    { key: 'line', kind: 'line', type: 'line', label: 'Enrollments by term',
      sql: 'SELECT t.start_date AS term_start, count(*) AS enrollments\nFROM enrollments e\nJOIN sections s ON s.section_id = e.section_id\nJOIN terms t ON t.term_id = s.term_id\nGROUP BY t.term_id' },
    { key: 'scatter', kind: 'scatter', type: 'scatter', label: 'Instructor salary and sections',
      sql: 'SELECT i.salary,\n  (SELECT count(*) FROM sections s WHERE s.instructor_id = i.instructor_id) AS sections_taught\nFROM instructors i' },
    { key: 'pivot', kind: 'grouped', type: 'bar', label: 'Finished grades by department',
      sql: "SELECT d.name AS department, coalesce(e.grade, 'W') AS grade, count(*) AS enrollments\nFROM enrollments e\nJOIN sections s ON s.section_id = e.section_id\nJOIN courses c ON c.course_id = s.course_id\nJOIN departments d ON d.dept_id = c.dept_id\nWHERE e.status IN ('Completed', 'Withdrawn')\nGROUP BY d.name, coalesce(e.grade, 'W')" }
  ];
  var X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function show(el, on) { el.classList[on ? 'remove' : 'add']('hidden'); }
  function plural(n, one, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fmtNum(v) {
    if (v === null || v === undefined) return 'none';
    if (typeof v !== 'number') return String(v);
    return v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 });
  }
  function trunc(s) { s = String(s); return s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1) + '...' : s; }
  function slug(s) { return String(s || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chart'; }
  function narrow() { return window.matchMedia('(max-width: 560px)').matches; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  /* ================================================================ the renderer */

  function bgPlugin(color) {
    return {
      id: 'qdBackground',
      beforeDraw: function (chart) {
        var c = chart.ctx;
        c.save(); c.globalCompositeOperation = 'destination-over';
        c.fillStyle = color; c.fillRect(0, 0, chart.canvas.width, chart.canvas.height);
        c.restore();
      }
    };
  }

  function horizontalFor(spec, d, settings) {
    if (spec.type !== 'bar' || !(settings && settings.horiz) || !narrow()) return false;
    return d.labels.length > 6 || d.labels.some(function (l) { return String(l).length > LABEL_MAX; });
  }

  function ariaLabel(spec) {
    return (spec.title || 'Chart') + ', ' + spec.type + ' chart of ' + spec.y.join(', ') + (spec.x ? ' by ' + spec.x : '');
  }

  function config(spec, d, horiz, th, still) {
    var multi = d.datasets.length > 1, type = spec.type;
    var datasets = d.datasets.map(function (ds, i) {
      var col = PALETTE[i % PALETTE.length], o = { label: ds.label, data: ds.data };
      if (type === 'bar') {
        o.backgroundColor = col; o.borderRadius = 4; o.borderSkipped = 'start'; o.maxBarThickness = 44;
        if (spec.stacked) { o.borderColor = th.surface; o.borderWidth = { top: 2, right: 0, bottom: 0, left: 0 }; if (horiz) o.borderWidth = { top: 0, right: 2, bottom: 0, left: 0 }; }
      } else if (type === 'line') {
        o.borderColor = col; o.backgroundColor = col; o.borderWidth = 2; o.tension = 0; o.spanGaps = true;
        o.pointRadius = d.labels.length > 30 ? 0 : 3; o.pointHoverRadius = 5; o.pointBorderColor = th.surface; o.pointBorderWidth = 1;
        if (spec.stacked) { o.fill = i === 0 ? 'origin' : '-1'; o.backgroundColor = col + '55'; }
      } else if (type === 'scatter') {
        o.backgroundColor = col; o.pointRadius = 4; o.pointHoverRadius = 6; o.pointBorderColor = th.surface; o.pointBorderWidth = 1.5;
      } else if (type === 'pie') {
        o.backgroundColor = d.labels.map(function (l, j) { return PALETTE[j % PALETTE.length]; });
        o.borderColor = th.surface; o.borderWidth = 2;
      }
      return o;
    });
    var font = { family: FONT, size: 12 };
    var catTicks = { color: th.ink2, font: font, autoSkip: d.labels.length > 12, maxRotation: horiz ? 0 : 50, callback: function (v) { return trunc(this.getLabelForValue(v)); } };
    var numTicks = { color: th.ink2, font: font, callback: function (v) { return fmtNum(v); } };
    var scales = {};
    if (type === 'bar' || type === 'line') {
      var cat = { type: 'category', ticks: catTicks, grid: { display: false }, border: { color: th.line }, stacked: !!spec.stacked };
      var val = { type: 'linear', beginAtZero: type === 'bar', ticks: numTicks, grid: { color: th.grid }, border: { color: th.line }, stacked: !!spec.stacked };
      if (horiz) { scales.y = cat; scales.x = val; } else { scales.x = cat; scales.y = val; }
    } else if (type === 'scatter') {
      scales.x = { type: 'linear', ticks: numTicks, grid: { color: th.grid }, border: { color: th.line }, title: { display: true, text: spec.x, color: th.ink2, font: font } };
      scales.y = { type: 'linear', ticks: numTicks, grid: { color: th.grid }, border: { color: th.line }, title: { display: true, text: spec.y[0], color: th.ink2, font: font } };
    }
    return {
      type: type,
      data: { labels: type === 'scatter' ? undefined : d.labels, datasets: datasets },
      plugins: [bgPlugin(th.surface)],
      options: {
        responsive: !still, maintainAspectRatio: false, animation: still ? false : { duration: 250 },
        devicePixelRatio: still ? still.scale : undefined,
        color: th.ink2, font: font,
        indexAxis: horiz ? 'y' : 'x',
        interaction: type === 'scatter' || type === 'pie' ? { mode: 'nearest', intersect: true } : { mode: 'index', intersect: false },
        layout: { padding: { top: 6, right: 8, bottom: 2, left: 2 } },
        scales: scales,
        plugins: {
          legend: { display: multi || type === 'pie', position: 'bottom', labels: { color: th.ink, boxWidth: 12, boxHeight: 12, font: font } },
          tooltip: {
            enabled: !still, backgroundColor: th.tip, titleColor: th.ink, bodyColor: th.ink, borderColor: th.line, borderWidth: 1, padding: 10, cornerRadius: 8,
            callbacks: {
              label: function (c) {
                if (type === 'scatter') return spec.x + ' ' + fmtNum(c.parsed.x) + ', ' + spec.y[0] + ' ' + fmtNum(c.parsed.y);
                var v = type === 'pie' ? c.parsed : (horiz ? c.parsed.x : c.parsed.y);
                return (c.dataset.label ? c.dataset.label + ': ' : '') + fmtNum(v);
              }
            }
          }
        }
      }
    };
  }

  function destroy(holder) {
    if (holder && holder._chart) { try { holder._chart.destroy(); } catch (e) { /* already gone */ } holder._chart = null; }
  }

  /** Draw spec and data into holder. Tiles are HTML. opts: { height, theme, settings }. Returns the Chart.js instance or null. */
  function draw(holder, spec, d, opts) {
    opts = opts || {};
    var th = THEMES[opts.theme] || THEMES.dark;
    destroy(holder);
    clear(holder);
    if (spec.type === 'tile') {
      holder.innerHTML = '<div class="tile"><div class="v">' + esc(fmtNum(d.datasets[0].data[0])) + '</div><div class="l">' + esc(spec.y[0]) + '</div></div>';
      return null;
    }
    if (!window.Chart) {
      holder.innerHTML = '<div class="nochart">The chart library did not load. Check the connection and reload. Number tiles still work.</div>';
      return null;
    }
    var horiz = horizontalFor(spec, d, opts.settings);
    var box = document.createElement('div'); box.className = 'chart-box';
    if (horiz) box.style.height = Math.max(opts.height || 300, d.labels.length * Math.max(24, d.datasets.length * 9 + 12) + 70) + 'px';
    var cv = document.createElement('canvas');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', ariaLabel(spec));
    box.appendChild(cv); holder.appendChild(box);
    holder._chart = new window.Chart(cv.getContext('2d'), config(spec, d, horiz, th, null));
    return holder._chart;
  }

  /**
   * Render a chart off screen and return a PNG data URL, for the report. opts: { width, height, scale, theme }.
   * A tile, or a page without Chart.js, returns null and the caller shows the number or a table instead.
   */
  function image(spec, d, opts) {
    opts = opts || {};
    if (spec.type === 'tile' || !window.Chart) return null;
    var w = opts.width || 960, h = opts.height || 540, scale = opts.scale || 2, th = THEMES[opts.theme] || THEMES.light;
    var holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:fixed;left:-20000px;top:0;width:' + w + 'px;height:' + h + 'px;pointer-events:none;';
    var cv = document.createElement('canvas');
    cv.width = w * scale; cv.height = h * scale;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    holder.appendChild(cv);
    document.body.appendChild(holder);
    var chart = null, url = null;
    try {
      chart = new window.Chart(cv.getContext('2d'), config(spec, d, false, th, { scale: scale }));
      url = chart.toBase64Image('image/png');
    } finally {
      if (chart) { try { chart.destroy(); } catch (e) { /* gone */ } }
      document.body.removeChild(holder);
    }
    return url;
  }

  function toast(msg) { if (window.QDesk) window.QDesk.ctx.toast(msg); }

  function saveCanvas(canvas, title) {
    var name = 'query-desk-' + slug(title) + '.png';
    canvas.toBlob(function (blob) {
      if (!blob) { toast('The PNG could not be made in this browser.'); return; }
      QD.download(blob, name, 'image/png');
      toast('Saved ' + name);
    }, 'image/png');
  }

  /** The 198 PNG: the chart as drawn on screen with its title band, on the dark surface. */
  function exportPng(holder, spec, d) {
    var scale = 2, title = spec.title || 'Chart', th = THEMES.dark;
    var out = document.createElement('canvas'), c;
    if (spec.type === 'tile') {
      out.width = 800 * scale; out.height = 420 * scale; c = out.getContext('2d'); c.scale(scale, scale);
      c.fillStyle = th.surface; c.fillRect(0, 0, 800, 420);
      c.fillStyle = th.ink2; c.font = '600 22px ' + FONT; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(title, 32, 30);
      c.fillStyle = th.ink; c.font = '700 120px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(fmtNum(d.datasets[0].data[0]), 400, 215);
      c.fillStyle = th.ink2; c.font = '400 24px ' + FONT;
      c.fillText(spec.y[0], 400, 320);
      saveCanvas(out, title);
      return;
    }
    var ch = holder._chart;
    if (!ch) { toast('There is no chart to save yet.'); return; }
    var src = ch.canvas, band = Math.round(56 * (src.width / src.clientWidth || 1));
    out.width = src.width; out.height = src.height + band;
    c = out.getContext('2d');
    c.fillStyle = th.surface; c.fillRect(0, 0, out.width, out.height);
    var k = src.width / (src.clientWidth || src.width);
    c.fillStyle = th.ink; c.font = '600 ' + Math.round(17 * k) + 'px ' + FONT; c.textBaseline = 'middle';
    c.fillText(title, Math.round(12 * k), band / 2);
    c.drawImage(src, 0, band);
    saveCanvas(out, title);
  }

  var renderer = { draw: draw, image: image, destroy: destroy, ariaLabel: ariaLabel, fmtNum: fmtNum, PALETTE: PALETTE, THEMES: THEMES };

  /* ================================================================ the tab */

  var TEMPLATE =
    '<div class="tab-in">' +
    '<section data-t="empty" class="empty hidden">' +
      '<div class="empty-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg></div>' +
      '<h1>The right chart for any query result.</h1>' +
      '<p class="lede">Run a query and Chart reads the shape of the result to pick a bar, line, scatter or pie. Pin the ones you want and the board reruns them every time you come back.</p>' +
      '<div class="cta"><button class="btn primary" type="button" data-act="sample">Load sample data</button>' +
      '<button class="btn" type="button" data-act="load">Load CSV files</button>' +
      '<button class="btn" type="button" data-act="open">Open a saved project</button></div>' +
    '</section>' +
    '<div data-t="app" class="hidden">' +
      '<div class="tabs" role="tablist">' +
        '<button data-t="tabChart" type="button" role="tab" aria-selected="true">Chart</button>' +
        '<button data-t="tabBoard" type="button" role="tab" aria-selected="false">Board<span data-t="boardCount" class="count"></span></button>' +
      '</div>' +
      '<section data-t="paneChart" class="pane" role="tabpanel">' +
        '<div class="card">' +
          '<div class="pick"><label data-t="srcPickLabel">Saved query</label><select data-t="srcPick" class="sel"></select></div>' +
          '<textarea data-t="srcSql" class="editor" rows="5" aria-label="SQL" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="SELECT category, count(*) AS orders FROM work_orders GROUP BY category"></textarea>' +
          '<div class="run-row"><button data-t="btnRun" class="btn primary" type="button">Run</button><span class="run-note">Read only. Ctrl or Cmd plus Enter runs it too.</span></div>' +
          '<div data-t="sampleWrap"><p class="label-sm" style="margin-bottom:0.45rem">Sample charts</p><div data-t="sampleChips" class="chips"></div></div>' +
        '</div>' +
        '<div data-t="chartCard" class="card hidden">' +
          '<div class="card-h"><h2 data-t="chartTitle"></h2><span data-t="chartMeta" class="muted"></span></div>' +
          '<div data-t="chartArea"></div>' +
          '<p data-t="cutNote" class="cut-note hidden"></p>' +
          '<div data-t="controls" class="controls"></div>' +
          '<details data-t="tblBox" class="tbl"><summary>Data table</summary><div data-t="tblBody"></div></details>' +
          '<div class="actions">' +
            '<button data-t="btnPin" class="btn primary" type="button">Pin to board</button>' +
            '<button data-t="btnReport" class="btn" type="button">Add to report</button>' +
            '<button data-t="btnPng" class="btn" type="button">PNG</button>' +
            '<button data-t="btnQuery" class="btn" type="button">Open in Query</button>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section data-t="paneBoard" class="pane hidden" role="tabpanel">' +
        '<div class="card-h"><h2 style="margin:0;font-size:1.1rem">Board</h2><button data-t="btnRefresh" class="btn small" type="button">Rerun all</button></div>' +
        '<div data-t="board" class="board"></div>' +
      '</section>' +
    '</div>' +
    '</div>' +
    '<div data-t="saveScrim" class="scrim hidden" role="dialog" aria-modal="true" aria-label="Name this chart">' +
      '<div class="sheet"><div class="sheet-head"><h2>Name this chart</h2><button class="btn icon-btn ghost" type="button" data-close="saveScrim" aria-label="Close">' + X + '</button></div>' +
      '<div class="sheet-body">' +
        '<div class="field"><label data-t="qNameLabel">Name</label><input data-t="qName" type="text" maxlength="80" autocomplete="off"></div>' +
        '<p class="muted">The query is saved under this name so the board and the report can run it again. The name is the chart title.</p>' +
        '<div class="sheet-row"><button data-t="btnSaveGo" class="btn primary" type="button">Save and pin</button></div>' +
      '</div></div>' +
    '</div>';

  QDeskTabs.chart = {
    title: 'Chart',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',
    renderer: renderer,
    samples: SAMPLES,
    mount: function (root, ctx) {
      root.innerHTML = TEMPLATE;
      var $ = function (name) { return root.querySelector('[data-t="' + name + '"]'); };
      var sfx = Math.random().toString(36).slice(2, 8);
      $('srcPick').id = 'qd-src-' + sfx; $('srcPickLabel').setAttribute('for', $('srcPick').id);
      $('qName').id = 'qd-cname-' + sfx; $('qNameLabel').setAttribute('for', $('qName').id);
      var SET = ctx.chartSettings;
      var S = { p: null, tab: 'chart', boardCharts: [], active: false, dirty: true, after: null };
      var C = { queryId: null, name: '', result: null, sug: null, spec: null, editingId: null, forced: null, prefer: null, chart: null, error: null };
      var listeners = [];
      function on(el, ev, fn, o) { el.addEventListener(ev, fn, o); listeners.push([el, ev, fn, o]); }
      var toastT = ctx.toast;
      function drawHere(holder, spec, d, h) { return draw(holder, spec, d, { height: h, theme: 'dark', settings: SET }); }

      /* =========================================================== result grid */

      function gridHtml(res, n) { return QDeskTabs.query.gridHtml(res, n); }

      /* ========================================================= the Chart pane */

      function hasSampleTables(p) {
        return ['students', 'campuses', 'work_orders', 'enrollments', 'sections', 'terms', 'instructors', 'courses', 'departments'].every(function (t) { return p.hasTable(t); });
      }
      function renderSource() {
        var p = S.p, sel = $('srcPick');
        if (!p) return;
        var list = p.queries();
        sel.innerHTML = '<option value="">' + (list.length ? 'Pick a saved query, or type one below' : 'No saved queries yet, type one below') + '</option>' +
          list.map(function (q) { return '<option value="' + q.id + '">' + esc(q.name) + ' [' + esc(q.origin || 'manual') + ']</option>'; }).join('');
        sel.value = C.queryId ? String(C.queryId) : '';
        var chips = hasSampleTables(p);
        show($('sampleWrap'), chips);
        $('sampleChips').innerHTML = chips ? SAMPLES.map(function (s) {
          return '<button class="chip" type="button" data-sample="' + s.key + '"><span class="k">' + esc(s.kind) + '</span>' + esc(s.label) + '</button>';
        }).join('') : '';
      }
      function resetChart() {
        destroy($('chartArea'));
        C.result = null; C.sug = null; C.spec = null; C.error = null; C.editingId = null; C.forced = null; C.prefer = null;
        show($('chartCard'), false);
      }
      function run() {
        var p = S.p, sql = $('srcSql').value;
        if (!p || !sql.trim()) { toastT('Type a query or pick a saved one first.'); return; }
        C.error = null;
        try { C.result = p.query(sql); }
        catch (e) { C.result = null; C.sug = null; C.spec = null; C.error = e.message; renderChart(); return; }
        var title = C.name || 'Untitled chart';
        C.sug = QDCharts.suggest(C.result, { title: title });
        if (C.forced) { C.spec = JSON.parse(JSON.stringify(C.forced)); C.forced = null; }
        else if (C.sug.spec) {
          C.spec = C.sug.spec;
          C.spec.limit = SET.limit;
          if (C.prefer && C.sug.types.indexOf(C.prefer) !== -1) C.spec.type = C.prefer;
        } else C.spec = null;
        C.prefer = null;
        renderChart();
      }
      function chartData() {
        try { return { d: QDCharts.data(C.result, C.spec) }; } catch (e) { return { err: e.message }; }
      }
      function renderChart() {
        var area = $('chartArea');
        show($('chartCard'), true);
        destroy(area);
        $('chartTitle').textContent = C.spec ? (C.spec.title || 'Untitled chart') : (C.name || 'Result');
        $('btnPin').textContent = C.editingId ? 'Update pin' : 'Pin to board';
        show($('cutNote'), false);
        var actionsOn = !!(C.spec && !C.error);
        $('btnPin').disabled = !actionsOn; $('btnPng').disabled = !actionsOn; $('btnReport').disabled = !actionsOn;
        if (C.error) {
          $('chartMeta').textContent = '';
          area.innerHTML = '<div class="errbox"><strong>The query did not run</strong>' + esc(C.error) + '</div>';
          $('controls').innerHTML = ''; show($('tblBox'), false);
          return;
        }
        var res = C.result;
        $('chartMeta').textContent = plural(res.rowCount, 'row') + (res.truncated ? ', cut at ' + QD.LIMITS.resultRows.toLocaleString() : '');
        show($('tblBox'), true);
        $('tblBox').open = SET.table || $('tblBox').open;
        renderTable();
        if (!C.spec) {
          area.innerHTML = '<div class="nochart" data-nochart="1">' + esc(C.sug ? C.sug.reason : 'No chart fits this result.') + '</div>';
          $('controls').innerHTML = '';
          return;
        }
        var got = chartData();
        if (got.err) area.innerHTML = '<div class="errbox"><strong>This chart does not fit the result</strong>' + esc(got.err) + '</div>';
        else {
          C.chart = drawHere(area, C.spec, got.d, 300);
          area.setAttribute('data-type', C.spec.type);
          if (got.d.truncated) { $('cutNote').textContent = 'Showing the first ' + C.spec.limit + '. Raise the limit to see more.'; show($('cutNote'), true); }
        }
        renderControls();
      }
      function renderTable() {
        if (!$('tblBox').open || !C.result) { $('tblBody').innerHTML = ''; return; }
        var res = C.result, n = Math.min(200, res.rows.length);
        $('tblBody').innerHTML = res.columns.length ? gridHtml(res, n) + (n < res.rows.length ? '<p class="muted" style="padding:0.6rem 0.9rem">First ' + n + ' of ' + res.rows.length.toLocaleString() + ' rows.</p>' : '') : '';
      }
      function colsOf(kind) { return C.sug.profile.filter(function (c) { return kind.indexOf(c.kind) !== -1; }).map(function (c) { return c.name; }); }
      function renderControls() {
        var s = C.spec, h = '';
        function seg(name, opts, cur) {
          return '<div class="seg" role="group" aria-label="' + name + '">' + opts.map(function (o) {
            return '<button type="button" data-' + name + '="' + o + '" aria-pressed="' + (o === cur) + '">' + o + '</button>';
          }).join('') + '</div>';
        }
        function select(name, label, opts, cur, noneLabel) {
          var id = 'qd-' + name + '-' + sfx;
          return '<div class="pick"><label for="' + id + '">' + label + '</label><select id="' + id + '" data-ctl="' + name + '" class="sel">' +
            (noneLabel ? '<option value="">' + noneLabel + '</option>' : '') +
            opts.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + ' value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') + '</select></div>';
        }
        if (C.sug.types.length > 1) h += '<div class="wide"><p class="label-sm" style="margin-bottom:0.35rem">Type</p>' + seg('ctype', C.sug.types, s.type) + '</div>';
        if (s.type !== 'tile') {
          var xs = s.type === 'scatter' ? colsOf(['number']) : colsOf(['label', 'date']);
          h += select('x', s.type === 'pie' ? 'Slices' : 'X axis', xs, s.x);
          if (s.type !== 'pie' && s.type !== 'scatter') {
            var ss = colsOf(['label', 'date']).filter(function (c) { return c !== s.x; });
            if (ss.length) h += select('series', 'Series', ss, s.series, 'None');
          }
          var ys = colsOf(['number']).filter(function (c) { return !(s.type === 'scatter' && c === s.x); });
          h += '<div class="wide"><p class="label-sm" style="margin-bottom:0.35rem">' + (s.type === 'scatter' ? 'Y axis' : 'Values') + '</p><div class="ychips">' +
            ys.map(function (c) { return '<button type="button" data-cy="' + esc(c) + '" aria-pressed="' + (s.y.indexOf(c) !== -1) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>';
          if (s.type !== 'scatter') h += '<div class="wide"><p class="label-sm" style="margin-bottom:0.35rem">Sort</p>' + seg('csort', ['none', 'asc', 'desc'], s.sort) + '</div>';
          var canStack = (s.type === 'bar' || s.type === 'line') && (s.series || s.y.length > 1);
          h += '<div><button type="button" class="switch" role="switch" data-cstack="1" aria-checked="' + !!(s.stacked && canStack) + '"' + (canStack ? '' : ' disabled') + '><span class="track" aria-hidden="true"></span>Stacked</button></div>';
          h += '<div><p class="label-sm" style="margin-bottom:0.35rem">Limit</p><div class="stepper"><button type="button" data-climit="-1" aria-label="Show fewer">-</button><output data-t="ctlLimit">' + s.limit + '</output><button type="button" data-climit="1" aria-label="Show more">+</button></div></div>';
        }
        $('controls').innerHTML = h;
      }
      function stepLimit(cur, dir) {
        var i, n = LIMIT_STEPS.length;
        if (dir > 0) { for (i = 0; i < n; i += 1) if (LIMIT_STEPS[i] > cur) return LIMIT_STEPS[i]; return LIMIT_STEPS[n - 1]; }
        for (i = n - 1; i >= 0; i -= 1) if (LIMIT_STEPS[i] < cur) return LIMIT_STEPS[i];
        return LIMIT_STEPS[0];
      }
      function setType(t) {
        var s = C.spec;
        if (C.sug.types.indexOf(t) === -1) return;
        s.type = t;
        if (t === 'pie') { s.series = null; s.y = [s.y[0]]; s.stacked = false; if (s.sort === 'none') s.sort = 'desc'; }
        if (t === 'line' && !s.series && C.sug.shape === 'line') s.sort = 'asc';
        renderChart();
      }
      function onControl(e) {
        var b = e.target.closest ? e.target.closest('button') : null, a, s = C.spec;
        if (!b || !s) return;
        if ((a = b.getAttribute('data-ctype'))) setType(a);
        else if ((a = b.getAttribute('data-csort'))) { s.sort = a; renderChart(); }
        else if ((a = b.getAttribute('data-climit'))) { s.limit = stepLimit(s.limit, +a); renderChart(); }
        else if (b.getAttribute('data-cstack')) { s.stacked = !s.stacked; renderChart(); }
        else if ((a = b.getAttribute('data-cy'))) {
          var multi = (s.type === 'line' || s.type === 'bar') && !s.series, i = s.y.indexOf(a);
          if (!multi) s.y = [a];
          else if (i === -1) { if (s.y.length < 4) s.y.push(a); else toastT('A chart shows at most four value columns.'); }
          else if (s.y.length > 1) s.y.splice(i, 1);
          if (s.y.length < 2 && !s.series) s.stacked = false;
          renderChart();
        }
      }
      function onControlChange(e) {
        var s = C.spec, t = e.target, w = t.getAttribute && t.getAttribute('data-ctl');
        if (!s || !w) return;
        if (w === 'x') { s.x = t.value; if (s.series === s.x) s.series = null; renderChart(); }
        else if (w === 'series') { s.series = t.value || null; if (s.series) s.y = [s.y[0]]; else s.stacked = false; renderChart(); }
      }
      function loadSample(key) {
        var s = SAMPLES.filter(function (x) { return x.key === key; })[0];
        if (!s) return;
        C.queryId = null; C.name = s.label; C.editingId = null; C.forced = null; C.prefer = s.type;
        $('srcSql').value = s.sql; $('srcPick').value = '';
        run();
      }
      function pickSaved(id) {
        C.editingId = null; C.forced = null; C.prefer = null;
        if (!id) { C.queryId = null; C.name = ''; return; }
        var q = S.p.getQuery(+id);
        if (!q) return;
        C.queryId = q.id; C.name = q.name;
        $('srcSql').value = q.sql;
        run();
      }
      function onEditorInput() {
        if (!C.queryId) return;
        var q = S.p.getQuery(C.queryId);
        if (!q || q.sql !== $('srcSql').value) { C.queryId = null; C.editingId = null; $('srcPick').value = ''; }
      }

      /* ============================================================ pinning */

      /** Pin, then run after(chartId) if given. Asks for a name first when the query is not saved. */
      function pin(after) {
        if (!S.p || !C.spec) return;
        var q = C.queryId ? S.p.getQuery(C.queryId) : null;
        if (q && q.sql === $('srcSql').value) { var id = finishPin(q.id, q.name); if (after && id) after(id); return; }
        S.after = after || null;
        $('qName').value = C.name && C.name !== 'Untitled chart' ? C.name : '';
        $('btnSaveGo').textContent = after ? 'Save, pin and add' : 'Save and pin';
        show($('saveScrim'), true);
        if (ctx.wide()) $('qName').focus();
      }
      function saveAndPin() {
        var name = $('qName').value.trim();
        if (!name) { $('qName').focus(); toastT('Give the chart a name first.'); return; }
        var id = S.p.saveQuery({ name: name, sql: $('srcSql').value, origin: 'manual' });
        show($('saveScrim'), false);
        C.queryId = id; C.name = name;
        var cid = finishPin(id, name);
        renderSource();
        var after = S.after; S.after = null;
        if (after && cid) after(cid);
      }
      function finishPin(queryId, name) {
        var spec = C.spec;
        if (C.editingId && !(S.p.charts().some(function (c) { return c.id === C.editingId && c.queryId === queryId; }))) C.editingId = null;
        if (!C.editingId) spec.title = name;
        try {
          if (C.editingId) { S.p.updateChart(C.editingId, spec); toastT('Board chart updated'); }
          else { C.editingId = S.p.saveChart({ queryId: queryId, spec: spec }); toastT('Pinned to the board'); }
        } catch (e) { toastT(e.message); return null; }
        ctx.saveNow();
        renderCount();
        renderChart();
        return C.editingId;
      }
      function addToReport() {
        if (!S.p || !C.spec) return;
        var current = C.editingId && S.p.charts().some(function (c) { return c.id === C.editingId; });
        if (current) {
          var q = S.p.getQuery(C.queryId);
          if (q && q.sql === $('srcSql').value) { S.p.updateChart(C.editingId, C.spec); ctx.report.add({ kind: 'chart', refId: C.editingId }); return; }
        }
        pin(function (cid) { ctx.report.add({ kind: 'chart', refId: cid }); });
      }

      /* ============================================================== board */

      function renderCount() {
        var n = S.p ? S.p.charts().length : 0;
        $('boardCount').textContent = n ? String(n) : '';
      }
      function destroyBoard() {
        Array.prototype.forEach.call($('board').querySelectorAll('[data-holder]'), destroy);
        S.boardCharts = [];
      }
      function renderBoard() {
        var p = S.p, box = $('board');
        destroyBoard();
        if (!p) return;
        var list = p.charts();
        renderCount();
        if (!list.length) { box.innerHTML = '<div class="board-empty">Nothing pinned yet. Make a chart on the Chart tab and tap Pin to board.</div>'; return; }
        box.innerHTML = list.map(function (c, i) {
          return '<article class="bcard" data-card="' + c.id + '"><h3>' + esc((c.spec && c.spec.title) || c.name || 'Chart') + '</h3>' +
            '<div data-holder="' + c.id + '"></div><p class="src" data-src="' + c.id + '"></p>' +
            '<div class="acts"><button class="btn small" type="button" data-bedit="' + c.id + '">Edit</button>' +
            '<button class="btn small" type="button" data-breport="' + c.id + '">Add to report</button>' +
            '<button class="btn small" type="button" data-bup="' + c.id + '"' + (i === 0 ? ' disabled' : '') + '>Move up</button>' +
            '<button class="btn small" type="button" data-bdown="' + c.id + '"' + (i === list.length - 1 ? ' disabled' : '') + '>Move down</button>' +
            '<button class="btn small" type="button" data-bpng="' + c.id + '">PNG</button>' +
            '<button class="btn small danger" type="button" data-bdel="' + c.id + '">Remove</button></div></article>';
        }).join('');
        list.forEach(function (c) {
          var holder = box.querySelector('[data-holder="' + c.id + '"]'), src = box.querySelector('[data-src="' + c.id + '"]');
          var item = { id: c.id, spec: c.spec, d: null, holder: holder };
          S.boardCharts.push(item);
          try {
            if (!c.spec) throw new Error('This chart was saved in a form this app cannot read.');
            var q = c.queryId ? p.getQuery(c.queryId) : null;
            if (!q) throw new Error('The saved query behind this chart was deleted, so it cannot be drawn again.');
            var res = p.query(q.sql, { history: false });
            item.d = QDCharts.data(res, c.spec);
            drawHere(holder, c.spec, item.d, 280);
            src.textContent = q.name + DOT + plural(res.rowCount, 'row');
          } catch (e) {
            holder.innerHTML = '<div class="errbox" data-err="1"><strong>This chart could not be drawn</strong>' + esc(e.message) + '</div>';
            var pngBtn = box.querySelector('[data-bpng="' + c.id + '"]'); if (pngBtn) pngBtn.disabled = true;
          }
        });
      }
      function boardItem(id) { return S.boardCharts.filter(function (x) { return x.id === id; })[0]; }
      function editPinned(id) {
        var c = S.p.charts().filter(function (x) { return x.id === id; })[0];
        if (!c) return;
        var q = c.queryId ? S.p.getQuery(c.queryId) : null;
        if (!q) { toastT('The saved query behind this chart was deleted.'); return; }
        C.queryId = q.id; C.name = q.name; C.editingId = c.id; C.forced = c.spec; C.prefer = null;
        $('srcSql').value = q.sql;
        renderSource();
        setTab('chart');
        run();
      }
      function onBoardClick(e) {
        var b = e.target.closest ? e.target.closest('button') : null, a;
        if (!b || !S.p) return;
        var ids = S.p.charts().map(function (c) { return c.id; });
        if ((a = b.getAttribute('data-bedit'))) editPinned(+a);
        else if ((a = b.getAttribute('data-breport'))) ctx.report.add({ kind: 'chart', refId: +a });
        else if ((a = b.getAttribute('data-bup'))) { S.p.moveChart(+a, ids.indexOf(+a) - 1); renderBoard(); }
        else if ((a = b.getAttribute('data-bdown'))) { S.p.moveChart(+a, ids.indexOf(+a) + 1); renderBoard(); }
        else if ((a = b.getAttribute('data-bpng'))) { var it = boardItem(+a); if (it && it.d) exportPng(it.holder, it.spec, it.d); }
        else if ((a = b.getAttribute('data-bdel'))) {
          if (b.getAttribute('data-armed') !== '1') { b.setAttribute('data-armed', '1'); b.textContent = 'Tap again'; return; }
          S.p.deleteChart(+a);
          if (C.editingId === +a) { C.editingId = null; if (C.spec) renderChart(); }
          renderBoard(); toastT('Removed from the board and the report');
        }
      }
      function setTab(t) {
        S.tab = t;
        $('tabChart').setAttribute('aria-selected', String(t === 'chart'));
        $('tabBoard').setAttribute('aria-selected', String(t === 'board'));
        show($('paneChart'), t === 'chart');
        show($('paneBoard'), t === 'board');
        if (t === 'board') renderBoard(); else destroyBoard();
      }

      function render() {
        S.dirty = false;
        var has = !!(S.p && (S.p.userTables().length > 0 || S.p.userViews().length > 0));
        show($('empty'), !has);
        show($('app'), has);
        if (!has) return;
        renderSource();
        renderCount();
        setTab(S.tab);
        if (S.tab === 'chart' && C.result && !C.error) renderChart();
      }

      /* ============================================================= events */

      on($('srcSql'), 'keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
      on($('srcSql'), 'input', onEditorInput);
      on($('srcPick'), 'change', function (e) { pickSaved(e.target.value); });
      on($('controls'), 'click', onControl);
      on($('controls'), 'change', onControlChange);
      on($('tblBox'), 'toggle', renderTable);
      on($('board'), 'click', onBoardClick);
      on($('qName'), 'keydown', function (e) { if (e.key === 'Enter') saveAndPin(); });
      on(root, 'click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) { if (e.target.getAttribute && e.target.getAttribute('data-t') === 'saveScrim') show($('saveScrim'), false); return; }
        var a, t = b.getAttribute('data-t');
        if (t === 'btnRun') run();
        else if (t === 'btnPin') pin(null);
        else if (t === 'btnReport') addToReport();
        else if (t === 'btnPng') { var g = C.spec && chartData(); if (g && g.d) exportPng($('chartArea'), C.spec, g.d); }
        else if (t === 'btnQuery') { var sql = $('srcSql').value; if (sql.trim()) ctx.goTo('query', { sql: sql, run: true, queryId: C.queryId, title: C.name }); }
        else if (t === 'btnSaveGo') saveAndPin();
        else if (t === 'tabChart') { setTab('chart'); if (C.spec) renderChart(); }
        else if (t === 'tabBoard') setTab('board');
        else if (t === 'btnRefresh') { renderBoard(); toastT('Every pinned query ran again'); }
        else if ((a = b.getAttribute('data-close')) === 'saveScrim') show($('saveScrim'), false);
        else if ((a = b.getAttribute('data-sample'))) loadSample(a);
        else if ((a = b.getAttribute('data-act'))) {
          if (a === 'sample') ctx.loadSample(); else if (a === 'open') ctx.openProjects(); else if (a === 'load') ctx.goTo('load');
        }
      });
      on(document, 'keydown', function (e) { if (e.key === 'Escape' && S.active) show($('saveScrim'), false); });
      var mq = window.matchMedia('(max-width: 560px)'), redraw = function () {
        if (!S.active) return;
        if (S.tab === 'board') renderBoard(); else if (C.spec && !C.error) renderChart();
      };
      if (mq.addEventListener) { mq.addEventListener('change', redraw); listeners.push([mq, 'change', redraw]); }

      /* ====================================================== the component */

      function useProject(p) {
        if (S.p !== p) { destroyBoard(); resetChart(); C.queryId = null; C.name = ''; $('srcSql').value = ''; }
        S.p = p;
        S.dirty = true;
        if (S.active) render();
      }
      useProject(ctx.project());

      return {
        activate: function (payload) {
          S.active = true;
          if (S.p !== ctx.project()) useProject(ctx.project());
          if (S.dirty) render();
          else if (S.tab === 'board') renderBoard();
          if (payload && payload.editChartId && S.p) { editPinned(payload.editChartId); return; }
          if (payload && typeof payload.sql === 'string' && S.p) {
            var q = payload.queryId ? S.p.getQuery(payload.queryId) : null;
            C.queryId = q && q.sql === payload.sql ? q.id : null;
            C.name = payload.title || (q ? q.name : '') || '';
            C.editingId = null; C.forced = null; C.prefer = null;
            $('srcSql').value = payload.sql;
            renderSource();
            setTab('chart');
            run();
          }
        },
        deactivate: function () { S.active = false; destroyBoard(); destroy($('chartArea')); S.dirty = true; },
        projectChanged: function (p) { useProject(p); },
        stale: function (kinds) {
          S.dirty = true;
          if (S.active) { if (kinds.indexOf('settings') >= 0 && C.spec) renderChart(); else render(); }
        },
        unmount: function () { destroyBoard(); destroy($('chartArea')); listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); }); root.innerHTML = ''; },
        state: S, chart: C, run: run
      };
    }
  };
})();
