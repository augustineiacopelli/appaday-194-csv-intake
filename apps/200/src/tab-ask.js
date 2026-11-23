/* Ask tab. The first part is the Plain Ask component from AppADay 197, copied unchanged. */
/* Plain Ask, AppADay 197. All of the Ask interface lives in window.PlainAsk so Day 200 can mount it in its own shell:
 *   PlainAsk.mount(root, getProject, hooks)
 * hooks (all optional): save(draft), openSettings(), openBench(sql), toast(message).
 * Every query below is scoped to root. PlainAsk.actions is the list the answer card builds its action row from. */
(function () {
  'use strict';
  var LS_SAMPLES = 'plainask-samples';
  var PAGE_ROWS = 200;
  var DOT = ' \u00b7 ';

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function plural(n, one, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fmtMs(ms) { return ms < 10 ? (Math.round(ms * 10) / 10) + ' ms' : Math.round(ms).toLocaleString() + ' ms'; }
  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn();
  }

  var PA = {
    state: { project: null, answer: null, sampleRows: lsGet(LS_SAMPLES, '3') === '0' ? 0 : 3 },
    actions: []
  };
  var R = null; /* the mounted view: { root, getProject, hooks, timer, ... } */

  function q(sel) { return R ? R.root.querySelector(sel) : null; }
  function role(name) { return q('[data-pa="' + name + '"]'); }
  function project() { return R && R.getProject ? R.getProject() : null; }
  function hook(name) { return R && R.hooks && typeof R.hooks[name] === 'function' ? R.hooks[name] : null; }
  function say(msg) { var h = hook('toast'); if (h) h(msg); }

  /* ================================================================= mount */

  function mount(root, getProject, hooks) {
    if (R && R.onKey) window.removeEventListener('appaday:keychange', R.onKey);
    R = { root: root, getProject: getProject, hooks: hooks || {}, timer: null, debounce: null, busy: false, res: null, shown: PAGE_ROWS };
    root.innerHTML =
      '<div class="pa">' +
        '<label class="pa-label"><span>Your question</span>' +
          '<textarea class="pa-q" data-pa="q" rows="3" maxlength="2000" autocapitalize="sentences" spellcheck="true" placeholder="For example: How many students are there?"></textarea></label>' +
        '<div class="pa-starters" data-pa="starters"></div>' +
        '<div class="pa-go"><button class="btn primary" type="button" data-pa="ask">Ask</button><span class="pa-key" data-pa="key" aria-live="polite"></span></div>' +
        '<details class="pa-send" data-pa="send"><summary>What will be sent</summary><div class="pa-send-body">' +
          '<div class="seg send-seg" role="group" aria-label="Sample rows to send">' +
            '<button type="button" data-pa-samples="3" aria-pressed="true">Three sample rows</button>' +
            '<button type="button" data-pa-samples="0" aria-pressed="false">None</button></div>' +
          '<pre class="pa-pre" data-pa="sendbox"></pre></div></details>' +
        '<div class="pa-answer" data-pa="answer" aria-live="polite"></div>' +
      '</div>';
    root.addEventListener('click', onClick);
    role('q').addEventListener('input', scheduleSend);
    role('send').addEventListener('toggle', function () { if (role('send').open) rebuildSend(); });
    R.onKey = function () { renderKeyLine(); };
    window.addEventListener('appaday:keychange', R.onKey);
    renderSeg();
    whenReady(renderKeyLine);
    refresh();
    return PA;
  }

  /** Call whenever the project changes. The last answer belongs to one project, so it is dropped on a switch. */
  function refresh() {
    if (!R) return;
    var p = project();
    if (PA.state.project !== p) { PA.state.project = p; PA.state.answer = null; R.res = null; role('answer').innerHTML = ''; }
    renderStarters();
    rebuildSend();
  }

  /* ============================================================ the question */

  function renderStarters() {
    var p = project(), list = [], box = role('starters');
    try { list = p && p.userTables().length ? window.QDAsk.starters(p) : []; } catch (e) { list = []; }
    box.innerHTML = list.map(function (s) { return '<button class="chip" type="button" data-pa-chip="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
  }

  function renderKeyLine() {
    var el = role('key');
    if (!el) return;
    var K = window.AppKeys;
    if (!K || typeof K.has !== 'function') el.textContent = 'The key manager did not load. Check the connection and reload.';
    else el.textContent = K.has() ? 'A Claude key is saved on this device.' : 'No Claude key is saved yet. You will be asked for one when you tap Ask.';
  }

  function renderSeg() {
    Array.prototype.forEach.call(R.root.querySelectorAll('[data-pa-samples]'), function (b) {
      b.setAttribute('aria-pressed', String(+b.getAttribute('data-pa-samples') === PA.state.sampleRows));
    });
  }

  function setSampleRows(n) {
    PA.state.sampleRows = +n === 0 ? 0 : 3;
    lsSet(LS_SAMPLES, String(PA.state.sampleRows));
    if (R) { renderSeg(); scheduleSend(); }
  }

  function currentMessage() {
    var p = project();
    if (!p) return '';
    return window.QDAsk.buildMessage(p, role('q').value, { sampleRows: PA.state.sampleRows });
  }
  function rebuildSend() {
    if (!R) return;
    if (R.debounce) { clearTimeout(R.debounce); R.debounce = null; }
    if (!role('send').open) return;
    role('sendbox').textContent = currentMessage();
  }
  function scheduleSend() {
    if (!R) return;
    if (R.debounce) clearTimeout(R.debounce);
    if (!role('send').open) return;
    R.debounce = setTimeout(rebuildSend, 300);
  }

  /* ==================================================================== ask */

  function setBusy(on) {
    var b = role('ask');
    R.busy = on;
    if (R.timer) { clearInterval(R.timer); R.timer = null; }
    b.disabled = on;
    if (!on) { b.textContent = 'Ask'; return; }
    var t0 = Date.now();
    b.textContent = 'Asking 0s';
    R.timer = setInterval(function () { b.textContent = 'Asking ' + Math.floor((Date.now() - t0) / 1000) + 's'; }, 1000);
  }

  function ask() {
    var p = project();
    if (!p || R.busy) return;
    var question = role('q').value.trim(), view = R;
    setBusy(true);
    window.QDAsk.ask(p, question, { sampleRows: PA.state.sampleRows }).then(function (a) {
      if (R !== view || project() !== p) return;
      PA.state.answer = { a: a, question: question };
      renderAnswer();
    }, function (e) {
      if (R !== view || project() !== p) return;
      PA.state.answer = { error: (e && e.message) || 'Something went wrong. Try again.', question: question };
      renderAnswer();
    }).then(function () { if (R === view) { setBusy(false); renderKeyLine(); } });
  }

  /* ================================================================= answer */

  function sqlBlock(sql, open) {
    return '<details class="pa-sql"' + (open ? ' open' : '') + ' data-pa="sqlbox"><summary>The SQL</summary><div class="pa-sql-body">' +
      '<label class="sr" for="paSql">SQL</label>' +
      '<textarea id="paSql" class="editor" data-pa="sql" rows="6" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">' + esc(sql) + '</textarea>' +
      '<div class="sheet-row"><button class="btn small" type="button" data-pa-run="1">Run again</button></div></div></details>';
  }

  function actionsHtml(ctx) {
    var h = '';
    PA.actions.forEach(function (a) {
      if (a.when && !a.when(ctx)) return;
      h += '<button class="btn' + (a.primary ? ' primary' : '') + '" type="button" data-pa-action="' + esc(a.id) + '">' + esc(a.label) + '</button>';
    });
    return h;
  }

  function makeCtx() {
    var A = PA.state.answer || {};
    return {
      root: R.root, project: project(), question: A.question || '', answer: A.a || null, hooks: R.hooks,
      sql: function () { var el = role('sql'); return el ? el.value : ((A.a && A.a.sql) || ''); },
      panel: function (html) { var el = role('panel'); if (el) el.innerHTML = html; },
      toast: say,
      draft: function () {
        var note = (A.a && A.a.explanation) || '';
        return { name: (A.question || 'Question').slice(0, 80), note: note.slice(0, 500), sql: this.sql(), question: A.question || '' };
      }
    };
  }

  function renderAnswer() {
    var box = role('answer'), A = PA.state.answer, h = '';
    R.res = null; R.shown = PAGE_ROWS;
    if (!A) { box.innerHTML = ''; return; }
    if (A.error) {
      box.innerHTML = '<div class="pa-card bad"><div><strong>That did not go through</strong><p>' + esc(A.error) + '</p></div></div>';
      return;
    }
    var a = A.a;
    if (a.status === 'ok') {
      R.res = { kind: 'rows', res: a.result };
      h += '<div class="pa-card ok">';
      if (a.explanation) h += '<p class="pa-expl">' + esc(a.explanation) + '</p>';
      if (a.assumptions && a.assumptions.length) {
        h += '<div><p class="pa-assume-h">Assumptions</p><ul class="pa-assume" data-pa="assume">' + a.assumptions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
      }
      if (a.repaired) h += '<p class="pa-repaired" data-pa="repaired"><strong>Repaired.</strong> The first query would not run, so Claude corrected it once. The query below is the corrected one.</p>';
      h += sqlBlock(a.sql, false);
      h += '<div class="pa-actions" data-pa="actions">' + actionsHtml(makeCtx()) + '</div>';
      h += '<div class="pa-panel" data-pa="panel"></div>';
      h += '<div class="result" data-pa="resultbox"></div>';
      h += '</div>';
    } else if (a.status === 'cannot') {
      h = '<div class="pa-card calm" data-pa="cannot"><div><strong>This data cannot answer that</strong><p>' + esc(a.reason) + '</p></div></div>';
    } else if (a.status === 'failed') {
      h = '<div class="pa-card bad" data-pa="failed"><div><strong>The query would not run</strong><p>' + esc(a.reason) + '</p></div>';
      if (a.explanation) h += '<p>' + esc(a.explanation) + '</p>';
      if (a.sql) h += sqlBlock(a.sql, true) + '<div class="result" data-pa="resultbox"></div>';
      h += '</div>';
    } else if (a.status === 'declined') {
      h = '<div class="pa-card calm" data-pa="declined"><p>Plain Ask needs a Claude API key to turn a question into a query. Add one in Settings, then ask again. Nothing was sent.</p>' +
        '<div><button class="btn primary" type="button" data-pa-settings="1">Open Settings</button></div></div>';
    }
    box.innerHTML = h;
    renderResultBox();
  }

  /* ================================================================= result */

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

  function renderResultBox() {
    var box = role('resultbox'), X = R.res;
    if (!box) return;
    if (!X) { box.innerHTML = ''; return; }
    var head = function (s) { return '<div class="result-head"><div class="status" data-pa="status">' + s + '</div></div>'; };
    if (X.kind === 'error' || X.kind === 'guard') {
      box.innerHTML = head(X.kind === 'guard' ? '<b>Not run</b>' : '<b>Error</b>') +
        '<div class="errcard' + (X.kind === 'guard' ? ' guard' : '') + '"><div><strong>' + (X.kind === 'guard' ? 'Read only' : 'The query did not run') + '</strong><p>' + esc(X.message) + '</p></div></div>';
      return;
    }
    var res = X.res, n = Math.min(R.shown, res.rows.length);
    var s = '<b>' + esc(plural(res.rowCount, 'row')) + '</b>' + DOT + esc(fmtMs(res.ms || 0));
    if (res.truncated) s += DOT + '<span class="cut">First ' + window.QD.LIMITS.resultRows.toLocaleString() + ' rows only</span>';
    if (n < res.rows.length) s += DOT + 'showing ' + n.toLocaleString();
    var html = head(s);
    if (!res.columns.length) html += '<div class="result-empty">The statement ran and returned no columns.</div>';
    else {
      html += gridHtml(res, n);
      if (!res.rows.length) html += '<div class="result-empty">No rows matched.</div>';
      if (n < res.rows.length) html += '<div class="more-row"><button class="btn small" type="button" data-pa-more="1">Show ' + Math.min(PAGE_ROWS, res.rows.length - n) + ' more</button></div>';
    }
    box.innerHTML = html;
  }

  /** Run the edited SQL directly. This never asks Claude again. */
  function runAgain() {
    var p = project(), el = role('sql');
    if (!p || !el) return;
    try { R.res = { kind: 'rows', res: p.query(el.value) }; }
    catch (e) { R.res = { kind: e.kind === 'guard' ? 'guard' : 'error', message: e.message }; }
    R.shown = PAGE_ROWS;
    renderResultBox();
  }

  /* ============================================================== actions */

  function directSave(c) {
    var d = c.draft();
    c.project.saveQuery({ name: d.name, sql: d.sql, note: d.note, origin: 'ask', question: d.question });
    c.toast('Saved ' + d.name);
  }

  function explainAction(c) {
    var sql = c.sql();
    if (!sql.trim()) return;
    c.panel('<p>Reading the query</p>');
    window.QDAsk.explain(c.project, sql).then(function (r) {
      if (r === null) { c.panel('<p>Explaining a query needs a Claude API key. Add one in Settings.</p>'); return; }
      c.panel('<p>' + esc(r.summary) + '</p>' + (r.steps.length ? '<ol>' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : ''));
    }, function (e) { c.panel('<p>' + esc(e.message) + '</p>'); });
  }

  PA.actions = [
    { id: 'save', label: 'Save', run: function (c) { var h = hook('save'); if (h) h(c.draft()); else directSave(c); } },
    { id: 'explain', label: 'Explain this query', run: explainAction },
    { id: 'bench', label: 'Open in Query Bench', primary: true, when: function () { return !!hook('openBench'); }, run: function (c) { hook('openBench')(c.sql()); } }
  ];

  /** Show a saved query as an answer card. It runs the SQL here and never asks Claude. */
  function showSaved(sq) {
    if (!R) return;
    var p = project(), a;
    role('q').value = sq.question || sq.name || '';
    scheduleSend();
    try { a = { status: 'ok', sql: sq.sql, explanation: sq.note || '', assumptions: [], result: p.query(sq.sql), repaired: false }; }
    catch (e) { a = { status: 'failed', sql: sq.sql, reason: e.message, explanation: sq.note || '', assumptions: [] }; }
    PA.state.answer = { a: a, question: sq.question || sq.name || '' };
    renderAnswer();
  }

  /* ================================================================ events */

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b || !R.root.contains(b)) return;
    var a;
    if (b.getAttribute('data-pa') === 'ask') ask();
    else if ((a = b.getAttribute('data-pa-chip')) != null) { var t = role('q'); t.value = a; scheduleSend(); t.focus(); }
    else if ((a = b.getAttribute('data-pa-samples')) != null) setSampleRows(a);
    else if (b.getAttribute('data-pa-run')) runAgain();
    else if (b.getAttribute('data-pa-more')) { R.shown += PAGE_ROWS; renderResultBox(); }
    else if (b.getAttribute('data-pa-settings')) { var h = hook('openSettings'); if (h) h(); }
    else if ((a = b.getAttribute('data-pa-action'))) {
      var act = PA.actions.filter(function (x) { return x.id === a; })[0];
      if (act) { try { act.run(makeCtx()); } catch (err) { say(err.message); } }
    }
  }

  PA.mount = mount;
  PA.refresh = refresh;
  PA.setSampleRows = setSampleRows;
  PA.showSaved = showSaved;
  window.PlainAsk = PA;
})();

/* Ask tab, Day 200: mounts the Plain Ask component above unchanged, then rewrites PlainAsk.actions so an
 * answer can be saved, charted, opened in Query or added to the report in one tap. */
(function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function plural(n, one, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? one : (many || one + 's')); }

  QDeskTabs.ask = {
    title: 'Ask',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    mount: function (root, ctx) {
      root.innerHTML =
        '<div class="tab-in">' +
          '<div class="tab-head"><h1>Ask in plain English</h1><span class="tab-note">Claude writes a read only query. You see what is sent first.</span></div>' +
          '<section data-t="empty" class="empty hidden">' +
            '<div class="empty-art" aria-hidden="true">' + QDeskTabs.ask.icon + '</div>' +
            '<h1>Questions need tables.</h1>' +
            '<p class="lede">Load CSV files or the sample college first. Ask sends only table and column names, your confirmed relationships, up to three sample rows per table and the question.</p>' +
            '<div class="cta"><button class="btn primary" type="button" data-act="sample">Load sample data</button>' +
            '<button class="btn" type="button" data-act="load">Load CSV files</button>' +
            '<button class="btn" type="button" data-act="open">Open a saved project</button></div>' +
          '</section>' +
          '<div data-t="host" class="ask-host"></div>' +
        '</div>';
      var $ = function (name) { return root.querySelector('[data-t="' + name + '"]'); };
      var S = { active: false, dirty: true, saved: null };

      function remember(answer, sql, id) { S.saved = { answer: answer, sql: sql, id: id }; }
      function saveDraft(d, answer) {
        var p = ctx.project();
        var id = p.saveQuery({ name: d.name, sql: d.sql, note: d.note, origin: 'ask', question: d.question });
        remember(answer, d.sql, id);
        return id;
      }
      function savedId(c) {
        var p = ctx.project(), s = S.saved;
        if (s && s.answer === c.answer && s.sql === c.sql() && p && p.getQuery(s.id)) return s.id;
        return null;
      }
      function ensureSaved(c) { return savedId(c) || saveDraft(c.draft(), c.answer); }

      var hooks = {
        save: function (d) {
          var A = window.PlainAsk.state.answer || {};
          saveDraft(d, A.a || null);
          ctx.toast('Saved ' + d.name, { label: 'Open in Query', run: function () { ctx.goTo('query', { sql: d.sql, run: true }); } });
        },
        openSettings: function () { ctx.openSettings('keys'); },
        openBench: function (sql) { ctx.goTo('query', { sql: sql, run: true }); },
        toast: function (m) { ctx.toast(m); }
      };
      window.PlainAsk.mount($('host'), ctx.project, hooks);

      var base = {};
      window.PlainAsk.actions.forEach(function (a) { base[a.id] = a; });
      window.PlainAsk.actions = [
        base.save,
        { id: 'chart', label: 'Chart this', run: function (c) {
          var sql = c.sql(); if (!sql.trim()) return;
          ctx.goTo('chart', { sql: sql, title: c.question, queryId: savedId(c) });
        } },
        { id: 'report', label: 'Add to report', run: function (c) {
          if (!c.sql().trim()) return;
          var id = ensureSaved(c);
          ctx.report.add({ kind: 'query', refId: id });
        } },
        base.explain,
        { id: 'bench', label: 'Open in Query', primary: true, run: function (c) { var sql = c.sql(); if (sql.trim()) ctx.goTo('query', { sql: sql, run: true }); } }
      ];

      /* The line under the question box: how many confirmed relationships Claude will be told about. */
      var line = document.createElement('p');
      line.className = 'ask-links';
      line.setAttribute('data-t', 'links');
      var starters = $('host').querySelector('[data-pa="starters"]');
      starters.parentNode.insertBefore(line, starters.nextSibling);

      function renderLine() {
        var p = ctx.project(), n = p ? p.relations('confirmed').length : 0;
        line.innerHTML = n ? esc(plural(n, 'confirmed relationship')) + ' from Relate go with every question, so joins follow your links.' :
          'No confirmed relationships yet, so Claude has to guess how tables join. <button class="linkbtn" type="button" data-act="relate">Confirm them in Relate</button>';
      }
      function render() {
        S.dirty = false;
        var p = ctx.project(), has = !!(p && p.userTables().length);
        $('empty').classList[has ? 'add' : 'remove']('hidden');
        $('host').classList[has ? 'remove' : 'add']('hidden');
        window.PlainAsk.refresh();
        renderLine();
      }

      root.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-act]') : null;
        if (!b || !root.contains(b)) return;
        var a = b.getAttribute('data-act');
        if (a === 'sample') ctx.loadSample(); else if (a === 'open') ctx.openProjects(); else if (a === 'load') ctx.goTo('load'); else if (a === 'relate') ctx.goTo('relate', { analyze: true });
      });

      return {
        activate: function (payload) {
          S.active = true;
          if (S.dirty) render();
          if (payload && payload.showSaved && ctx.project()) {
            var q = payload.showSaved;
            window.PlainAsk.showSaved(q);
            var A = window.PlainAsk.state.answer;
            if (A && A.a) remember(A.a, q.sql, q.id);
          }
        },
        deactivate: function () { S.active = false; },
        projectChanged: function () { S.saved = null; S.dirty = true; if (S.active) render(); },
        stale: function () { S.dirty = true; if (S.active) render(); },
        unmount: function () { root.innerHTML = ''; },
        state: S
      };
    }
  };
})();
