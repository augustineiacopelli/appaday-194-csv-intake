/* Report tab, new on Day 200. The report is the project's notebook in _qd_notebook, read and written only
 * through the core block methods: notes, saved queries with their result tables, and pinned charts, in
 * order. Every query and chart reruns when the tab opens and again at export, so the report shows the data
 * as it is now. Export writes one self contained HTML file with print styles; Preview shows that same file
 * in a sandboxed frame. */
(function () {
  'use strict';
  var CARD_ROWS = 20, EXPORT_ROWS = 500, IDLE_MS = 800;
  var APP_URL = 'https://augustineiacopelli.github.io/appaday-200-query-desk/';
  var X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function show(el, on) { el.classList[on ? 'remove' : 'add']('hidden'); }
  function plural(n, one, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? one : (many || one + 's')); }
  function longDate(d) {
    try { return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return d.toDateString(); }
  }
  function ymd(d) {
    function p2(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  /** Note text as paragraphs: a blank line starts a new one, a single line break is kept. */
  function paragraphs(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(function (p) { return p.replace(/^\n+|\n+$/g, ''); })
      .filter(function (p) { return p.trim() !== ''; })
      .map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }
  function cell(v) {
    if (v === null || v === undefined) return '<td class="null">NULL</td>';
    if (v instanceof Uint8Array) return '<td class="null">blob ' + v.length + ' bytes</td>';
    if (typeof v === 'number') return '<td class="num">' + esc(v.toLocaleString(undefined, { maximumFractionDigits: 6 })) + '</td>';
    return '<td>' + esc(v) + '</td>';
  }
  function tableHtml(columns, rows) {
    return '<table><thead><tr>' + columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(cell).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }

  /* The exported file's own stylesheet: black on white, system fonts, and print rules for a clean PDF. */
  var EXPORT_CSS = [
    '*{box-sizing:border-box}',
    'html{-webkit-text-size-adjust:100%}',
    'body{margin:0;background:#fff;color:#1d1d1f;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',
    'main{max-width:880px;margin:0 auto;padding:32px 20px 40px}',
    'header.top{border-bottom:2px solid #1d1d1f;padding-bottom:14px;margin-bottom:26px}',
    'h1{font-size:28px;line-height:1.15;margin:0 0 8px;letter-spacing:-0.01em}',
    'h2{font-size:19px;line-height:1.25;margin:0 0 6px}',
    '.meta{color:#555;font-size:14px;margin:2px 0}',
    '.block{margin:0 0 30px;break-inside:avoid;page-break-inside:avoid}',
    '.block p{margin:0 0 10px}',
    '.asked{color:#555;font-style:italic}',
    '.caption{color:#333}',
    'pre.sql{background:#f4f4f4;border:1px solid #e3e3e3;border-radius:6px;padding:8px 10px;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:6px 0 10px}',
    '.tablewrap{overflow-x:auto}',
    'table{border-collapse:collapse;width:100%;font-size:13px;margin:4px 0}',
    'thead{display:table-header-group}',
    'th,td{border-bottom:1px solid #e3e3e3;padding:5px 8px;text-align:left;vertical-align:top}',
    'th{background:#f4f4f4;font-weight:600;border-bottom:1px solid #cfcfcf}',
    'td.num{text-align:right;font-variant-numeric:tabular-nums}',
    'td.null{color:#888;font-style:italic}',
    'tr{break-inside:avoid;page-break-inside:avoid}',
    '.note{color:#555;font-size:13px}',
    '.error{border-left:3px solid #b3261e;background:#fbeeed;padding:8px 10px;border-radius:0 6px 6px 0;color:#5f1410}',
    'figure{margin:6px 0 0;break-inside:avoid;page-break-inside:avoid}',
    'figure img{display:block;width:100%;height:auto;border:1px solid #e3e3e3;border-radius:6px}',
    '.tile{border:1px solid #e3e3e3;border-radius:6px;padding:22px;text-align:center}',
    '.tile .v{font-size:48px;font-weight:700;line-height:1.05;font-variant-numeric:tabular-nums}',
    '.tile .l{color:#555}',
    'footer{border-top:1px solid #cfcfcf;margin-top:36px;padding-top:12px;color:#555;font-size:13px}',
    'a{color:inherit;text-decoration:none}',
    '@page{margin:16mm}',
    '@media print{main{max-width:none;padding:0}body{font-size:11pt}.block{margin-bottom:22px}a{color:#1d1d1f}}'
  ].join('\n');

  var TEMPLATE =
    '<div class="tab-in">' +
    '<section data-t="empty" class="empty hidden">' +
      '<div class="empty-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg></div>' +
      '<h1>Reports start with data.</h1>' +
      '<p class="lede">Open a project or load CSV files, then collect notes, query results and charts here and export them as one file you can print to PDF.</p>' +
      '<div class="cta"><button class="btn primary" type="button" data-act="sample">Load sample data</button>' +
      '<button class="btn" type="button" data-act="load">Load CSV files</button>' +
      '<button class="btn" type="button" data-act="open">Open a saved project</button></div>' +
    '</section>' +
    '<div data-t="report" class="hidden">' +
      '<div class="rhead">' +
        '<label class="sr" data-t="titleLabel">Report title</label>' +
        '<input data-t="title" class="rtitle" type="text" maxlength="200" autocomplete="off" spellcheck="true">' +
        '<p data-t="dateLine" class="rdate"></p>' +
      '</div>' +
      '<div class="rtools">' +
        '<button data-t="btnNote" class="btn" type="button">Add note</button>' +
        '<button data-t="btnAddQuery" class="btn" type="button">Add saved query</button>' +
        '<button data-t="btnAddChart" class="btn" type="button">Add pinned chart</button>' +
        '<span class="spacer"></span>' +
        '<button data-t="btnPreview" class="btn" type="button">Preview</button>' +
        '<button data-t="btnExport" class="btn primary" type="button">Export HTML</button>' +
      '</div>' +
      '<div data-t="none" class="rnone hidden"><p>A report collects notes, query results and charts in order.</p><div class="sheet-row" data-t="noneActs"></div></div>' +
      '<div data-t="blocks" class="rblocks"></div>' +
    '</div>' +
    '</div>' +
    '<div data-t="pickScrim" class="scrim hidden" role="dialog" aria-modal="true" aria-label="Add to the report">' +
      '<div class="sheet"><div class="sheet-head"><h2 data-t="pickTitle">Add</h2><button class="btn icon-btn ghost" type="button" data-close="pickScrim" aria-label="Close">' + X + '</button></div>' +
      '<div class="sheet-body"><div data-t="pickList" class="qlist"></div></div></div>' +
    '</div>' +
    '<div data-t="prevScrim" class="scrim prev hidden" role="dialog" aria-modal="true" aria-label="Report preview">' +
      '<div class="sheet"><div class="sheet-head"><h2>Preview</h2><button class="btn icon-btn ghost" type="button" data-close="prevScrim" aria-label="Close">' + X + '</button></div>' +
      '<div class="prev-body"><iframe data-t="prevFrame" sandbox="" title="Report preview"></iframe></div>' +
      '<div class="sheet-row prev-acts"><button data-t="btnExport2" class="btn primary" type="button">Export HTML</button></div></div>' +
    '</div>';

  QDeskTabs.report = {
    title: 'Report',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
    exportCss: EXPORT_CSS,
    mount: function (root, ctx) {
      root.innerHTML = TEMPLATE;
      var $ = function (name) { return root.querySelector('[data-t="' + name + '"]'); };
      var sfx = Math.random().toString(36).slice(2, 8);
      $('title').id = 'qd-rtitle-' + sfx; $('titleLabel').setAttribute('for', $('title').id);
      var S = { p: null, active: false, dirty: true, holders: [], timers: {}, draft: false, pick: null };
      var listeners = [];
      function on(el, ev, fn, o) { el.addEventListener(ev, fn, o); listeners.push([el, ev, fn, o]); }

      /* ============================================================== reading */

      /** Run a block's query or chart now. Returns { query, chart, res, data, error }. */
      function resolve(b) {
        var p = S.p, out = { query: null, chart: null, res: null, data: null, error: null };
        try {
          if (b.kind === 'query') {
            out.query = p.getQuery(b.refId);
            if (!out.query) throw new Error('The saved query behind this block was deleted.');
            out.res = p.query(out.query.sql, { history: false });
          } else if (b.kind === 'chart') {
            out.chart = p.charts().filter(function (c) { return c.id === b.refId; })[0] || null;
            if (!out.chart) throw new Error('The pinned chart behind this block was removed.');
            out.query = out.chart.queryId ? p.getQuery(out.chart.queryId) : null;
            if (!out.query) throw new Error('The saved query behind this chart was deleted, so it cannot be drawn again.');
            if (!out.chart.spec) throw new Error('This chart was saved in a form Query Desk cannot read.');
            out.res = p.query(out.query.sql, { history: false });
            out.data = QDCharts.data(out.res, out.chart.spec);
          }
        } catch (e) { out.error = e.message; }
        return out;
      }

      /* ============================================================== render */

      function destroyCharts() { S.holders.forEach(function (h) { ctx.charts.destroy(h); }); S.holders = []; }

      function moveButtons(i, n) {
        return '<button class="btn small" type="button" data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>Move up</button>' +
          '<button class="btn small" type="button" data-down="' + i + '"' + (i === n - 1 ? ' disabled' : '') + '>Move down</button>' +
          '<button class="btn small danger" type="button" data-remove="' + i + '">Remove</button>';
      }
      function captionHtml(b) {
        return '<div class="rcap' + (b.body ? '' : ' hidden') + '" data-capwrap="' + b.id + '">' +
          '<textarea class="rcaption" data-caption="' + b.id + '" rows="2" maxlength="20000" aria-label="Caption" placeholder="A caption for this block">' + esc(b.body || '') + '</textarea></div>';
      }

      function cardHtml(b, i, n) {
        var h = '<article class="rblock k-' + b.kind + '" data-block="' + b.id + '">';
        if (b.kind === 'text') {
          h += '<div class="rkind">Note</div><textarea class="rnote" data-note="' + b.id + '" rows="3" maxlength="20000" aria-label="Note">' + esc(b.body) + '</textarea>';
          h += '<div class="acts">' + moveButtons(i, n) + '</div>';
          return h + '</article>';
        }
        var r = resolve(b);
        if (b.kind === 'query') {
          var q = r.query;
          h += '<div class="rkind">Query</div><h2>' + esc(q ? q.name : 'Missing query') + '</h2>';
          if (q && q.origin === 'ask' && q.question) h += '<p class="asked">Asked: ' + esc(q.question) + '</p>';
          h += captionHtml(b);
          if (q) h += '<details class="rsql"><summary>The SQL</summary><pre class="sql">' + esc(q.sql) + '</pre></details>';
          if (r.error) h += '<div class="errcard"><div><strong>This block could not run</strong><p>' + esc(r.error) + '</p></div></div>';
          else {
            var res = r.res, n2 = Math.min(CARD_ROWS, res.rows.length);
            h += '<div class="result">' + QDeskTabs.query.gridHtml(res, n2) +
              '<div class="rcount">' + (res.rows.length > n2 ? 'First ' + n2 + ' of ' + plural(res.rowCount, 'row') + (res.truncated ? ', cut at ' + QD.LIMITS.resultRows.toLocaleString() : '') : plural(res.rowCount, 'row')) + '. The export shows up to ' + EXPORT_ROWS + '.</div></div>';
          }
          h += '<div class="acts">' + (q ? '<button class="btn small" type="button" data-editq="' + b.id + '">Edit in Query</button>' : '') +
            '<button class="btn small" type="button" data-cap="' + b.id + '">Caption</button>' + moveButtons(i, n) + '</div>';
        } else {
          var c = r.chart;
          h += '<div class="rkind">Chart</div><h2>' + esc(c && c.spec ? (c.spec.title || c.name) : 'Missing chart') + '</h2>';
          h += captionHtml(b);
          if (r.error) h += '<div class="errcard"><div><strong>This chart could not be drawn</strong><p>' + esc(r.error) + '</p></div></div>';
          else h += '<div class="rchart" data-holder="' + b.id + '"></div>';
          h += '<div class="acts">' + (c ? '<button class="btn small" type="button" data-editc="' + b.id + '">Edit in Chart</button>' : '') +
            '<button class="btn small" type="button" data-cap="' + b.id + '">Caption</button>' + moveButtons(i, n) + '</div>';
          b._r = r;
        }
        return h + '</article>';
      }

      function render() {
        S.dirty = false;
        var p = S.p, has = !!(p && (p.userTables().length || p.blocks().length));
        show($('empty'), !has);
        show($('report'), has);
        destroyCharts();
        if (!has) { $('blocks').innerHTML = ''; return; }
        if (document.activeElement !== $('title')) $('title').value = p.reportTitle();
        $('dateLine').textContent = 'Dated ' + longDate(new Date()) + ' when exported';
        var list = p.blocks(), qn = p.queries().length, cn = p.charts().length;
        $('btnAddQuery').disabled = !qn; $('btnAddChart').disabled = !cn;
        $('btnExport').disabled = !list.length; $('btnPreview').disabled = !list.length;
        show($('none'), !list.length && !S.draft);
        $('noneActs').innerHTML = '<button class="btn primary" type="button" data-t="btnNote2">Add note</button>' +
          (qn ? '<button class="btn" type="button" data-t="btnAddQuery2">Add saved query</button>' : '') +
          (cn ? '<button class="btn" type="button" data-t="btnAddChart2">Add pinned chart</button>' : '');
        $('blocks').innerHTML = list.map(function (b, i) { return cardHtml(b, i, list.length); }).join('') + (S.draft ? draftHtml() : '');
        list.forEach(function (b) {
          if (b.kind !== 'chart' || !b._r || b._r.error) return;
          var holder = $('blocks').querySelector('[data-holder="' + b.id + '"]');
          if (!holder) return;
          ctx.charts.draw(holder, b._r.chart.spec, b._r.data, { height: 280, theme: 'dark', settings: ctx.chartSettings });
          S.holders.push(holder);
        });
        Array.prototype.forEach.call(root.querySelectorAll('textarea.rnote, textarea.rcaption'), grow);
      }

      function draftHtml() {
        return '<article class="rblock k-text draft" data-block="draft"><div class="rkind">New note</div>' +
          '<textarea class="rnote" data-note="draft" rows="3" maxlength="20000" aria-label="New note" placeholder="Write a note. It saves as you type."></textarea>' +
          '<div class="acts"><button class="btn small" type="button" data-dropdraft="1">Cancel</button></div></article>';
      }

      function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, 64), 640) + 'px'; }

      /* ============================================================== writing */

      function saveNote(ta) {
        var id = ta.getAttribute('data-note'), text = ta.value;
        clearTimeout(S.timers[id]); delete S.timers[id];
        if (id === 'draft') {
          if (!text.trim()) return;
          try {
            var nid = S.p.addBlock({ kind: 'text', body: text });
            S.draft = false;
            ta.setAttribute('data-note', String(nid));
            var art = ta.closest('article'); art.setAttribute('data-block', String(nid)); art.classList.remove('draft');
            art.querySelector('.rkind').textContent = 'Note';
            var n = S.p.blocks().length;
            art.querySelector('.acts').innerHTML = moveButtons(n - 1, n);
            refreshMoves();
            show($('none'), false);
            $('btnExport').disabled = false; $('btnPreview').disabled = false;
          } catch (e) { ctx.toast(e.message); }
          return;
        }
        var b = S.p.blocks().filter(function (x) { return x.id === +id; })[0];
        if (!b || b.body === text) return;
        if (!text.trim()) return;
        try { S.p.updateBlock(+id, { body: text }); } catch (e) { ctx.toast(e.message); }
      }
      function saveCaption(ta) {
        var id = +ta.getAttribute('data-caption');
        clearTimeout(S.timers['c' + id]); delete S.timers['c' + id];
        var b = S.p.blocks().filter(function (x) { return x.id === id; })[0];
        if (!b) return;
        var text = ta.value.trim() ? ta.value : '';
        if ((b.body || '') === text) return;
        try { S.p.updateBlock(id, { body: text }); } catch (e) { ctx.toast(e.message); }
      }
      /** Keep the Move buttons right after a note is added without redrawing the cards being typed in. */
      function refreshMoves() {
        var arts = $('blocks').querySelectorAll('article.rblock:not(.draft)'), n = arts.length;
        Array.prototype.forEach.call(arts, function (a, i) {
          var up = a.querySelector('[data-up]'), down = a.querySelector('[data-down]'), rm = a.querySelector('[data-remove]');
          if (up) { up.setAttribute('data-up', i); up.disabled = i === 0; }
          if (down) { down.setAttribute('data-down', i); down.disabled = i === n - 1; }
          if (rm) rm.setAttribute('data-remove', i);
        });
      }

      function flushEdits() {
        Array.prototype.forEach.call(root.querySelectorAll('textarea.rnote'), function (ta) { if (S.timers[ta.getAttribute('data-note')]) saveNote(ta); });
        Array.prototype.forEach.call(root.querySelectorAll('textarea.rcaption'), function (ta) { if (S.timers['c' + ta.getAttribute('data-caption')]) saveCaption(ta); });
      }

      function move(i, dir) {
        flushEdits();
        var list = S.p.blocks(), b = list[i];
        if (!b) return;
        S.p.moveBlock(b.id, i + dir);
        render();
      }
      function remove(i) {
        flushEdits();
        var list = S.p.blocks(), b = list[i];
        if (!b) return;
        S.p.deleteBlock(b.id);
        render();
        var p = S.p;
        ctx.toast('Removed from the report', {
          label: 'Undo', ms: 5000, run: function () {
            if (S.p !== p) return;
            try { p.addBlock({ kind: b.kind, refId: b.kind === 'text' ? undefined : b.refId, body: b.body, position: i }); render(); }
            catch (e) { ctx.toast(e.message); }
          }
        });
      }

      function addNote() {
        if (!S.p) return;
        S.draft = true;
        render();
        var ta = root.querySelector('textarea[data-note="draft"]');
        if (ta) { ta.focus(); ta.scrollIntoView({ block: 'center' }); }
      }

      function openPicker(kind) {
        var p = S.p, h = '';
        S.pick = kind;
        $('pickTitle').textContent = kind === 'query' ? 'Add a saved query' : 'Add a pinned chart';
        if (kind === 'query') {
          var qs = p.queries();
          h = qs.length ? qs.map(function (q) {
            return '<div class="qitem"><button class="load" type="button" data-pickid="' + q.id + '"><b>' + esc(q.name) + '</b>' +
              (q.question ? '<span class="meta">Asked: ' + esc(q.question) + '</span>' : '') + '<code>' + esc(q.sql) + '</code></button></div>';
          }).join('') : '<p class="muted">No saved queries yet. Save one in Query or Ask.</p>';
        } else {
          var cs = p.charts();
          h = cs.length ? cs.map(function (c) {
            return '<div class="qitem"><button class="load" type="button" data-pickid="' + c.id + '"><b>' + esc((c.spec && c.spec.title) || c.name || 'Chart') + '</b>' +
              '<span class="meta">' + esc(c.spec ? c.spec.type + ' chart' : 'chart') + '</span></button></div>';
          }).join('') : '<p class="muted">Nothing pinned yet. Pin a chart in Chart.</p>';
        }
        $('pickList').innerHTML = h;
        show($('pickScrim'), true);
      }

      /* ============================================================== export */

      function buildHtml() {
        flushEdits();
        var p = S.p, now = new Date(), title = p.reportTitle(), tables = p.userTables(), rows = 0;
        tables.forEach(function (t) { rows += Number(p.scalar('SELECT count(*) FROM ' + QD.quoteIdent(t))); });
        var body = '<header class="top"><h1>' + esc(title) + '</h1>' +
          '<p class="meta">' + esc(p.name) + ' &middot; ' + esc(longDate(now)) + '</p>' +
          '<p class="meta">' + esc(plural(tables.length, 'table') + ' holding ' + plural(rows, 'row')) + '</p></header>';
        p.blocks().forEach(function (b) {
          if (b.kind === 'text') { body += '<section class="block text">' + paragraphs(b.body) + '</section>'; return; }
          var r = resolve(b), h = '<section class="block ' + b.kind + '">';
          if (b.kind === 'query') {
            var q = r.query;
            h += '<h2>' + esc(q ? q.name : 'Missing query') + '</h2>';
            if (q && q.origin === 'ask' && q.question) h += '<p class="asked">Asked: ' + esc(q.question) + '</p>';
            if (b.body) h += '<div class="caption">' + paragraphs(b.body) + '</div>';
            if (q) h += '<pre class="sql">' + esc(q.sql) + '</pre>';
            if (r.error) h += '<p class="error">' + esc(r.error) + '</p>';
            else {
              var res = r.res, shown = res.rows.slice(0, EXPORT_ROWS);
              h += res.columns.length ? '<div class="tablewrap">' + tableHtml(res.columns, shown) + '</div>' : '<p class="note">The query returned no columns.</p>';
              if (!res.rows.length && res.columns.length) h += '<p class="note">No rows matched.</p>';
              if (res.rows.length > EXPORT_ROWS || res.truncated) h += '<p class="note">Showing the first ' + shown.length.toLocaleString() + ' of ' + (res.truncated ? 'more than ' : '') + res.rowCount.toLocaleString() + ' rows.</p>';
            }
          } else {
            var c = r.chart, spec = c && c.spec;
            h += '<h2>' + esc(spec ? (spec.title || c.name) : 'Missing chart') + '</h2>';
            if (b.body) h += '<div class="caption">' + paragraphs(b.body) + '</div>';
            if (r.error) h += '<p class="error">' + esc(r.error) + '</p>';
            else if (spec.type === 'tile') {
              h += '<div class="tile"><div class="v">' + esc(ctx.charts.fmtNum(r.data.datasets[0].data[0])) + '</div><div class="l">' + esc(spec.y[0]) + '</div></div>';
            } else {
              var url = null;
              try { url = ctx.charts.image(spec, r.data, { width: 960, height: 540, scale: 2, theme: 'light' }); } catch (e) { url = null; }
              if (url) h += '<figure><img src="' + url + '" alt="' + esc(ctx.charts.ariaLabel(spec)) + '"></figure>';
              else {
                var cols = [spec.x || 'label'].concat(r.data.datasets.map(function (d) { return d.label || spec.y[0]; }));
                var trs = r.data.labels.map(function (l, i) { return [l].concat(r.data.datasets.map(function (d) { var v = d.data[i]; return v && typeof v === 'object' ? v.y : v; })); });
                if (spec.type === 'scatter') { cols = [spec.x, spec.y[0]]; trs = r.data.datasets[0].data.map(function (pt) { return [pt.x, pt.y]; }); }
                h += '<p class="note">The chart could not be drawn here, so its data is shown instead.</p><div class="tablewrap">' + tableHtml(cols, trs) + '</div>';
              }
            }
          }
          body += h + '</section>';
        });
        body += '<footer>Made with Query Desk, AppADay 200 &middot; <a href="' + APP_URL + '">augustineiacopelli.github.io/appaday-200-query-desk</a></footer>';
        return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
          '<title>' + esc(title) + '</title>\n<style>\n' + EXPORT_CSS + '\n</style>\n</head>\n<body>\n<main>\n' + body + '\n</main>\n</body>\n</html>\n';
      }

      function fileName() { return QD.fileName(S.p).replace(/\.sqlite$/, '') + '-report-' + ymd(new Date()) + '.html'; }

      function exportHtml() {
        if (!S.p || !S.p.blocks().length) return;
        var html = buildHtml(), name = fileName();
        QD.download(html, name, 'text/html');
        S.lastExport = { name: name, html: html };
        ctx.toast('Exported ' + name + '. Open it and print to save a PDF.');
      }

      function preview() {
        if (!S.p || !S.p.blocks().length) return;
        var html = buildHtml();
        $('prevFrame').setAttribute('srcdoc', html);
        show($('prevScrim'), true);
      }

      /* ============================================================== events */

      on(root, 'click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) {
          var t0 = e.target.getAttribute && e.target.getAttribute('data-t');
          if (t0 === 'pickScrim' || t0 === 'prevScrim') show($(t0), false);
          return;
        }
        var a, t = b.getAttribute('data-t');
        if (t === 'btnNote' || t === 'btnNote2') addNote();
        else if (t === 'btnAddQuery' || t === 'btnAddQuery2') openPicker('query');
        else if (t === 'btnAddChart' || t === 'btnAddChart2') openPicker('chart');
        else if (t === 'btnPreview') preview();
        else if (t === 'btnExport' || t === 'btnExport2') exportHtml();
        else if ((a = b.getAttribute('data-act'))) { if (a === 'sample') ctx.loadSample(); else if (a === 'open') ctx.openProjects(); else if (a === 'load') ctx.goTo('load'); }
        else if ((a = b.getAttribute('data-close'))) show($(a), false);
        else if ((a = b.getAttribute('data-pickid'))) {
          show($('pickScrim'), false);
          try { S.p.addBlock({ kind: S.pick, refId: +a }); render(); ctx.toast('Added to the report'); }
          catch (err) { ctx.toast(err.message); }
        }
        else if ((a = b.getAttribute('data-up')) !== null) move(+a, -1);
        else if ((a = b.getAttribute('data-down')) !== null) move(+a, 1);
        else if ((a = b.getAttribute('data-remove')) !== null) remove(+a);
        else if (b.getAttribute('data-dropdraft')) { S.draft = false; render(); }
        else if ((a = b.getAttribute('data-cap'))) {
          var wrap = root.querySelector('[data-capwrap="' + a + '"]');
          if (wrap) { show(wrap, true); var ta = wrap.querySelector('textarea'); grow(ta); ta.focus(); }
        }
        else if ((a = b.getAttribute('data-editq'))) {
          var bq = S.p.blocks().filter(function (x) { return x.id === +a; })[0], q = bq && S.p.getQuery(bq.refId);
          if (q) ctx.goTo('query', { sql: q.sql, run: true, queryId: q.id, title: q.name });
        }
        else if ((a = b.getAttribute('data-editc'))) {
          var bc = S.p.blocks().filter(function (x) { return x.id === +a; })[0];
          if (bc) ctx.goTo('chart', { editChartId: bc.refId });
        }
      });
      on(root, 'input', function (e) {
        var ta = e.target;
        if (ta.matches('textarea.rnote')) {
          grow(ta);
          var id = ta.getAttribute('data-note');
          clearTimeout(S.timers[id]);
          S.timers[id] = setTimeout(function () { saveNote(ta); }, IDLE_MS);
        } else if (ta.matches('textarea.rcaption')) {
          grow(ta);
          var cid = 'c' + ta.getAttribute('data-caption');
          clearTimeout(S.timers[cid]);
          S.timers[cid] = setTimeout(function () { saveCaption(ta); }, IDLE_MS);
        }
      });
      on(root, 'focusout', function (e) {
        var ta = e.target;
        if (ta.matches && ta.matches('textarea.rnote')) {
          if (ta.getAttribute('data-note') !== 'draft' && !ta.value.trim()) {
            var b = S.p.blocks().filter(function (x) { return x.id === +ta.getAttribute('data-note'); })[0];
            if (b) { ta.value = b.body; grow(ta); ctx.toast('A note needs some text. Use Remove to take it out.'); }
            return;
          }
          saveNote(ta);
        } else if (ta.matches && ta.matches('textarea.rcaption')) saveCaption(ta);
      });
      on($('title'), 'change', function (e) {
        try { S.p.setReportTitle(e.target.value); } catch (err) { ctx.toast(err.message); }
        e.target.value = S.p.reportTitle();
      });
      on($('title'), 'keydown', function (e) { if (e.key === 'Enter') e.target.blur(); });
      on(document, 'keydown', function (e) {
        if (e.key !== 'Escape' || !S.active) return;
        show($('pickScrim'), false); show($('prevScrim'), false);
      });

      /* ======================================================= the component */

      function useProject(p) {
        if (S.p !== p) { S.draft = false; }
        S.p = p;
        S.dirty = true;
        if (S.active) render();
      }
      useProject(ctx.project());

      return {
        activate: function () { S.active = true; if (S.p !== ctx.project()) useProject(ctx.project()); render(); },
        deactivate: function () { flushEdits(); S.active = false; destroyCharts(); },
        projectChanged: function (p) { if (S.p) flushEdits(); useProject(p); },
        stale: function () { S.dirty = true; if (S.active) render(); },
        unmount: function () { flushEdits(); destroyCharts(); listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); }); root.innerHTML = ''; },
        buildHtml: function () { return buildHtml(); },
        fileName: function () { return fileName(); },
        state: S
      };
    }
  };
})();
