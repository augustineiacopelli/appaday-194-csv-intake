/* Relate tab, from Key Finder (AppADay 196): analyze keys and relationships, decide on each proposal,
 * add a link by hand, the draggable diagram and the JOIN between any two tables. Day 200 turns the page
 * view switch into List and Diagram inside the tab, opens a JOIN in Query, and says how many confirmed
 * relationships Ask will use. */
(function () {
  'use strict';
  var DOT = ' \u00b7 ';
  var ARROW = ' \u2192 ';
  var BW = 176, HEAD = 32, ROWH = 22, GAPX = 32, GAPY = 40, MARGIN = 24, NAME_MAX = 20;
  var POS_KEY = 'diagram_positions';
  var ANALYZED_KEY = 'keyfinder_analyzed_at';
  var X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function show(el, on) { el.classList[on ? 'remove' : 'add']('hidden'); }
  function plural(n, one, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fmtMs(ms) { return ms < 10 ? (Math.round(ms * 10) / 10) + ' ms' : Math.round(ms).toLocaleString() + ' ms'; }
  function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function relKey(r) { return r.fromTable + '.' + r.fromColumns.join('+') + '>' + r.toTable + '.' + r.toColumns.join('+'); }
  function labelOf(r) {
    if (r.evidence && r.evidence.label) return r.evidence.label;
    var s = r.score == null ? 1 : r.score, T = QDKeys.THRESHOLDS;
    return s >= T.strong ? 'strong' : s >= T.likely ? 'likely' : s >= T.weak ? 'weak' : 'none';
  }
  function isDrawn(r) {
    if (r.status === 'confirmed') return true;
    if (r.status !== 'proposed') return false;
    var l = labelOf(r); return l === 'strong' || l === 'likely';
  }

  var TEMPLATE =
    '<div class="tab-in">' +
    '<section data-t="empty" class="empty hidden">' +
      '<div class="empty-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg></div>' +
      '<h1>See how your tables fit together.</h1>' +
      '<p class="lede">Relate reads every column, works out which column identifies each row and which columns point at another table, and shows you why. Confirm what is right, draw the diagram, and get the JOIN for any two tables.</p>' +
      '<div class="cta"><button class="btn primary" type="button" data-act="sample">Load sample data</button>' +
      '<button class="btn" type="button" data-act="load">Load CSV files</button>' +
      '<button class="btn" type="button" data-act="open">Open a saved project</button></div>' +
    '</section>' +
    '<section data-t="ready" class="empty hidden">' +
      '<div class="empty-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M8 11h6M11 8v6"/></svg></div>' +
      '<h1><span data-t="readyCount" class="ready-count">0 tables</span> ready to analyze.</h1>' +
      '<p class="lede">Analyze profiles every column, then proposes a key for each table and the links between them. Nothing changes in your data, and it takes a second or two.</p>' +
      '<div class="cta"><button data-t="btnAnalyzeReady" class="btn primary" type="button">Analyze</button>' +
      '<button class="btn" type="button" data-act="open">Open a different project</button></div>' +
    '</section>' +
    '<div data-t="finder" class="hidden">' +
      '<div class="ftools">' +
        '<button data-t="btnAnalyze" class="btn primary" type="button">Analyze again</button>' +
        '<div data-t="summary" class="summary"></div>' +
      '</div>' +
      '<div class="viewseg"><div class="seg" role="group" aria-label="Show">' +
        '<button type="button" data-view="list" aria-pressed="true">List</button>' +
        '<button type="button" data-view="diagram" aria-pressed="false">Diagram</button>' +
      '</div></div>' +
      '<div class="fgrid">' +
        '<div class="side">' +
          '<section data-t="paneLinks" class="pane" aria-label="Relationships">' +
            '<div class="pane-head"><h2>Relationships</h2></div>' +
            '<div class="pane-body">' +
              '<div data-t="relLists" class="pane-body" style="padding:0"></div>' +
              '<details data-t="manualBox" class="more manual-box">' +
                '<summary>Add a link by hand</summary>' +
                '<div class="pickers">' +
                  '<label>From table<select data-t="mFromT"></select></label>' +
                  '<label>From column<select data-t="mFromC"></select></label>' +
                  '<label>To table<select data-t="mToT"></select></label>' +
                  '<label>To column<select data-t="mToC"></select></label>' +
                '</div>' +
                '<p data-t="mPreview" class="mpreview" aria-live="polite"></p>' +
                '<div class="sheet-row"><button data-t="btnAddManual" class="btn primary" type="button">Add as confirmed</button></div>' +
              '</details>' +
            '</div>' +
          '</section>' +
          '<section data-t="paneKeys" class="pane" aria-label="Keys">' +
            '<div class="pane-head"><h2>Keys</h2></div>' +
            '<div data-t="keysList" class="pane-body"></div>' +
          '</section>' +
        '</div>' +
        '<section data-t="paneDiag" class="pane" aria-label="Diagram">' +
          '<div class="pane-head diag-head"><h2>Diagram</h2><span data-t="selHint" class="hint" aria-live="polite">Tap two tables to get the JOIN</span>' +
            '<button data-t="btnResetLayout" class="btn small ghost" type="button">Reset layout</button></div>' +
          '<div data-t="diagWrap" class="diag-wrap"><svg data-t="diag" class="diag" xmlns="http://www.w3.org/2000/svg" width="400" height="300" role="group" aria-label="Table diagram"></svg></div>' +
        '</section>' +
      '</div>' +
      '<div class="ask-foot"><span data-t="askLine"></span><button data-t="btnGoAsk" class="btn small" type="button">Go to Ask</button></div>' +
    '</div>' +
    '</div>' +
    '<aside data-t="joinPanel" class="join" role="dialog" aria-modal="false" aria-label="JOIN">' +
      '<div class="sheet-head"><h2 data-t="joinTitle">JOIN</h2><button data-t="btnCloseJoin" class="btn icon-btn ghost" type="button" aria-label="Close">' + X + '</button></div>' +
      '<div data-t="joinBody" class="join-body"></div>' +
    '</aside>';

  QDeskTabs.relate = {
    title: 'Relate',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>',
    mount: function (root, ctx) {
      root.innerHTML = TEMPLATE;
      root.setAttribute('data-view', 'list');
      var $ = function (name) { return root.querySelector('[data-t="' + name + '"]'); };
      var S = {
        p: null, quiet: false, view: 'list', pos: {}, posSaved: false, world: { w: 0, h: 0 }, boxes: {}, edges: [],
        sel: null, join: null, left: false, drag: null, focusT: null, active: false, dirty: true, unsub: null
      };
      var listeners = [];
      function on(el, ev, fn, o) { el.addEventListener(ev, fn, o); listeners.push([el, ev, fn, o]); }
      var toast = ctx.toast;

      /* ================================================================ analyze */

      function analyzed() {
        var p = S.p;
        return !!(p && (p.keys().length || p.relations().length || p.getMeta(ANALYZED_KEY)));
      }

      function runAnalyze() {
        var p = S.p;
        if (!p || !p.userTables().length) return;
        var btns = [$('btnAnalyze'), $('btnAnalyzeReady')];
        btns.forEach(function (b) { b.disabled = true; b.classList.add('busy'); b.setAttribute('data-label', b.textContent); b.textContent = 'Analyzing'; });
        setTimeout(function () {
          var t0 = QD._clock(), res = null, err = null;
          S.quiet = true;
          try {
            var a = QDKeys.analyze(p);
            res = QDKeys.apply(p, a);
            p.setMeta(ANALYZED_KEY, QD.now());
          } catch (e) { err = e; }
          S.quiet = false;
          var ms = QD._clock() - t0;
          btns.forEach(function (b) { b.disabled = false; b.classList.remove('busy'); b.textContent = b.getAttribute('data-label') || 'Analyze'; });
          if (!S.posSaved) S.pos = {};
          loadPositions();
          render();
          if (S.join) showJoin(S.join.a, S.join.b);
          if (err) { toast('Analyze stopped. ' + err.message); return; }
          var keyed = p.userTables().filter(function (t) { return chosenKey(t, p.keys()).pick; }).length;
          toast(plural(keyed, 'key') + ' and ' + plural(res.relations, 'relationship') + ' proposed in ' + fmtMs(ms));
        }, 0);
      }

      /* =================================================================== keys */

      function chosenKey(table, all) {
        var mine = all.filter(function (k) { return k.table === table; });
        var conf = mine.filter(function (k) { return k.status === 'confirmed'; })[0];
        var best = mine.filter(function (k) { return k.status === 'proposed' && k.evidence && k.evidence.best; })[0];
        var pick = conf || best || null;
        return { pick: pick, others: mine.filter(function (k) { return k !== pick && k.status !== 'rejected'; }) };
      }
      function reasonsHtml(list) {
        if (!list || !list.length) return '';
        return '<ul class="reasons">' + list.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
      }
      function scoreText(s) { return s == null ? '' : 'score ' + Number(s).toFixed(2); }

      function renderKeys() {
        var p = S.p, all = p.keys(), h = '';
        p.userTables().forEach(function (t) {
          var c = chosenKey(t, all), k = c.pick;
          h += '<div class="krow" data-ktable="' + esc(t) + '"><div class="krow-top"><span class="tname">' + esc(t) + '</span>';
          if (!k) h += '<span class="tag warn">No key found</span></div>';
          else {
            var lab = (k.evidence && k.evidence.label) || 'strong';
            h += '<span class="cols">' + esc(k.columns.join(', ')) + '</span>' +
              (k.status === 'confirmed' ? '<span class="pill confirmed">confirmed</span>' : '') +
              '<span class="pill ' + esc(lab) + '">' + esc(lab) + '</span><span class="score">' + esc(scoreText(k.score)) + '</span></div>' +
              reasonsHtml(k.evidence && k.evidence.reasons);
          }
          if (c.others.length) {
            h += '<details class="more"><summary>' + plural(c.others.length, 'other candidate') + '</summary>';
            c.others.forEach(function (o) {
              var ol = (o.evidence && o.evidence.label) || '';
              h += '<div class="cand"><span class="cols">' + esc(o.columns.join(', ')) + '</span>' +
                (ol ? '<span class="pill ' + esc(ol) + '">' + esc(ol) + '</span>' : '') + '<span class="score">' + esc(scoreText(o.score)) + '</span>' +
                '<button class="btn small" type="button" data-usekey="' + o.id + '">Use this key</button></div>';
            });
            h += '</details>';
          }
          h += '</div>';
        });
        $('keysList').innerHTML = h || '<p class="nothing">This project has no tables.</p>';
      }

      function useKey(id) {
        var k = S.p.keys().filter(function (x) { return x.id === id; })[0];
        if (!k) return;
        S.p.setKey(k.table, k.columns, 'confirmed');
        toast(k.table + ' now uses ' + k.columns.join(', ') + ' as its key');
      }

      /* ========================================================== relationships */

      function relRow(r) {
        var ev = r.evidence || {}, manual = !!ev.manual, lab = labelOf(r), h = '';
        h += '<div class="rrow" data-rel="' + r.id + '"><div class="rrow-top">';
        h += '<span class="rel">' + esc(r.fromTable + '.' + r.fromColumns.join(', ')) + '<span class="arr">' + ARROW + '</span>' + esc(r.toTable + '.' + r.toColumns.join(', ')) + '</span>';
        if (r.status === 'confirmed') h += '<span class="pill confirmed">confirmed</span>';
        if (r.status === 'rejected') h += '<span class="pill rejected">rejected</span>';
        h += manual ? '<span class="pill manual">by hand</span>' : '<span class="pill ' + esc(lab) + '">' + esc(lab) + '</span>';
        h += '<span class="tag">' + (r.cardinality === 'one-to-one' ? 'one to one' : 'many to one') + '</span>';
        if (ev.optional) h += '<span class="tag">Optional</span>';
        if (ev.orphanRows > 0) h += '<span class="tag warn">' + plural(ev.orphanRows, 'orphan row') + '</span>';
        if (!manual && r.score != null) h += '<span class="score">' + esc(scoreText(r.score)) + '</span>';
        h += '</div>';
        if (ev.reasons && ev.reasons.length) h += '<details class="more"><summary>Why</summary>' + reasonsHtml(ev.reasons) + '</details>';
        if (r.status === 'proposed' && ev.ambiguous && ev.alternates && ev.alternates.length) {
          h += '<div class="alts"><span>Could also be</span>';
          ev.alternates.forEach(function (a, i) {
            h += '<div class="alt"><code>' + esc(a.toTable + '.' + a.toColumns.join(', ')) + '</code><button class="btn small" type="button" data-alt="' + r.id + ':' + i + '">Use this instead</button></div>';
          });
          h += '</div>';
        }
        h += '<div class="acts">';
        if (r.status === 'proposed') {
          h += '<button class="btn small primary" type="button" data-decide="' + r.id + ':confirmed">Confirm</button>' +
            '<button class="btn small" type="button" data-decide="' + r.id + ':rejected">Reject</button>';
        } else if (manual) h += '<button class="btn small danger" type="button" data-delrel="' + r.id + '">Remove</button>';
        else h += '<button class="btn small" type="button" data-decide="' + r.id + ':proposed">Undo</button>';
        return h + '</div></div>';
      }

      function relGroup(title, name, list, extra, empty) {
        var h = '<div class="group" data-t="' + name + '"><div class="group-head"><h3>' + esc(title) + '<span class="count" data-t="' + name + 'Count">' + list.length + '</span></h3>' + (extra || '') + '</div>';
        h += list.length ? list.map(relRow).join('') : '<p class="nothing">' + esc(empty) + '</p>';
        return h + '</div>';
      }

      function renderRelations() {
        var all = S.p.relations();
        var proposed = all.filter(function (r) { return r.status === 'proposed' && isDrawn(r); });
        var maybe = all.filter(function (r) { return r.status === 'proposed' && !isDrawn(r); });
        var decided = all.filter(function (r) { return r.status !== 'proposed'; });
        var strong = proposed.filter(function (r) { return labelOf(r) === 'strong'; }).length;
        var extra = '<button data-t="btnConfirmStrong" class="btn small primary" type="button"' + (strong ? '' : ' disabled') + '>Confirm all strong</button>';
        $('relLists').innerHTML =
          relGroup('Proposed', 'grpProposed', proposed, extra, 'Nothing waiting for a decision.') +
          relGroup('Maybe', 'grpMaybe', maybe, '', 'No weak matches.') +
          relGroup('Decided', 'grpDecided', decided, '', 'Confirm or reject a proposal and it moves here.');
      }

      function findRel(id) { return S.p.relations().filter(function (r) { return r.id === id; })[0] || null; }
      function setStatus(r, status) {
        S.p.setRelation({ fromTable: r.fromTable, fromColumns: r.fromColumns, toTable: r.toTable, toColumns: r.toColumns, status: status });
      }
      function decide(id, status) {
        var r = findRel(id);
        if (!r) return;
        setStatus(r, status);
        toast((status === 'confirmed' ? 'Confirmed ' : status === 'rejected' ? 'Rejected ' : 'Back to proposed: ') + r.fromTable + '.' + r.fromColumns.join(', '));
      }
      function batch(fn) {
        S.quiet = true;
        try { fn(); } finally { S.quiet = false; }
        renderLists(); renderDiagram();
        if (S.join) showJoin(S.join.a, S.join.b);
      }
      function confirmAllStrong() {
        var list = S.p.relations('proposed').filter(function (r) { return labelOf(r) === 'strong'; });
        if (!list.length) return;
        batch(function () { list.forEach(function (r) { setStatus(r, 'confirmed'); }); });
        toast('Confirmed ' + plural(list.length, 'strong link'));
        ctx.tourEvent('confirmStrong');
      }
      function useAlternate(id, idx) {
        var r = findRel(id), alt = r && r.evidence && r.evidence.alternates ? r.evidence.alternates[idx] : null;
        if (!alt) return;
        var T = QDKeys.THRESHOLDS, s = alt.score;
        batch(function () {
          S.p.setRelation({ fromTable: r.fromTable, fromColumns: r.fromColumns, toTable: alt.toTable, toColumns: alt.toColumns, status: 'confirmed',
            score: s, cardinality: r.cardinality,
            evidence: { label: s >= T.strong ? 'strong' : s >= T.likely ? 'likely' : 'weak', mode: (r.evidence && r.evidence.mode) || 'exact',
              optional: r.evidence && r.evidence.optional, reasons: ['chosen by hand in place of ' + r.toTable + '.' + r.toColumns.join(', ')] } });
          setStatus(r, 'rejected');
        });
        toast(r.fromTable + '.' + r.fromColumns.join(', ') + ' now points at ' + alt.toTable);
      }

      /* =========================================================== add by hand */

      function colNames(t) {
        try { return S.p.objects('PRAGMA table_info(' + QD.quoteIdent(t) + ')').map(function (c) { return c.name; }); } catch (e) { return []; }
      }
      function options(list, sel) {
        return list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
      }
      function fillPickers(changed) {
        if (!S.p) return;
        var tables = S.p.userTables();
        var ft = $('mFromT'), fc = $('mFromC'), tt = $('mToT'), tc = $('mToC');
        if (!tables.length) { ft.innerHTML = fc.innerHTML = tt.innerHTML = tc.innerHTML = ''; return; }
        var f = tables.indexOf(ft.value) >= 0 ? ft.value : tables[0];
        var t = tables.indexOf(tt.value) >= 0 ? tt.value : (tables[1] || tables[0]);
        ft.innerHTML = options(tables, f);
        tt.innerHTML = options(tables, t);
        if (!changed || changed === 'fromT') { var fcs = colNames(f); fc.innerHTML = options(fcs, fcs.indexOf(fc.value) >= 0 ? fc.value : fcs[0]); }
        if (!changed || changed === 'toT') {
          var tcs = colNames(t), k = chosenKey(t, S.p.keys()).pick;
          var def = k && k.columns.length === 1 ? k.columns[0] : tcs[0];
          tc.innerHTML = options(tcs, def);
        }
        previewManual();
      }
      function orphanCount(ft, fc, tt, tc) {
        var sql = 'SELECT count(*) FROM ' + QD.quoteIdent(ft) + ' WHERE ' + QD.quoteIdent(fc) + ' IS NOT NULL AND ' + QD.quoteIdent(fc) +
          ' NOT IN (SELECT ' + QD.quoteIdent(tc) + ' FROM ' + QD.quoteIdent(tt) + ' WHERE ' + QD.quoteIdent(tc) + ' IS NOT NULL)';
        return S.p.query(sql, { history: false }).rows[0][0];
      }
      function previewManual() {
        var el = $('mPreview'), ft = $('mFromT').value, fc = $('mFromC').value, tt = $('mToT').value, tc = $('mToC').value;
        el.className = 'mpreview';
        if (!ft || !fc || !tt || !tc) { el.textContent = ''; return null; }
        if (ft === tt && fc === tc) { el.textContent = 'Pick two different columns.'; el.className = 'mpreview warn'; return null; }
        try {
          var n = orphanCount(ft, fc, tt, tc);
          el.textContent = n ? plural(n, 'row') + ' in ' + ft + ' point at a value missing from ' + tt + '.' : 'Every value in ' + ft + '.' + fc + ' finds a match in ' + tt + '.' + tc + '.';
          if (n) el.className = 'mpreview warn';
          return n;
        } catch (e) { el.textContent = e.message; el.className = 'mpreview warn'; return null; }
      }
      function addManual() {
        var ft = $('mFromT').value, fc = $('mFromC').value, tt = $('mToT').value, tc = $('mToC').value;
        var n = previewManual();
        if (n === null) { toast('Pick a column in each table first.'); return; }
        var q = QD.quoteIdent, p = S.p;
        var stats = p.rows('SELECT count(' + q(fc) + '), count(DISTINCT ' + q(fc) + '), count(*) FROM ' + q(ft))[0];
        p.setRelation({ fromTable: ft, fromColumns: [fc], toTable: tt, toColumns: [tc], status: 'confirmed', score: 1,
          cardinality: stats[0] && stats[0] === stats[1] ? 'one-to-one' : 'many-to-one',
          evidence: { manual: true, reasons: ['added by hand'], orphanRows: n, optional: stats[0] < stats[2] } });
        toast('Added ' + ft + '.' + fc + ARROW + tt + '.' + tc);
      }

      /* ======================================================== diagram layout */

      function drawnRelations() { return S.p ? S.p.relations().filter(isDrawn) : []; }
      function boxColumns(t, keys, rels) {
        var out = [], k = chosenKey(t, keys).pick, seen = {};
        if (k) k.columns.forEach(function (c) { out.push({ name: c, tag: 'PK' }); seen[c] = true; });
        var fk = {};
        rels.forEach(function (r) { if (r.fromTable === t) r.fromColumns.forEach(function (c) { fk[c] = true; }); });
        colNames(t).forEach(function (c) { if (fk[c] && !seen[c]) { out.push({ name: c, tag: 'FK' }); seen[c] = true; } });
        return out;
      }
      function boxHeight(cols) { return HEAD + ROWH * cols.length; }
      function depthOrder(tables, rels) {
        var parents = {}, memo = {};
        rels.forEach(function (r) {
          if (r.fromTable === r.toTable) return;
          (parents[r.fromTable] = parents[r.fromTable] || []).push(r.toTable);
        });
        function depth(t, stack) {
          if (t in memo) return memo[t];
          if (stack[t]) return 0;
          stack[t] = true;
          var d = 0;
          (parents[t] || []).forEach(function (p) { if (tables.indexOf(p) >= 0) d = Math.max(d, 1 + depth(p, stack)); });
          delete stack[t];
          memo[t] = d; return d;
        }
        return tables.slice().sort(function (a, b) {
          var da = depth(a, {}), db = depth(b, {});
          return da - db || (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
        });
      }
      function layoutGrid(tables, heights, top) {
        var out = {}, n = tables.length, cols = Math.max(1, Math.ceil(Math.sqrt(n))), y = top == null ? MARGIN : top;
        for (var i = 0; i < n; i += cols) {
          var row = tables.slice(i, i + cols), tall = 0;
          row.forEach(function (t, j) { out[t] = [MARGIN + j * (BW + GAPX), y]; tall = Math.max(tall, heights[t] || HEAD); });
          y += tall + GAPY;
        }
        return out;
      }
      function loadPositions() {
        if (!S.p) return;
        var raw = S.p.getMeta(POS_KEY), map = null;
        if (raw) { try { map = JSON.parse(raw); } catch (e) { map = null; } }
        S.posSaved = !!(map && typeof map === 'object');
        S.pos = {};
        if (S.posSaved) {
          Object.keys(map).forEach(function (t) { if (Array.isArray(map[t]) && map[t].length === 2) S.pos[t] = [+map[t][0] || 0, +map[t][1] || 0]; });
        }
      }
      function placeBoxes(tables, heights, rels) {
        if (!S.posSaved) { S.pos = layoutGrid(depthOrder(tables, rels), heights); return; }
        var missing = tables.filter(function (t) { return !S.pos[t]; });
        if (!missing.length) return;
        var bottom = 0;
        tables.forEach(function (t) { if (S.pos[t]) bottom = Math.max(bottom, S.pos[t][1] + (heights[t] || HEAD)); });
        var add = layoutGrid(depthOrder(missing, rels), heights, bottom ? bottom + GAPY : MARGIN);
        Object.keys(add).forEach(function (t) { S.pos[t] = add[t]; });
      }
      function savePositions() {
        if (!S.p) return;
        var out = {};
        Object.keys(S.pos).forEach(function (t) { if (S.boxes[t]) out[t] = [Math.round(S.pos[t][0]), Math.round(S.pos[t][1])]; });
        S.posSaved = true;
        S.quiet = true;
        try { S.p.setMeta(POS_KEY, JSON.stringify(out)); } finally { S.quiet = false; }
      }
      function resetLayout() {
        if (!S.p) return;
        S.p.setMeta(POS_KEY, null);
        S.posSaved = false; S.pos = {};
        renderDiagram();
        toast('Layout reset to the starting grid');
      }

      /* ======================================================= diagram drawing */

      function edgePoint(b, px, py) {
        var cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = px - cx, dy = py - cy;
        if (!dx && !dy) return [cx, cy];
        var sx = dx ? (b.w / 2) / Math.abs(dx) : Infinity, sy = dy ? (b.h / 2) / Math.abs(dy) : Infinity, s = Math.min(sx, sy);
        return [cx + dx * s, cy + dy * s];
      }
      function selfLoop(b) {
        var x = b.x + b.w, y1 = b.y + Math.min(18, b.h * 0.3), y2 = b.y + Math.max(b.h - 12, b.h * 0.7), out = 44;
        return { d: 'M' + x + ' ' + y1 + ' C' + (x + out) + ' ' + (y1 - 10) + ' ' + (x + out) + ' ' + (y2 + 10) + ' ' + x + ' ' + y2, end: [x, y2] };
      }
      function boxRect(t) { var p = S.pos[t], b = S.boxes[t]; return { x: p[0], y: p[1], w: BW, h: b.h }; }
      function edgesSvg() {
        var hl = {}, h = '';
        if (S.join && S.join.path) S.join.path.forEach(function (st) { hl[relKey(st.relation)] = true; });
        S.edges.forEach(function (r) {
          if (!S.boxes[r.fromTable] || !S.boxes[r.toTable] || !S.pos[r.fromTable] || !S.pos[r.toTable]) return;
          var cls = (r.status === 'confirmed' ? 'confirmed' : 'proposed') + (hl[relKey(r)] ? ' hl' : '');
          var a = boxRect(r.fromTable), b = boxRect(r.toTable), d, end;
          if (r.fromTable === r.toTable) { var L = selfLoop(a); d = L.d; end = L.end; }
          else {
            var p1 = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2), p2 = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2);
            d = 'M' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + ' L' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1); end = p2;
          }
          h += '<path class="edge ' + cls + '" data-edge="' + r.id + '" d="' + d + '"><title>' + esc(r.fromTable + '.' + r.fromColumns.join(', ') + ARROW + r.toTable + '.' + r.toColumns.join(', ')) + '</title></path>' +
            '<circle class="edot ' + cls + '" cx="' + end[0].toFixed(1) + '" cy="' + end[1].toFixed(1) + '" r="4"></circle>';
        });
        return h;
      }
      function renderEdges() { var g = $('diag').querySelector('[data-g="edges"]'); if (g) g.innerHTML = edgesSvg(); }
      function sizeWorld() {
        var wrap = $('diagWrap'), maxX = 0, maxY = 0;
        Object.keys(S.boxes).forEach(function (t) { var r = boxRect(t); maxX = Math.max(maxX, r.x + r.w + 60); maxY = Math.max(maxY, r.y + r.h); });
        S.world.w = Math.max(S.world.w || 0, maxX + MARGIN, wrap.clientWidth || 0, 320);
        S.world.h = Math.max(S.world.h || 0, maxY + MARGIN, wrap.clientHeight || 0, 240);
        var svg = $('diag'); svg.setAttribute('width', Math.ceil(S.world.w)); svg.setAttribute('height', Math.ceil(S.world.h));
      }
      function renderDiagram() {
        if (!S.p || !analyzed()) return;
        var tables = S.p.userTables(), keys = S.p.keys(), rels = drawnRelations(), heights = {}, colsOf = {};
        tables.forEach(function (t) { colsOf[t] = boxColumns(t, keys, rels); heights[t] = boxHeight(colsOf[t]); });
        placeBoxes(tables, heights, rels);
        S.boxes = {}; S.edges = rels; S.world = { w: 0, h: 0 };
        var onPath = {};
        if (S.join && S.join.path) { onPath[S.join.a] = onPath[S.join.b] = true; S.join.path.forEach(function (st) { onPath[st.relation.fromTable] = onPath[st.relation.toTable] = true; }); }
        var bh = '';
        tables.forEach(function (t) {
          S.boxes[t] = { h: heights[t] };
          var p = S.pos[t], cols = colsOf[t], h = heights[t], rows = S.p.scalar('SELECT count(*) FROM ' + QD.quoteIdent(t));
          bh += '<g class="box' + (S.sel === t ? ' sel' : '') + (onPath[t] ? ' onpath' : '') + '" data-tbl="' + esc(t) + '" transform="translate(' + p[0] + ' ' + p[1] + ')" tabindex="0" role="button" aria-label="' + esc(t + ', ' + plural(rows, 'row')) + '">' +
            '<rect class="ring" x="-3" y="-3" width="' + (BW + 6) + '" height="' + (h + 6) + '" rx="12"></rect>' +
            '<rect class="bx" width="' + BW + '" height="' + h + '" rx="9"></rect>' +
            '<path class="bh" d="M0 9a9 9 0 0 1 9-9h' + (BW - 18) + 'a9 9 0 0 1 9 9v' + (HEAD - 9) + 'h-' + BW + 'z"></path>' +
            '<text class="bn" x="10" y="20">' + esc(trunc(t, NAME_MAX)) + '</text>' +
            '<text class="bc" x="' + (BW - 10) + '" y="20" text-anchor="end">' + esc(rows.toLocaleString()) + '</text>';
          cols.forEach(function (c, i) {
            var y = HEAD + ROWH * i + 15;
            bh += '<text class="cn" x="10" y="' + y + '">' + esc(trunc(c.name, NAME_MAX)) + '</text><text class="' + (c.tag === 'PK' ? 'pk' : 'fk') + '" x="' + (BW - 10) + '" y="' + y + '" text-anchor="end">' + c.tag + '</text>';
          });
          bh += '</g>';
        });
        $('diag').innerHTML = '<g data-g="edges"></g><g data-g="boxes">' + bh + '</g>';
        sizeWorld();
        renderEdges();
        if (S.focusT) { var f = boxEl(S.focusT); if (f) f.focus({ preventScroll: true }); }
      }
      function boxEl(t) {
        var all = $('diag').querySelectorAll('g.box');
        for (var i = 0; i < all.length; i += 1) if (all[i].getAttribute('data-tbl') === t) return all[i];
        return null;
      }

      /* =================================================== diagram interaction */

      function moveBox(t, x, y) {
        var b = S.boxes[t]; if (!b) return;
        x = Math.max(0, Math.min(x, S.world.w - BW));
        y = Math.max(0, Math.min(y, S.world.h - b.h));
        var grew = false;
        if (x + BW > S.world.w - MARGIN) { S.world.w += BW + GAPX; grew = true; }
        if (y + b.h > S.world.h - MARGIN) { S.world.h += b.h + GAPY; grew = true; }
        if (grew) { var svg = $('diag'); svg.setAttribute('width', Math.ceil(S.world.w)); svg.setAttribute('height', Math.ceil(S.world.h)); }
        S.pos[t] = [x, y];
        var el = boxEl(t); if (el) el.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
        renderEdges();
      }
      function onBoxDown(e) {
        var g = e.target.closest && e.target.closest('g.box');
        if (!g || (e.pointerType === 'mouse' && e.button !== 0)) return;
        var t = g.getAttribute('data-tbl');
        try { g.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        S.drag = { t: t, id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: S.pos[t][0], oy: S.pos[t][1], at: Date.now(), moved: false, g: g };
      }
      function onBoxMove(e) {
        var d = S.drag;
        if (!d || e.pointerId !== d.id) return;
        var dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (!d.moved && Math.sqrt(dx * dx + dy * dy) < 6) return;
        if (!d.moved) { d.moved = true; d.g.classList.add('dragging'); }
        e.preventDefault();
        moveBox(d.t, d.ox + dx, d.oy + dy);
      }
      function onBoxUp(e) {
        var d = S.drag;
        if (!d || e.pointerId !== d.id) return;
        S.drag = null;
        try { d.g.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        d.g.classList.remove('dragging');
        if (e.type === 'pointercancel') { if (d.moved) savePositions(); return; }
        if (d.moved) savePositions();
        else if (Date.now() - d.at < 500) selectTable(d.t);
      }
      function onBoxKey(e) {
        var g = e.target.closest && e.target.closest('g.box');
        if (!g) return;
        var t = g.getAttribute('data-tbl'), step = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key];
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.focusT = t; selectTable(t); return; }
        if (step) { e.preventDefault(); moveBox(t, S.pos[t][0] + step[0], S.pos[t][1] + step[1]); savePositions(); }
      }

      /* ==================================================== selection and JOIN */

      function setHint(text) { $('selHint').textContent = text; }
      function markSelected() {
        Array.prototype.forEach.call($('diag').querySelectorAll('g.box'), function (g) {
          g.classList[g.getAttribute('data-tbl') === S.sel ? 'add' : 'remove']('sel');
        });
      }
      function selectTable(t) {
        if (!S.p || S.p.userTables().indexOf(t) < 0) return;
        if (S.sel === t) { clearSelection(); return; }
        if (S.sel) { var a = S.sel; S.sel = null; markSelected(); showJoin(a, t); return; }
        S.sel = t;
        markSelected();
        setHint('Tap a second table');
      }
      function clearSelection() { S.sel = null; markSelected(); setHint('Tap two tables to get the JOIN'); }
      function findPath(a, b) {
        var conf = S.p.relations('confirmed'), path = QDKeys.joinPath(conf, a, b);
        if (path) return { path: path, unconfirmed: false };
        var pool = conf.concat(S.p.relations('proposed').filter(isDrawn));
        path = QDKeys.joinPath(pool, a, b);
        return path ? { path: path, unconfirmed: true } : { path: null, unconfirmed: false };
      }
      function pathWords(a, path) {
        var cur = a, parts = [];
        path.forEach(function (st) {
          var r = st.relation, next = st.forward ? r.toTable : r.fromTable;
          var here = st.forward ? r.fromColumns : r.toColumns, there = st.forward ? r.toColumns : r.fromColumns;
          parts.push('<b>' + esc(next) + '</b> where ' + esc(cur + '.' + here.join(', ')) + ' matches ' + esc(next + '.' + there.join(', ')));
          cur = next;
        });
        return 'Start from <b>' + esc(a) + '</b>, then join ' + parts.join(', then ') + '.';
      }
      function showJoin(a, b) {
        var found = findPath(a, b), body = $('joinBody'), h = '';
        S.join = { a: a, b: b, path: found.path, unconfirmed: found.unconfirmed, sql: null };
        $('joinTitle').textContent = a + ARROW + b;
        if (!found.path) {
          h = '<p class="join-path">These tables are not connected yet. Confirm a link that leads from ' + esc(a) + ' to ' + esc(b) + ', or add one by hand under Relationships.</p>';
        } else {
          var sql = QDKeys.joinSQL(a, found.path, { left: S.left });
          S.join.sql = sql;
          h += '<p class="join-path">' + pathWords(a, found.path) + '</p>';
          if (found.unconfirmed) h += '<div class="note"><span>This path uses links you have not confirmed yet.</span><button data-t="btnConfirmPath" class="btn small primary" type="button">Confirm these links</button></div>';
          h += '<pre class="sql" data-t="joinSql">' + esc(sql) + '</pre>';
          try {
            var n = S.p.query('SELECT count(*) FROM (' + sql + ')', { history: false }).rows[0][0];
            h += '<p class="rowsnote">Returns ' + plural(n, 'row') + '. SELECT * keeps every column, so a shared column such as an id can appear twice.</p>';
          } catch (e) { h += '<p class="rowsnote">' + esc(e.message) + '</p>'; }
          h += '<button data-t="swLeft" class="switch" type="button" role="switch" aria-checked="' + S.left + '"><span class="track" aria-hidden="true"></span>Keep unmatched rows</button>';
          h += '<div class="sheet-row"><button data-t="btnCopyJoin" class="btn" type="button">Copy</button><button data-t="btnSaveJoin" class="btn" type="button">Save as query</button>' +
            '<button data-t="btnOpenQuery" class="btn primary" type="button">Open in Query</button></div>';
        }
        body.innerHTML = h;
        setJoin(true);
        setHint('Tap two tables to get the JOIN');
        highlightPath();
      }
      function highlightPath() {
        var onP = {};
        if (S.join && S.join.path) {
          onP[S.join.a] = onP[S.join.b] = true;
          S.join.path.forEach(function (st) { onP[st.relation.fromTable] = onP[st.relation.toTable] = true; });
        }
        Array.prototype.forEach.call($('diag').querySelectorAll('g.box'), function (g) { g.classList[onP[g.getAttribute('data-tbl')] ? 'add' : 'remove']('onpath'); });
        renderEdges();
      }
      function closeJoin() { S.join = null; setJoin(false); highlightPath(); }
      function setJoin(onn) {
        root.classList[onn ? 'add' : 'remove']('join-open');
        if (onn) { var b = $('btnCloseJoin'); if (b && ctx.wide()) b.focus({ preventScroll: true }); }
      }
      function confirmPath() {
        if (!S.join || !S.join.path) return;
        var list = S.join.path.map(function (st) { return st.relation; }).filter(function (r) { return r.status !== 'confirmed'; });
        batch(function () { list.forEach(function (r) { setStatus(r, 'confirmed'); }); });
        toast('Confirmed ' + plural(list.length, 'link'));
      }
      function copyJoin() {
        var sql = S.join && S.join.sql;
        if (!sql) return;
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = sql; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
          root.appendChild(ta); ta.select();
          var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          root.removeChild(ta);
          toast(ok ? 'SQL copied' : 'Copy did not work here. Select the SQL and copy it.');
        }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(sql).then(function () { toast('SQL copied'); }, fallback);
        else fallback();
      }
      function saveJoin() {
        if (!S.join || !S.join.sql) return null;
        var id = S.p.saveQuery({ name: S.join.a + ' to ' + S.join.b, sql: S.join.sql, note: 'JOIN written by Relate', origin: 'manual' });
        toast('Saved ' + S.join.a + ' to ' + S.join.b + ' in this project');
        return id;
      }
      function openInQuery() {
        if (!S.join || !S.join.sql) return;
        var sql = S.join.sql;
        closeJoin();
        ctx.goTo('query', { sql: sql, run: true });
      }

      /* ========================================================== views */

      function setView(v) {
        S.view = v;
        root.setAttribute('data-view', v);
        Array.prototype.forEach.call(root.querySelectorAll('.viewseg [data-view]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v)); });
        if (v === 'diagram') renderDiagram();
        root.scrollTop = 0;
      }

      /* ========================================================= render */

      function summaryText() {
        var p = S.p, rels = p.relations(), n = p.userTables().length;
        var conf = rels.filter(function (r) { return r.status === 'confirmed'; }).length;
        var prop = rels.filter(function (r) { return r.status === 'proposed'; }).length;
        var keys = p.userTables().filter(function (t) { return chosenKey(t, p.keys()).pick; }).length;
        return '<b>' + plural(n, 'table') + '</b>' + DOT + plural(keys, 'key') + DOT + conf + ' confirmed' + DOT + prop + ' to review';
      }
      function renderAskLine() {
        var n = S.p ? S.p.relations('confirmed').length : 0;
        $('askLine').textContent = n ? 'Ask will use ' + plural(n, 'confirmed relationship') + ' to join tables correctly.' :
          'Confirm relationships and Ask will use them to join tables correctly.';
      }
      function renderLists() {
        if (!S.p || !analyzed()) return;
        renderKeys();
        renderRelations();
        $('summary').innerHTML = summaryText();
        renderAskLine();
      }
      function render() {
        S.dirty = false;
        var n = S.p ? S.p.userTables().length : 0, done = n && analyzed();
        show($('empty'), !n);
        show($('ready'), !!n && !done);
        show($('finder'), !!done);
        $('readyCount').textContent = plural(n, 'table');
        if (!done) { closeJoin(); return; }
        renderLists();
        fillPickers();
        renderDiagram();
      }

      /* ========================================================= events */

      on($('mFromT'), 'change', function () { fillPickers('fromT'); });
      on($('mToT'), 'change', function () { fillPickers('toT'); });
      on($('mFromC'), 'change', previewManual);
      on($('mToC'), 'change', previewManual);
      var svg = $('diag');
      on(svg, 'pointerdown', onBoxDown);
      on(svg, 'pointermove', onBoxMove);
      on(svg, 'pointerup', onBoxUp);
      on(svg, 'pointercancel', onBoxUp);
      on(svg, 'keydown', onBoxKey);
      on(svg, 'focusin', function (e) { var g = e.target.closest && e.target.closest('g.box'); S.focusT = g ? g.getAttribute('data-tbl') : null; });
      on(svg, 'focusout', function () { S.focusT = null; });
      /* iOS starts a page scroll before pointer events can claim the touch, so a box swallows its own touchstart. */
      on(svg, 'touchstart', function (e) { if (e.target.closest && e.target.closest('g.box')) e.preventDefault(); }, { passive: false });

      on(root, 'click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        var a, t = b.getAttribute('data-t');
        if (t === 'btnAnalyze' || t === 'btnAnalyzeReady') runAnalyze();
        else if (t === 'btnConfirmStrong') confirmAllStrong();
        else if (t === 'btnConfirmPath') confirmPath();
        else if (t === 'btnCopyJoin') copyJoin();
        else if (t === 'btnSaveJoin') saveJoin();
        else if (t === 'btnOpenQuery') openInQuery();
        else if (t === 'btnCloseJoin') closeJoin();
        else if (t === 'btnAddManual') addManual();
        else if (t === 'btnResetLayout') resetLayout();
        else if (t === 'btnGoAsk') ctx.goTo('ask');
        else if (t === 'swLeft') { S.left = !S.left; if (S.join) showJoin(S.join.a, S.join.b); }
        else if ((a = b.getAttribute('data-act'))) {
          if (a === 'sample') ctx.loadSample(); else if (a === 'open') ctx.openProjects(); else if (a === 'load') ctx.goTo('load');
        }
        else if ((a = b.getAttribute('data-view')) && b.closest('.viewseg')) setView(a);
        else if ((a = b.getAttribute('data-usekey'))) useKey(+a);
        else if ((a = b.getAttribute('data-decide'))) { var d = a.split(':'); decide(+d[0], d[1]); }
        else if ((a = b.getAttribute('data-alt'))) { var al = a.split(':'); useAlternate(+al[0], +al[1]); }
        else if ((a = b.getAttribute('data-delrel'))) {
          if (b.getAttribute('data-armed') !== '1') { b.setAttribute('data-armed', '1'); b.textContent = 'Tap again'; return; }
          S.p.deleteRelation(+a); toast('Removed the link');
        }
      });
      on(document, 'keydown', function (e) {
        if (e.key !== 'Escape' || !S.active) return;
        if (document.querySelector('.scrim:not(.hidden)')) return;
        if (root.classList.contains('join-open')) closeJoin();
        else if (S.sel) clearSelection();
      });
      on(window, 'resize', function () { if (S.active && S.p && analyzed()) sizeWorld(); });

      /* ========================================================= the component */

      function useProject(p) {
        if (S.unsub) { S.unsub(); S.unsub = null; }
        if (S.p !== p) { S.sel = null; S.join = null; S.left = false; S.boxes = {}; S.edges = []; S.pos = {}; $('diag').innerHTML = ''; setJoin(false); }
        S.p = p;
        if (p) {
          S.unsub = p.onChange(function (kind) {
            if (S.quiet || !S.active) return;
            if (kind === 'schema') { loadPositions(); render(); }
            else if (kind === 'keys' || kind === 'relations') { renderLists(); renderDiagram(); if (S.join) showJoin(S.join.a, S.join.b); }
          });
        }
        loadPositions();
        S.dirty = true;
        if (S.active) render();
      }
      useProject(ctx.project());

      return {
        activate: function (payload) {
          S.active = true;
          if (S.p !== ctx.project()) useProject(ctx.project());
          if (S.dirty) { loadPositions(); render(); }
          if (payload && payload.analyze && S.p && S.p.userTables().length && !analyzed()) runAnalyze();
        },
        deactivate: function () { S.active = false; if (root.classList.contains('join-open')) closeJoin(); },
        projectChanged: function (p) { useProject(p); },
        stale: function () { S.dirty = true; if (S.active) { loadPositions(); render(); } },
        unmount: function () {
          if (S.unsub) S.unsub();
          listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
          root.innerHTML = '';
        },
        analyze: runAnalyze, select: selectTable, confirmAllStrong: confirmAllStrong, state: S
      };
    }
  };
})();
