/* Query tab, from Query Bench (AppADay 195): the schema panel, the editor, the result grid, history,
 * saved queries and the Allow changes path. Day 200 adds Chart this, Add to report, Ask to explain and
 * the hand over from other tabs through activate({ sql, run }). */
(function () {
  'use strict';
  var LS_DRAFT = 'querybench-draft:';
  var PAGE_ROWS = 200;
  var DOT = ' \u00b7 ';
  var TYPE_LABEL = { integer: 'int', real: 'real', boolean: 'bool', date: 'date', datetime: 'datetime', text: 'text' };
  var X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function show(el, on) { el.classList[on ? 'remove' : 'add']('hidden'); }
  function plural(n, one, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fmtTime(iso) {
    try { var d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return iso; }
  }
  function fmtMs(ms) { return ms < 10 ? (Math.round(ms * 10) / 10) + ' ms' : Math.round(ms).toLocaleString() + ' ms'; }
  function affinityType(decl) {
    var d = String(decl || '').toUpperCase();
    if (/INT/.test(d)) return 'integer';
    if (/REAL|FLOA|DOUB|NUM|DEC/.test(d)) return 'real';
    if (/BOOL/.test(d)) return 'boolean';
    if (/DATETIME|TIMESTAMP/.test(d)) return 'datetime';
    if (/DATE/.test(d)) return 'date';
    return 'text';
  }

  /** The 195 result grid, shared by the tabs that show rows. */
  function gridHtml(res, n) {
    var h = '<div class="result-scroll"><table class="grid"><thead><tr><th class="rn">#</th>';
    res.columns.forEach(function (c) { h += '<th>' + esc(c) + '</th>'; });
    h += '</tr></thead><tbody>';
    for (var r = 0; r < n; r += 1) {
      var row = res.rows[r];
      h += '<tr><td class="rn">' + (r + 1) + '</td>';
      for (var c = 0; c < row.length; c += 1) {
        var v = row[c];
        if (v === null || v === undefined) h += '<td class="null">NULL</td>';
        else if (v instanceof Uint8Array) h += '<td class="null">blob ' + v.length + ' bytes</td>';
        else if (typeof v === 'number') h += '<td class="num">' + esc(v) + '</td>';
        else h += '<td title="' + esc(String(v).slice(0, 300)) + '">' + esc(v) + '</td>';
      }
      h += '</tr>';
    }
    return h + '</tbody></table></div>';
  }

  var TEMPLATE =
    '<div class="tab-in">' +
    '<section data-t="empty" class="empty hidden">' +
      '<div class="empty-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg></div>' +
      '<h1>Ask your data anything in SQL.</h1>' +
      '<p class="lede">Browse the tables, write a query and see the rows right below. Errors come back in plain English with the name you probably meant, and nothing can change until you allow it in Settings.</p>' +
      '<div class="cta"><button class="btn primary" type="button" data-act="sample">Load sample data</button>' +
      '<button class="btn" type="button" data-act="load">Load CSV files</button>' +
      '<button class="btn" type="button" data-act="open">Open a saved project</button></div>' +
    '</section>' +
    '<div data-t="bench" class="bench hidden">' +
      '<aside data-t="schema" class="schema" aria-label="Tables">' +
        '<div class="schema-head"><h2 data-t="schemaTitle">Tables</h2><button class="btn icon-btn ghost drawer-only" type="button" data-t="btnCloseDrawer" aria-label="Close tables">' + X + '</button></div>' +
        '<div data-t="schemaBody" class="schema-body"></div>' +
      '</aside>' +
      '<section class="work" aria-label="Query">' +
        '<div class="tools">' +
          '<button data-t="btnTables" class="btn drawer-only" type="button" aria-expanded="false">Tables</button>' +
          '<button data-t="btnRun" class="btn primary" type="button">Run</button>' +
          '<span class="kbd">Ctrl or Cmd + Enter</span>' +
          '<button data-t="btnUndo" class="btn hidden" type="button">Undo</button>' +
          '<span class="spacer"></span>' +
          '<button data-t="btnSave" class="btn" type="button">Save</button>' +
          '<button data-t="btnLib" class="btn" type="button">History</button>' +
        '</div>' +
        '<div data-t="changesBar" class="changes-bar hidden" role="status">' +
          '<div class="msg"><strong>Changes allowed.</strong> INSERT, UPDATE, DELETE and CREATE now run against this project and save on this device.</div>' +
          '<button data-t="btnChangesOff" class="btn small" type="button">Turn off</button>' +
        '</div>' +
        '<textarea data-t="editor" class="editor" rows="8" aria-label="SQL editor" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="SELECT * FROM students LIMIT 20"></textarea>' +
        '<div data-t="result" class="result" aria-live="polite">' +
          '<div class="result-head"><div data-t="status" class="status">No results yet</div>' +
            '<button data-t="btnChart" class="btn small" type="button" disabled>Chart this</button>' +
            '<button data-t="btnReport" class="btn small" type="button" disabled>Add to report</button>' +
            '<button data-t="btnCsv" class="btn small" type="button" disabled>Export CSV</button></div>' +
          '<div data-t="resultBody"><div class="result-empty">Write a query and press Run, or tap 100 rows beside any table.</div></div>' +
        '</div>' +
      '</section>' +
    '</div>' +
    '</div>' +
    '<div data-t="drawerScrim" class="dscrim hidden"></div>' +
    '<div data-t="libScrim" class="scrim hidden" role="dialog" aria-modal="true" aria-label="Queries">' +
      '<div class="sheet"><div class="sheet-head"><h2>Queries</h2><button class="btn icon-btn ghost" type="button" data-close="libScrim" aria-label="Close">' + X + '</button></div>' +
      '<div class="sheet-body"><div class="seg" role="group" aria-label="Show">' +
        '<button type="button" data-lib="history" aria-pressed="true">History</button><button type="button" data-lib="saved" aria-pressed="false">Saved</button></div>' +
        '<div data-t="histList" class="qlist"></div><div data-t="savedList" class="qlist hidden"></div></div></div>' +
    '</div>' +
    '<div data-t="saveScrim" class="scrim hidden" role="dialog" aria-modal="true" aria-label="Save query">' +
      '<div class="sheet"><div class="sheet-head"><h2 data-t="saveTitle">Save query</h2><button class="btn icon-btn ghost" type="button" data-close="saveScrim" aria-label="Close">' + X + '</button></div>' +
      '<div class="sheet-body">' +
        '<div class="field"><label data-t="qNameLabel">Name</label><input data-t="qName" type="text" maxlength="80" autocomplete="off"></div>' +
        '<div class="field"><label data-t="qNoteLabel">Note (optional)</label><textarea data-t="qNote" maxlength="500"></textarea></div>' +
        '<p data-t="saveHint" class="muted"></p>' +
        '<div class="sheet-row"><button data-t="btnSaveGo" class="btn primary" type="button">Save</button></div>' +
      '</div></div>' +
    '</div>';

  QDeskTabs.query = {
    title: 'Query',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>',
    gridHtml: gridHtml,
    mount: function (root, ctx) {
      root.innerHTML = TEMPLATE;
      var $ = function (name) { return root.querySelector('[data-t="' + name + '"]'); };
      var suffix = Math.random().toString(36).slice(2, 8);
      $('qName').id = 'qd-qname-' + suffix; $('qNameLabel').setAttribute('for', $('qName').id);
      $('qNote').id = 'qd-qnote-' + suffix; $('qNoteLabel').setAttribute('for', $('qNote').id);

      var S = { p: null, caret: null, result: null, shown: PAGE_ROWS, loaded: null, open: {}, lib: 'history', active: false, dirty: true, undo: null, saveFor: 'save' };
      var listeners = [];
      function on(el, ev, fn, o) { el.addEventListener(ev, fn, o); listeners.push([el, ev, fn, o]); }

      /* ================================================================ drafts */

      function saveDraft() { if (S.p) lsSet(LS_DRAFT + S.p.name, $('editor').value); }
      function loadDraft() { $('editor').value = S.p ? lsGet(LS_DRAFT + S.p.name, '') : ''; S.caret = null; }

      /* ================================================================ schema */

      function colsOf(name, schemaRow) {
        if (schemaRow) return schemaRow.columns.map(function (c) { return { name: c.name, type: c.inferredType || affinityType(c.type), pk: c.pk }; });
        try { return S.p.objects('PRAGMA table_info(' + QD.quoteIdent(name) + ')').map(function (c) { return { name: c.name, type: affinityType(c.type), pk: c.pk }; }); }
        catch (e) { return []; }
      }

      function rowHtml(name, kind, count, cols) {
        var open = !!S.open[name], h = '<div class="trow" data-tbl="' + esc(name) + '"><div class="trow-top">';
        h += '<button class="chev" type="button" data-chev="' + esc(name) + '" aria-expanded="' + open + '" aria-label="Columns of ' + esc(name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>';
        h += '<button class="tins" type="button" data-ins="' + esc(QD.quoteIdent(name)) + '" title="Insert ' + esc(name) + '"><b>' + esc(name) + '</b><span>' + (kind === 'view' ? 'view' : count.toLocaleString()) + '</span></button>';
        h += '<button class="peek" type="button" data-peek="' + esc(name) + '">100 rows</button></div>';
        if (open) {
          h += '<div class="tcols">';
          cols.forEach(function (c) {
            h += '<button class="cins" type="button" data-ins="' + esc(QD.quoteIdent(c.name)) + '"><b>' + esc(c.name) + '</b>' +
              (c.pk ? '<span class="pkmark">key</span>' : '') + '<span class="tchip t-' + c.type + '">' + esc(TYPE_LABEL[c.type] || c.type) + '</span></button>';
          });
          if (!cols.length) h += '<span class="muted">No columns</span>';
          h += '</div>';
        }
        return h + '</div>';
      }

      function renderSchema() {
        var body = $('schemaBody');
        if (!S.p) { body.innerHTML = ''; return; }
        var tables = S.p.schema(), views = S.p.userViews(), h = '';
        tables.forEach(function (t) { h += rowHtml(t.name, 'table', t.rowCount, colsOf(t.name, t)); });
        if (views.length) {
          h += '<h3>Views</h3>';
          views.forEach(function (v) { h += rowHtml(v, 'view', 0, S.open[v] ? colsOf(v) : []); });
        }
        if (!tables.length && !views.length) h = '<p class="muted" style="padding:0.5rem">This project has no tables yet.</p>';
        body.innerHTML = h;
        $('schemaTitle').textContent = plural(tables.length, 'table') + (views.length ? DOT + plural(views.length, 'view') : '');
      }

      function insertAtCaret(text) {
        var ed = $('editor'), v = ed.value, c = S.caret;
        var start = c ? Math.min(c.start, v.length) : v.length, end = c ? Math.min(c.end, v.length) : v.length;
        var before = v.slice(0, start), after = v.slice(end);
        var pad = before && !/[\s(,.]$/.test(before) ? ' ' : '';
        var ins = pad + text;
        ed.value = before + ins + after;
        var pos = start + ins.length;
        S.caret = { start: pos, end: pos };
        saveDraft();
        if (ctx.wide()) { ed.focus(); ed.setSelectionRange(pos, pos); }
        else ctx.toast('Inserted ' + text);
      }
      function rememberCaret() { var ed = $('editor'); S.caret = { start: ed.selectionStart, end: ed.selectionEnd }; }

      function setDrawer(on) {
        root.classList[on ? 'add' : 'remove']('drawer-open');
        show($('drawerScrim'), on && !ctx.wide());
        $('btnTables').setAttribute('aria-expanded', String(on));
        if (on) { var b = $('btnCloseDrawer'); if (b) b.focus({ preventScroll: true }); }
      }

      function peek(name) {
        try {
          var res = S.p.query('SELECT * FROM ' + QD.quoteIdent(name) + ' LIMIT 100', { history: false });
          S.result = { kind: 'rows', res: res, label: 'Preview of ' + name, sql: 'SELECT * FROM ' + QD.quoteIdent(name) + ' LIMIT 100' };
        } catch (e) { S.result = { kind: 'error', message: e.message }; }
        S.shown = PAGE_ROWS;
        renderResult();
        if (!ctx.wide()) setDrawer(false);
      }

      /* =================================================================== run */

      function editorSql() {
        var ed = $('editor'), a = ed.selectionStart, b = ed.selectionEnd;
        if (b > a && ed.value.slice(a, b).trim()) return ed.value.slice(a, b);
        return ed.value;
      }

      function runEditor() {
        var p = S.p;
        if (!p) return;
        var sql = editorSql();
        if (!sql.trim()) { ctx.toast('Write a query first.'); return; }
        saveDraft();
        var guard = QD.checkReadOnly(sql);
        if (guard.ok) {
          try { S.result = { kind: 'rows', res: p.query(sql), sql: sql }; }
          catch (e) { S.result = { kind: e.kind === 'guard' ? 'guard' : 'error', message: e.message, offer: false }; }
        } else if (!ctx.changes()) {
          p._log(sql, 0, 0, false, guard.reason);
          S.result = { kind: 'guard', message: guard.reason, offer: /^(Only SELECT|This statement contains)/.test(guard.reason) };
        } else {
          var t0 = QD._clock();
          try {
            var last = p.execute(sql, { history: false });
            var changed = p.db.getRowsModified(), ms = QD._clock() - t0;
            p._log(sql, ms, last ? last.rowCount : changed, true, null);
            S.result = last ? { kind: 'rows', res: last, sql: null } : { kind: 'done', changed: changed, ms: ms };
          } catch (e) {
            p._log(sql, QD._clock() - t0, 0, false, e.raw || e.message);
            S.result = { kind: e.kind === 'guard' ? 'guard' : 'error', message: e.message };
          }
        }
        S.shown = PAGE_ROWS;
        renderResult();
      }

      /* ================================================================ result */

      function renderResult() {
        var R = S.result, status = $('status'), body = $('resultBody');
        var rows = !!(R && R.kind === 'rows' && R.res.columns.length);
        $('btnCsv').disabled = !rows;
        $('btnChart').disabled = !(rows && R.sql);
        $('btnReport').disabled = !(rows && R.sql);
        if (!R) {
          status.textContent = 'No results yet';
          body.innerHTML = '<div class="result-empty">Write a query and press Run, or tap 100 rows beside any table.</div>';
          return;
        }
        if (R.kind === 'error' || R.kind === 'guard') {
          status.innerHTML = R.kind === 'guard' ? '<b>Not run</b>' : '<b>Error</b>';
          var h = '<div class="errcard' + (R.kind === 'guard' ? ' guard' : '') + '"><div><strong>' + (R.kind === 'guard' ? 'Read only' : 'The query did not run') + '</strong><p>' + esc(R.message) + '</p></div>';
          if (R.offer) h += '<div><button class="btn small primary" type="button" data-allow="1">Allow changes</button></div>';
          body.innerHTML = h + '</div>';
          return;
        }
        if (R.kind === 'done') {
          status.innerHTML = '<b>Done</b>' + DOT + esc(fmtMs(R.ms));
          body.innerHTML = '<div class="donecard">Done. ' + esc(plural(R.changed, 'row')) + ' changed.</div>';
          return;
        }
        var res = R.res, n = Math.min(S.shown, res.rows.length);
        var s = (R.label ? esc(R.label) + DOT : '') + '<b>' + esc(plural(res.rowCount, 'row')) + '</b>' + DOT + esc(fmtMs(res.ms || 0));
        if (res.truncated) s += DOT + '<span class="cut">First ' + QD.LIMITS.resultRows.toLocaleString() + ' rows only</span>';
        if (n < res.rows.length) s += DOT + 'showing ' + n.toLocaleString();
        status.innerHTML = s;
        if (!res.columns.length) { body.innerHTML = '<div class="result-empty">The statement ran and returned no columns.</div>'; return; }
        var html = gridHtml(res, n);
        if (!res.rows.length) html += '<div class="result-empty">No rows matched.</div>';
        if (n < res.rows.length) html += '<div class="more-row"><button data-t="btnMore" class="btn small" type="button">Show ' + Math.min(PAGE_ROWS, res.rows.length - n) + ' more</button></div>';
        body.innerHTML = html;
      }

      function exportCsv() {
        var R = S.result;
        if (!R || R.kind !== 'rows' || !S.p) return;
        var d = new Date();
        function p2(x) { return (x < 10 ? '0' : '') + x; }
        var stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes());
        var name = QD.fileName(S.p).replace(/\.sqlite$/, '') + '-' + stamp + '.csv';
        QD.download(QD.toCSV(R.res), name, 'text/csv');
        ctx.toast('Exported ' + plural(R.res.rowCount, 'row') + ' to ' + name);
      }

      /** The saved query that matches the SQL just run, if the person loaded one and did not change it. */
      function loadedFor(sql) {
        if (!S.loaded || !S.p) return null;
        var q = S.p.getQuery(S.loaded.id);
        return q && q.sql === sql ? q : null;
      }

      function chartThis() {
        var R = S.result;
        if (!R || !R.sql) return;
        var q = loadedFor(R.sql);
        ctx.goTo('chart', { sql: R.sql, title: q ? q.name : '', queryId: q ? q.id : null });
      }

      function addToReport() {
        var R = S.result;
        if (!R || !R.sql || !S.p) return;
        var q = loadedFor(R.sql);
        if (q) { ctx.report.add({ kind: 'query', refId: q.id }); return; }
        openSaveSheet('report');
      }

      /* ======================================================== saved, history */

      function openSaveSheet(mode) {
        S.saveFor = mode || 'save';
        var sql = S.saveFor === 'report' && S.result && S.result.sql ? S.result.sql : $('editor').value;
        if (!sql.trim()) { ctx.toast('Write a query first.'); return; }
        var q = S.saveFor === 'save' && S.loaded ? S.p.getQuery(S.loaded.id) : null;
        $('saveTitle').textContent = S.saveFor === 'report' ? 'Name it for the report' : 'Save query';
        $('btnSaveGo').textContent = S.saveFor === 'report' ? 'Save and add' : 'Save';
        $('qName').value = q ? q.name : '';
        $('qNote').value = q ? (q.note || '') : '';
        $('saveHint').textContent = S.saveFor === 'report' ? 'The query is saved under this name so the report can run it again whenever you export.' :
          (q ? 'Keep the name ' + q.name + ' to update it, or change the name to save a new query.' : 'Saved queries live in the project file and travel with it.');
        openSheet('saveScrim');
        if (ctx.wide()) $('qName').focus();
      }

      function saveCurrent() {
        var name = $('qName').value.trim() || 'Untitled query', note = $('qNote').value.trim(), id;
        if (S.saveFor === 'report') {
          var sqlR = S.result && S.result.sql ? S.result.sql : $('editor').value;
          id = S.p.saveQuery({ name: name, sql: sqlR, note: note, origin: 'manual' });
          S.loaded = { id: id, name: name };
          closeSheet('saveScrim');
          ctx.report.add({ kind: 'query', refId: id });
          return;
        }
        var sql = $('editor').value, q = S.loaded ? S.p.getQuery(S.loaded.id) : null;
        if (q && q.name === name) id = S.p.saveQuery({ id: q.id, name: name, sql: sql, note: note, pinned: !!q.pinned });
        else id = S.p.saveQuery({ name: name, sql: sql, note: note, origin: 'manual' });
        S.loaded = { id: id, name: name };
        closeSheet('saveScrim');
        ctx.toast((q && q.name === name ? 'Updated ' : 'Saved ') + name);
      }

      function loadSql(sql, fromSaved) {
        $('editor').value = sql;
        S.loaded = fromSaved || null;
        S.caret = null;
        saveDraft();
        closeSheet('libScrim');
        if (ctx.wide()) $('editor').focus();
      }

      function renderHistory() {
        var list = S.p ? S.p.history(50) : [];
        if (!list.length) { $('histList').innerHTML = '<p class="muted">Nothing has run in this project yet.</p>'; return; }
        $('histList').innerHTML = list.map(function (h) {
          var meta = fmtTime(h.ran_at) + DOT + (h.ok ? plural(h.row_count, 'row') + DOT + fmtMs(h.ms || 0) : 'Error: ' + (h.error || 'failed'));
          return '<div class="qitem"><button class="load" type="button" data-hist="' + h.id + '"><code>' + esc(h.sql) + '</code>' +
            '<span class="meta' + (h.ok ? '' : ' bad') + '">' + esc(meta) + '</span></button></div>';
        }).join('');
      }

      function renderSaved() {
        var list = S.p ? S.p.queries() : [];
        if (!list.length) { $('savedList').innerHTML = '<p class="muted">No saved queries yet. Write one and tap Save.</p>'; return; }
        $('savedList').innerHTML = list.map(function (q) {
          return '<div class="qitem"><button class="load" type="button" data-qload="' + q.id + '"><b>' + esc(q.name) + '</b>' +
            (q.question ? '<span class="meta">Asked: ' + esc(q.question) + '</span>' : (q.note ? '<span class="meta">' + esc(q.note) + '</span>' : '')) + '<code>' + esc(q.sql) + '</code></button>' +
            '<div class="acts"><button class="btn small" type="button" data-pin="' + q.id + '" aria-pressed="' + (q.pinned ? 'true' : 'false') + '">' + (q.pinned ? 'Pinned' : 'Pin') + '</button>' +
            '<button class="btn small" type="button" data-qask="' + q.id + '">Ask to explain</button>' +
            '<button class="btn small" type="button" data-qreport="' + q.id + '">Add to report</button>' +
            '<button class="btn small danger" type="button" data-qdel="' + q.id + '">Delete</button></div></div>';
        }).join('');
      }

      function setLib(tab) {
        S.lib = tab;
        Array.prototype.forEach.call(root.querySelectorAll('[data-lib]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lib') === tab)); });
        show($('histList'), tab === 'history'); show($('savedList'), tab === 'saved');
        if (tab === 'history') renderHistory(); else renderSaved();
      }

      /* =============================================================== changes */

      function renderChanges() {
        var on = ctx.changes();
        show($('changesBar'), on);
        root.classList[on ? 'add' : 'remove']('changes-on');
      }

      /* ================================================================ sheets */

      var SHEETS = ['libScrim', 'saveScrim'];
      function openSheet(id) {
        if (id === 'libScrim') setLib(S.lib);
        show($(id), true);
        var b = $(id).querySelector('[data-close]'); if (b && id !== 'saveScrim') b.focus({ preventScroll: true });
      }
      function closeSheet(id) { show($(id), false); }

      /* ================================================================ render */

      function render() {
        S.dirty = false;
        var has = !!(S.p && (S.p.userTables().length > 0 || S.p.userViews().length > 0));
        show($('empty'), !has);
        show($('bench'), has);
        if (has) renderSchema(); else setDrawer(false);
        renderChanges();
        renderResult();
      }

      /* ================================================================ events */

      var ed = $('editor');
      on(ed, 'blur', rememberCaret);
      on(ed, 'keyup', rememberCaret);
      on(ed, 'input', function () { saveDraft(); if (S.undo !== null) { S.undo = null; show($('btnUndo'), false); } });
      on(ed, 'keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runEditor(); } });
      on($('qName'), 'keydown', function (e) { if (e.key === 'Enter') saveCurrent(); });
      on($('drawerScrim'), 'click', function () { setDrawer(false); });

      on(root, 'click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) { if (e.target.classList && e.target.classList.contains('scrim')) { var sid = e.target.getAttribute('data-t'); if (SHEETS.indexOf(sid) >= 0) closeSheet(sid); } return; }
        var a, t = b.getAttribute('data-t');
        if (t === 'btnRun') runEditor();
        else if (t === 'btnSave') openSaveSheet('save');
        else if (t === 'btnSaveGo') saveCurrent();
        else if (t === 'btnLib') openSheet('libScrim');
        else if (t === 'btnCsv') exportCsv();
        else if (t === 'btnChart') chartThis();
        else if (t === 'btnReport') addToReport();
        else if (t === 'btnChangesOff') ctx.setChanges(false);
        else if (t === 'btnTables') setDrawer(!root.classList.contains('drawer-open'));
        else if (t === 'btnCloseDrawer') setDrawer(false);
        else if (t === 'btnMore') { S.shown += PAGE_ROWS; renderResult(); }
        else if (t === 'btnUndo') {
          if (S.undo !== null) { $('editor').value = S.undo.text; S.loaded = S.undo.loaded; S.undo = null; saveDraft(); show($('btnUndo'), false); }
        }
        else if ((a = b.getAttribute('data-act'))) {
          if (a === 'sample') ctx.loadSample();
          else if (a === 'open') ctx.openProjects();
          else if (a === 'load') ctx.goTo('load');
        }
        else if ((a = b.getAttribute('data-close'))) closeSheet(a);
        else if ((a = b.getAttribute('data-ins'))) insertAtCaret(a);
        else if ((a = b.getAttribute('data-chev'))) { S.open[a] = !S.open[a]; renderSchema(); }
        else if ((a = b.getAttribute('data-peek'))) peek(a);
        else if (b.getAttribute('data-allow')) ctx.setChanges(true);
        else if ((a = b.getAttribute('data-lib'))) setLib(a);
        else if ((a = b.getAttribute('data-hist'))) {
          var h = S.p.objects('SELECT sql FROM _qd_history WHERE id = ?', [+a])[0];
          if (h) loadSql(h.sql, null);
        }
        else if ((a = b.getAttribute('data-qload'))) {
          var q = S.p.getQuery(+a);
          if (q) { loadSql(q.sql, { id: q.id, name: q.name }); ctx.toast('Loaded ' + q.name); }
        }
        else if ((a = b.getAttribute('data-qask'))) {
          var qa = S.p.getQuery(+a);
          if (qa) { closeSheet('libScrim'); ctx.goTo('ask', { showSaved: qa }); }
        }
        else if ((a = b.getAttribute('data-qreport'))) { closeSheet('libScrim'); ctx.report.add({ kind: 'query', refId: +a }); }
        else if ((a = b.getAttribute('data-pin'))) {
          var qp = S.p.getQuery(+a);
          if (qp) S.p.saveQuery({ id: qp.id, name: qp.name, sql: qp.sql, note: qp.note, pinned: !qp.pinned });
          renderSaved();
        }
        else if ((a = b.getAttribute('data-qdel'))) {
          if (b.getAttribute('data-armed') !== '1') { b.setAttribute('data-armed', '1'); b.textContent = 'Tap again'; return; }
          S.p.deleteQuery(+a);
          if (S.loaded && S.loaded.id === +a) S.loaded = null;
          renderSaved(); ctx.toast('Deleted the saved query and anything in the report or board that used it');
        }
      });

      on(document, 'keydown', function (e) {
        if (e.key !== 'Escape' || !S.active) return;
        var openOne = SHEETS.filter(function (id) { return !$(id).classList.contains('hidden'); });
        if (openOne.length) openOne.forEach(closeSheet);
        else if (root.classList.contains('drawer-open')) setDrawer(false);
      });
      var mq = window.matchMedia('(min-width: 720px)'), mqFn = function () { setDrawer(false); };
      if (mq.addEventListener) { mq.addEventListener('change', mqFn); listeners.push([mq, 'change', mqFn]); }
      on(window, 'pagehide', saveDraft);

      /* ======================================================== the component */

      function useProject(p) {
        if (S.p && S.p !== p) saveDraft();
        S.p = p;
        S.result = null; S.loaded = null; S.open = {}; S.undo = null;
        show($('btnUndo'), false);
        loadDraft();
        S.dirty = true;
        if (S.active) render();
      }
      useProject(ctx.project());

      return {
        activate: function (payload) {
          S.active = true;
          if (S.p !== ctx.project()) useProject(ctx.project());
          if (S.dirty) render(); else renderChanges();
          if (payload && typeof payload.sql === 'string' && S.p) {
            var prev = $('editor').value;
            if (prev !== payload.sql) {
              S.undo = { text: prev, loaded: S.loaded };
              show($('btnUndo'), !!prev.trim());
            }
            $('editor').value = payload.sql;
            S.loaded = payload.queryId ? { id: payload.queryId, name: payload.title || '' } : null;
            S.caret = null;
            saveDraft();
            if (payload.run) runEditor();
          }
        },
        deactivate: function () { S.active = false; saveDraft(); setDrawer(false); },
        projectChanged: function (p) { useProject(p); },
        stale: function (kinds) {
          if (kinds.indexOf('changes') >= 0 && kinds.length === 1) { renderChanges(); return; }
          S.dirty = true;
          if (S.active) render();
        },
        unmount: function () {
          saveDraft();
          listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
          root.innerHTML = '';
        },
        run: runEditor,
        state: S
      };
    }
  };
})();
