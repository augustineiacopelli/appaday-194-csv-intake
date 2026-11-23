/* Learn tab. The first part is the Query Clinic component from AppADay 199, copied unchanged. */
/* Query Clinic, AppADay 199. The course and its grading live in QD:CLINIC; this is the interface only.
 * QueryClinic.mount(root, { project }) builds everything inside root and looks up every element under root,
 * so Day 200 can mount it in its Learn tab. With no project it opens or creates the stored project named Query Clinic. */
(function () {
  'use strict';
  var APP = '199';
  var ENGINE_DIR = '../appaday/vendor/sql.js-1.16.0/';
  var LS_TSQL = 'queryclinic-tsql';
  var DOT = ' \u00b7 ';
  var SHOW_AFTER = 3;
  /* sha256 of the ten practice tables, the same pin as test/clinic.fingerprint.json in the 194 workspace */
  var PINNED = '2b9a53897d0aa60699fc961732d22b8f664e8543e6f6bd0c10c9bc3dab356814';
  var PK = { campuses: 'campus_id', departments: 'dept_id', instructors: 'instructor_id', courses: 'course_id', terms: 'term_id',
    rooms: 'room_id', sections: 'section_id', students: 'student_id', enrollments: 'enrollment_id', work_orders: 'work_order_id' };

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function plural(n, one, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? one : (many || one + 's')); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  var TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/></svg>';

  var TEMPLATE =
    '<div class="qc-top">' +
      '<div class="qc-meter"><div class="row"><span data-qc="meterText">Starting</span><span data-qc="saveState" class="save-state" aria-live="polite"><span class="dot"></span><span class="txt">Starting</span></span></div>' +
      '<div class="track" aria-hidden="true"><span data-qc="meterBar" style="width:0%"></span></div></div>' +
      '<button data-qc="btnSchema" class="btn small" type="button">Tables</button>' +
      '<button data-qc="btnGear" class="btn icon-btn" type="button" aria-label="Settings">' + GEAR + '</button>' +
    '</div>' +
    '<div data-qc="banner" class="banner hidden" role="alert"></div>' +
    '<section data-qc="viewUnits" class="qc-view">' +
      '<div class="ex-h"><h1>Learn SQL by answering real questions.</h1>' +
      '<p class="lede">Forty exercises in ten units on Prairie Ridge College, a practice database built right here in your browser. Each answer is graded by the rows it returns, so any correct query passes.</p></div>' +
      '<div data-qc="units" class="units"></div>' +
      '<div class="list-foot"><button data-qc="btnNextUp" class="btn primary" type="button">Continue</button><button data-qc="btnTotals" class="btn" type="button">Totals</button></div>' +
    '</section>' +
    '<section data-qc="viewEx" class="qc-view hidden">' +
      '<div class="crumbs"><button data-qc="btnBack" class="btn small" type="button">All units</button><span data-qc="where" class="where"></span></div>' +
      '<div class="card">' +
        '<div class="ex-h"><h2 data-qc="exTitle"></h2><div data-qc="exTags" class="ex-tags"></div></div>' +
        '<p data-qc="exPrompt" class="prompt"></p>' +
        '<div data-qc="tsqlNote" class="note hidden"></div>' +
        '<div data-qc="hintNote" class="note hint hidden"></div>' +
        '<label class="sr" data-qc="edLabel">Your SQL</label>' +
        '<textarea data-qc="editor" class="editor" rows="6" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="SELECT ..."></textarea>' +
        '<div class="run-row">' +
          '<button data-qc="btnRun" class="btn" type="button">Run</button>' +
          '<button data-qc="btnCheck" class="btn primary" type="button">Check</button>' +
          '<span class="grow"></span>' +
          '<button data-qc="btnHint" class="btn small" type="button">Hint</button>' +
          '<button data-qc="btnLast" class="btn small hidden" type="button">Last SQL</button>' +
          '<button data-qc="btnAnswer" class="btn small" type="button" disabled>Show answer</button>' +
        '</div>' +
        '<p class="run-note" data-qc="runNote">Run shows the rows without grading. Check grades the answer. Ctrl or Cmd plus Enter checks.</p>' +
        '<div data-qc="answerBox" class="verdict info hidden"></div>' +
        '<div data-qc="verdict" class="verdict hidden" aria-live="polite"></div>' +
      '</div>' +
      '<div data-qc="result" class="result hidden"></div>' +
      '<div class="ex-nav"><button data-qc="btnPrev" class="btn" type="button">Previous</button><button data-qc="btnNext" class="btn" type="button">Next</button></div>' +
    '</section>' +
    '<section data-qc="viewFinish" class="qc-view hidden"></section>' +
    '<div data-qc="schemaScrim" class="scrim hidden" role="dialog" aria-modal="true">' +
      '<div class="sheet"><div class="sheet-head"><h2>Practice tables</h2><button class="btn icon-btn ghost" type="button" data-qc-close="schemaScrim" aria-label="Close">' + X + '</button></div>' +
      '<div class="sheet-body"><p class="muted">Ten tables of Prairie Ridge College. Tap a table for its columns and three sample rows. Key columns are outlined.</p><div data-qc="tables" class="tables"></div></div></div>' +
    '</div>' +
    '<div data-qc="setScrim" class="scrim hidden" role="dialog" aria-modal="true">' +
      '<div class="sheet"><div class="sheet-head"><h2>Settings</h2><button class="btn icon-btn ghost" type="button" data-qc-close="setScrim" aria-label="Close">' + X + '</button></div>' +
      '<div class="sheet-body">' +
        '<div><h3>Dialect</h3><label class="switch"><input data-qc="setTsql" type="checkbox"> I am learning SQL Server</label>' +
        '<p class="muted">Shows a note on the exercises where SQL Server (T-SQL) is written differently, such as TOP instead of LIMIT. The answers here still run in SQLite.</p></div>' +
        '<div><h3>Your progress</h3><div class="sheet-row"><button data-qc="btnDownload" class="btn" type="button">Download progress</button><button data-qc="btnRestore" class="btn" type="button">Restore from a file</button></div>' +
        '<p class="muted" style="margin-top:0.5rem">Progress is saved on this device as the project named Query Clinic. Download it to keep a copy or move it to another device, then restore it there.</p></div>' +
        '<div><h3>Practice data</h3><div class="sheet-row"><button data-qc="btnVerify" class="btn" type="button">Check the practice data</button><button data-qc="btnRebuild" class="btn" type="button">Rebuild the practice data</button></div>' +
        '<p data-qc="verifyText" class="muted" style="margin-top:0.5rem"></p></div>' +
        '<div><h3>Start over</h3><div class="sheet-row"><button data-qc="btnReset" class="btn danger" type="button">Reset progress</button></div>' +
        '<p class="muted" style="margin-top:0.5rem">Clears every attempt and solved mark. The practice data stays as it is.</p></div>' +
      '</div></div>' +
    '</div>' +
    '<input data-qc="fileIn" class="sr" type="file" accept=".sqlite,.sqlite3,.db,application/x-sqlite3,application/vnd.sqlite3" tabindex="-1" aria-hidden="true">' +
    '<div data-qc="toast" class="qc-toast hidden" role="status"></div>';

  /* ======================================================== practice data check */

  function fingerprintText(p) {
    return QDClinic.TABLES.map(function (t) { return JSON.stringify(p.rows('SELECT * FROM ' + t + ' ORDER BY 1')); }).join('');
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i += 1) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  var referenceText = null;
  /** Resolves { ok, problems: [sentences], method }. Never throws. */
  function verifyData(p) {
    var problems = [];
    QDClinic.TABLES.forEach(function (t) { if (!p.hasTable(t)) problems.push('The table ' + t + ' is missing.'); });
    if (problems.length) return Promise.resolve({ ok: false, problems: problems, method: 'tables' });
    var text;
    try { text = fingerprintText(p); } catch (e) { return Promise.resolve({ ok: false, problems: ['The practice tables could not be read. ' + e.message], method: 'read' }); }
    var subtle = window.crypto && window.crypto.subtle && typeof TextEncoder !== 'undefined' ? window.crypto.subtle : null;
    var compare = subtle ? subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (d) { return { same: hex(d) === PINNED, method: 'sha256' }; })
      : Promise.reject(new Error('no subtle'));
    return compare.catch(function () {
      if (referenceText === null) { var ref = QDClinic.createProject(); referenceText = fingerprintText(ref); ref.close(); }
      return { same: text === referenceText, method: 'reference' };
    }).then(function (r) {
      if (!r.same) {
        var ref = QDClinic.createProject();
        QDClinic.TABLES.forEach(function (t) {
          var a = p.scalar('SELECT count(*) FROM ' + t), b = ref.scalar('SELECT count(*) FROM ' + t);
          if (a !== b) problems.push(t + ' has ' + plural(a, 'row') + ' where it should have ' + Number(b).toLocaleString() + '.');
          else if (JSON.stringify(p.rows('SELECT * FROM ' + t + ' ORDER BY 1')) !== JSON.stringify(ref.rows('SELECT * FROM ' + t + ' ORDER BY 1'))) problems.push('Some values in ' + t + ' have been changed.');
        });
        ref.close();
        if (!problems.length) problems.push('The practice data does not match the original.');
      }
      return { ok: r.same, problems: problems, method: r.method };
    });
  }

  /** A fresh Query Clinic project that carries over every attempt and solved mark from old. */
  function rebuildFrom(old) {
    var keep = [];
    try { keep = old.objects('SELECT exercise_id, status, attempts, last_sql, solved_at FROM _qd_clinic'); } catch (e) { keep = []; }
    var np = QDClinic.createProject();
    keep.forEach(function (r) {
      if (!QDClinic.exercise(r.exercise_id)) return;
      np.db.run('INSERT OR REPLACE INTO _qd_clinic (exercise_id, status, attempts, last_sql, solved_at) VALUES (?,?,?,?,?)',
        [r.exercise_id, r.status, r.attempts, r.last_sql, r.solved_at]);
    });
    np._touch('clinic');
    return { project: np, kept: keep.length };
  }

  /* ================================================================ mount */

  function mount(root, opts) {
    opts = opts || {};
    if (!root) throw new Error('QueryClinic.mount needs a root element.');
    if (typeof QD === 'undefined' || typeof QDClinic === 'undefined') throw new Error('QD:CORE and QD:CLINIC must load before Query Clinic.');
    clear(root);
    root.classList.add('qc');
    root.innerHTML = TEMPLATE;
    var R = {};
    Array.prototype.forEach.call(root.querySelectorAll('[data-qc]'), function (el) { R[el.getAttribute('data-qc')] = el; });
    var edId = 'qc-ed-' + Math.random().toString(36).slice(2, 8);
    R.editor.id = edId; R.edLabel.setAttribute('for', edId);

    var S = {
      p: null, auto: null, view: 'units', exId: null, openUnit: null, drafts: {}, hints: {}, answers: {},
      verdict: null, integrity: null, tsql: lsGet(LS_TSQL, '0') === '1', unsub: null, autosave: opts.autosave !== false,
      stored: !opts.project, destroyed: false, listeners: []
    };

    function on(el, ev, fn) { el.addEventListener(ev, fn); S.listeners.push([el, ev, fn]); }
    function show(el, yes) { el.classList[yes ? 'remove' : 'add']('hidden'); }
    var toastTimer = null;
    function toast(msg) {
      R.toast.textContent = msg; show(R.toast, true);
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { show(R.toast, false); }, 3200);
    }
    function setSaveState(kind, text) { R.saveState.className = 'save-state ' + kind; R.saveState.querySelector('.txt').textContent = text; }

    /* ---------------------------------------------------------- project */

    function startAutosave() {
      if (S.auto) { S.auto.stop(); S.auto = null; }
      if (!S.autosave || !S.p) { setSaveState('', 'Saved by the host'); return; }
      var p = S.p;
      S.auto = QD.autosave(p, {
        app: APP,
        onSave: function (ok, size) { if (ok) setSaveState('saved', 'Saved ' + QD.formatBytes(size)); else setSaveState('off', 'Not saved on this device'); }
      });
    }
    function saveNow() {
      if (!S.autosave || !S.p) return Promise.resolve(false);
      return S.auto ? S.auto.flush() : QD.store.save(S.p.name, S.p.export(APP), APP);
    }
    function use(p, why) {
      if (S.unsub) { S.unsub(); S.unsub = null; }
      if (S.auto) { S.auto.stop(); S.auto = null; }
      S.p = p;
      S.unsub = p.onChange(function (kind) {
        if (kind === 'clinic') { renderMeter(); if (S.auto) setSaveState('dirty', 'Saving'); }
      });
      startAutosave();
      if (opts.onProject) { try { opts.onProject(p, why || 'open'); } catch (e) { /* host problem */ } }
      renderMeter();
      S.verifying = verify();
    }
    function replaceProject(np, why) {
      var old = S.p;
      use(np, why);
      if (old && old !== np && S.stored) old.close();
      return saveNow();
    }

    function verify() {
      var p = S.p;
      return verifyData(p).then(function (r) {
        if (p !== S.p) return r;
        S.integrity = r;
        renderBanner();
        R.verifyText.textContent = r.ok ? 'The practice data matches the original exactly (' + (r.method === 'sha256' ? 'SHA-256 fingerprint' : 'compared with a fresh copy') + ').'
          : r.problems.join(' ');
        return r;
      });
    }
    function rebuild() {
      var out = rebuildFrom(S.p);
      return replaceProject(out.project, 'rebuild').then(function () {
        toast('Practice data rebuilt. ' + plural(out.kept, 'exercise record') + ' kept.');
        render();
        return out;
      });
    }

    /* ---------------------------------------------------------- views */

    function progress() { return QDClinic.progress(S.p); }
    function exList() { return QDClinic.EXERCISES; }
    function idx(id) { for (var i = 0; i < exList().length; i += 1) if (exList()[i].id === id) return i; return -1; }
    function unitOf(id) { var ex = QDClinic.exercise(id); return ex ? QDClinic.UNITS[ex.unit - 1] : null; }
    function firstOpen(pr) {
      for (var i = 0; i < exList().length; i += 1) { var r = pr.byId[exList()[i].id]; if (!r || r.status !== 'solved') return exList()[i].id; }
      return null;
    }

    function renderMeter() {
      if (!S.p) return;
      var pr = progress();
      R.meterText.innerHTML = '<b>' + pr.solved + '</b> of ' + pr.total + ' solved';
      R.meterBar.style.width = Math.round(100 * pr.solved / pr.total) + '%';
    }

    function renderBanner() {
      var r = S.integrity;
      if (!r || r.ok) { show(R.banner, false); clear(R.banner); return; }
      R.banner.innerHTML = '<div><strong>The practice data has been changed</strong><p>' + esc(r.problems.slice(0, 4).join(' ')) +
        ' Answers are graded against this copy, so results may not match the exercises. Rebuilding restores the original data and keeps your progress.</p></div>' +
        '<div><button class="btn primary" type="button" data-qc-act="rebuild">Rebuild and keep progress</button></div>';
      show(R.banner, true);
    }

    function setView(v) {
      S.view = v;
      show(R.viewUnits, v === 'units'); show(R.viewEx, v === 'ex'); show(R.viewFinish, v === 'finish');
      if (opts.onView) { try { opts.onView(v, S.exId); } catch (e) { /* host problem */ } }
    }

    function statusTag(rec) {
      if (rec && rec.status === 'solved') return '<span class="st solved">Solved</span>';
      if (rec && rec.attempts) return '<span class="st tried">' + plural(rec.attempts, 'try', 'tries') + '</span>';
      return '<span class="st">New</span>';
    }

    function renderUnits() {
      var pr = progress(), h = '';
      QDClinic.UNITS.forEach(function (u, k) {
        var up = pr.units[k], open = S.openUnit === u.id, done = up.solved === up.total;
        h += '<div class="unit' + (open ? ' open' : '') + (done ? ' done' : '') + '" data-unit="' + u.id + '">' +
          '<button class="unit-h" type="button" data-qc-unit="' + u.id + '" aria-expanded="' + open + '">' +
          '<span class="unit-n">' + u.id + '</span>' +
          '<span class="unit-t"><b>' + esc(u.title) + '</b><span>' + esc(u.blurb) + '</span>' +
          '<span class="track"><span style="width:' + Math.round(100 * up.solved / up.total) + '%"></span></span></span>' +
          '<span class="unit-c"><b>' + up.solved + '</b> / ' + up.total + '</span></button>';
        if (open) {
          h += '<div class="exlist">';
          exList().filter(function (e) { return e.unit === u.id; }).forEach(function (e) {
            h += '<button class="exitem" type="button" data-qc-ex="' + e.id + '"><span class="id">' + e.id + '</span><span class="t">' + esc(e.title) + '</span>' + statusTag(pr.byId[e.id]) + '</button>';
          });
          h += '</div>';
        }
        h += '</div>';
      });
      R.units.innerHTML = h;
      var next = firstOpen(pr);
      R.btnNextUp.textContent = next ? (pr.solved || Object.keys(pr.byId).length ? 'Continue with ' + next : 'Start with 1.1') : 'See your totals';
      R.btnNextUp.setAttribute('data-target', next || '');
    }

    function renderTags(ex, rec) {
      var u = QDClinic.UNITS[ex.unit - 1];
      var t = '<span class="tag">Unit ' + u.id + DOT + esc(u.title) + '</span>';
      if (ex.ordered) t += '<span class="tag">Row order is graded</span>';
      t += statusTag(rec);
      R.exTags.innerHTML = t;
    }

    function answerUnlocked(rec) { return !!rec && (rec.status === 'solved' || rec.attempts >= SHOW_AFTER); }

    function renderExercise() {
      var ex = QDClinic.exercise(S.exId);
      if (!ex) { setView('units'); return; }
      var rec = progress().byId[ex.id], i = idx(ex.id), u = unitOf(ex.id);
      R.where.textContent = 'Exercise ' + ex.id + ' of ' + exList().length + DOT + u.title;
      R.exTitle.textContent = ex.id + '  ' + ex.title;
      renderTags(ex, rec);
      R.exPrompt.textContent = ex.prompt;
      if (S.tsql && ex.tsql) { R.tsqlNote.innerHTML = '<b>SQL Server</b>' + esc(ex.tsql); show(R.tsqlNote, true); }
      else show(R.tsqlNote, false);
      if (S.hints[ex.id]) { R.hintNote.innerHTML = '<b>Hint</b>' + esc(ex.hint); show(R.hintNote, true); }
      else show(R.hintNote, false);
      R.btnHint.disabled = !!S.hints[ex.id];
      var unlocked = answerUnlocked(rec);
      R.btnAnswer.disabled = !unlocked;
      R.btnAnswer.title = unlocked ? 'Show the reference answer' : 'Unlocks after ' + SHOW_AFTER + ' tries';
      R.btnAnswer.textContent = unlocked ? 'Show answer' : 'Show answer (' + Math.max(0, SHOW_AFTER - ((rec && rec.attempts) || 0)) + ' more)';
      var last = rec && rec.lastSql;
      show(R.btnLast, !!last && R.editor.value.trim() !== String(last).trim());
      if (S.answers[ex.id] && unlocked) {
        R.answerBox.innerHTML = '<strong>One correct answer</strong><pre class="answer">' + esc(ex.solution) + '</pre>' +
          '<p class="muted">Other queries that return the same rows pass too.</p><div class="acts"><button class="btn small" type="button" data-qc-act="useAnswer">Put it in the editor</button></div>';
        show(R.answerBox, true);
      } else show(R.answerBox, false);
      R.btnPrev.disabled = i <= 0;
      R.btnNext.textContent = i >= exList().length - 1 ? 'Totals' : 'Next';
      renderVerdict();
    }

    function gridHtml(res) {
      var n = Math.min(res.rows.length, 200);
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

    function renderResult(res, label) {
      if (!res) { show(R.result, false); clear(R.result); return; }
      var shown = Math.min(res.rows.length, 200);
      R.result.innerHTML = '<div class="result-head">' + esc(label) + DOT + '<b>' + plural(res.rows.length, 'row') + '</b>, ' + plural(res.columns.length, 'column') +
        (shown < res.rows.length ? DOT + 'showing the first ' + shown : '') + (res.truncated ? DOT + 'cut at the row limit' : '') + '</div>' +
        (res.columns.length ? gridHtml(res) : '<div class="muted" style="padding:0.9rem">No columns came back.</div>');
      show(R.result, true);
    }

    function renderVerdict() {
      var v = S.verdict;
      if (!v || v.exId !== S.exId) { show(R.verdict, false); clear(R.verdict); return; }
      var ex = QDClinic.exercise(v.exId), h = '';
      R.verdict.className = 'verdict ' + v.kind;
      if (v.kind === 'pass') {
        var i = idx(ex.id), last = i >= exList().length - 1;
        h = '<div><strong>Correct</strong><p>' + esc(ex.concept) + '</p></div>' +
          '<div class="acts"><button class="btn primary" type="button" data-qc-act="next">' + (last || progress().solved === exList().length ? 'See your totals' : 'Next exercise') + '</button></div>';
      } else if (v.kind === 'fail') {
        h = '<div><strong>Not yet</strong><p>' + esc(v.reason) + '</p></div>' +
          '<p class="muted">The expected answer has ' + plural(v.shape.columns, 'column') + ' and ' + plural(v.shape.rows, 'row') + '.' +
          (v.mine ? ' Yours has ' + plural(v.mine.columns, 'column') + ' and ' + plural(v.mine.rows, 'row') + '.' : '') + '</p>';
      } else if (v.kind === 'guard') {
        h = '<div><strong>Only reading is allowed here</strong><p>' + esc(v.reason) + '</p></div><p class="muted">The practice data cannot be changed from Query Clinic, so every exercise keeps working.</p>';
      } else {
        h = '<div><strong>' + esc(v.title) + '</strong><p>' + esc(v.reason) + '</p></div>';
      }
      R.verdict.innerHTML = h;
      show(R.verdict, true);
    }

    function renderFinish() {
      var pr = progress(), attempts = 0, first = 0;
      exList().forEach(function (e) { var r = pr.byId[e.id]; if (r) { attempts += r.attempts || 0; if (r.status === 'solved' && r.attempts === 1) first += 1; } });
      var all = pr.solved === pr.total;
      var h = '<div class="card"><div class="finish">' +
        (all ? '<div class="finish-art" aria-hidden="true">' + TROPHY + '</div><h1>Course complete.</h1><p class="lede">All forty exercises solved, from SELECT to window functions.</p>'
          : '<h1>Your totals so far.</h1><p class="lede">' + plural(pr.total - pr.solved, 'exercise') + ' still to solve.</p>') +
        '<div class="stats">' +
          '<div class="stat"><div class="v">' + pr.solved + '</div><div class="l">of ' + pr.total + ' solved</div></div>' +
          '<div class="stat"><div class="v">' + attempts + '</div><div class="l">checks made</div></div>' +
          '<div class="stat"><div class="v">' + first + '</div><div class="l">solved on the first try</div></div>' +
          '<div class="stat"><div class="v">' + pr.units.filter(function (u) { return u.solved === u.total; }).length + '</div><div class="l">of 10 units complete</div></div>' +
        '</div></div>' +
        '<table class="totals"><thead><tr><th>Unit</th><th class="n">Solved</th></tr></thead><tbody>' +
        QDClinic.UNITS.map(function (u, k) { return '<tr><td>' + u.id + DOT + esc(u.title) + '</td><td class="n">' + pr.units[k].solved + ' / ' + pr.units[k].total + '</td></tr>'; }).join('') +
        '</tbody></table>' +
        '<div class="list-foot"><button class="btn primary" type="button" data-qc-act="units">Back to the units</button>' +
        (all ? '' : '<button class="btn" type="button" data-qc-act="continue">Keep going</button>') + '</div></div>';
      R.viewFinish.innerHTML = h;
    }

    function renderTables() {
      var p = S.p, h = '';
      QDClinic.TABLES.forEach(function (t) {
        if (!p.hasTable(t)) { h += '<div class="muted">' + esc(t) + ' is missing. Rebuild the practice data in Settings.</div>'; return; }
        var cols = p.rows('PRAGMA table_info(' + t + ')'), n = p.scalar('SELECT count(*) FROM ' + t);
        var sample = p.query('SELECT * FROM ' + t + ' LIMIT 3', { history: false });
        h += '<details class="tbl" data-table="' + t + '"><summary>' + esc(t) + '<span>' + plural(n, 'row') + '</span></summary><div class="cols">' +
          cols.map(function (c) { return '<span class="col' + (c[1] === PK[t] || /_id$/.test(c[1]) ? ' key' : '') + '">' + esc(c[1]) + '<i>' + esc(String(c[2] || '').toLowerCase()) + '</i></span>'; }).join('') +
          '</div>' + gridHtml(sample) + '</details>';
      });
      R.tables.innerHTML = h;
    }

    function render() {
      if (!S.p) return;
      renderMeter();
      if (S.view === 'units') renderUnits();
      else if (S.view === 'ex') renderExercise();
      else renderFinish();
    }

    /* ---------------------------------------------------------- actions */

    function openExercise(id) {
      var ex = QDClinic.exercise(id);
      if (!ex) return;
      if (S.exId && S.view === 'ex') S.drafts[S.exId] = R.editor.value;
      S.exId = ex.id; S.openUnit = ex.unit;
      var rec = progress().byId[ex.id];
      R.editor.value = S.drafts[ex.id] != null ? S.drafts[ex.id] : (rec && rec.status === 'solved' && rec.lastSql ? rec.lastSql : '');
      S.verdict = null;
      renderResult(null);
      setView('ex');
      renderExercise();
      try { root.scrollIntoView({ block: 'start' }); } catch (e) { /* old browser */ }
    }
    function goUnits() { if (S.view === 'ex' && S.exId) S.drafts[S.exId] = R.editor.value; setView('units'); renderUnits(); }
    function goFinish() { if (S.view === 'ex' && S.exId) S.drafts[S.exId] = R.editor.value; renderFinish(); setView('finish'); }
    function step(d) {
      var i = idx(S.exId) + d;
      if (i < 0) return;
      if (i >= exList().length) { goFinish(); return; }
      openExercise(exList()[i].id);
    }
    function afterPass() {
      var pr = progress();
      if (pr.solved === pr.total) { goFinish(); return; }
      step(1);
    }

    function sqlText() { return R.editor.value.trim(); }

    function run() {
      var sql = sqlText();
      if (!sql) { S.verdict = { exId: S.exId, kind: 'info', title: 'Nothing to run', reason: 'Write a query in the box first.' }; renderVerdict(); return; }
      try {
        var res = S.p.query(sql, { maxRows: 20000 });
        S.verdict = { exId: S.exId, kind: 'info', title: 'Ran without grading', reason: 'Tap Check when you think the rows answer the question.' };
        renderResult(res, 'Run');
      } catch (e) {
        S.verdict = { exId: S.exId, kind: e.kind === 'guard' ? 'guard' : 'info', title: 'The query did not run', reason: e.message };
        renderResult(null);
      }
      renderVerdict();
    }

    function check() {
      var sql = sqlText(), ex = QDClinic.exercise(S.exId);
      if (!sql) { S.verdict = { exId: S.exId, kind: 'info', title: 'Nothing to check', reason: 'Write a query in the box first.' }; renderVerdict(); return; }
      var guard = QD.checkReadOnly(sql), out;
      try { out = QDClinic.check(S.p, ex.id, sql); }
      catch (e) { S.verdict = { exId: ex.id, kind: 'info', title: 'This exercise cannot be graded', reason: e.message + ' Rebuild the practice data in Settings.' }; renderVerdict(); return; }
      S.drafts[ex.id] = R.editor.value;
      if (out.ok) S.verdict = { exId: ex.id, kind: 'pass' };
      else if (!guard.ok) S.verdict = { exId: ex.id, kind: 'guard', reason: out.reason };
      else S.verdict = { exId: ex.id, kind: 'fail', reason: out.reason, shape: out.expectedShape, mine: out.result ? { columns: out.result.columns.length, rows: out.result.rows.length } : null };
      renderResult(out.result, out.ok ? 'Your answer' : 'Your rows');
      renderExercise();
    }

    function resetProgress() {
      QDClinic.resetProgress(S.p);
      S.drafts = {}; S.hints = {}; S.answers = {}; S.verdict = null;
      renderResult(null);
      saveNow();
      setView('units'); S.openUnit = null; render();
      toast('Progress cleared');
    }

    function restoreFile(file) {
      return QD.readFile(file, false).then(function (bytes) {
        var np;
        try { np = QD.open(bytes, QDClinic.PROJECT_NAME); } catch (e) { throw new Error(e.message); }
        var isClinic = np.getMeta('clinic_seed') || QDClinic.TABLES.every(function (t) { return np.hasTable(t); });
        if (!isClinic) { np.close(); throw new Error('That file is not a Query Clinic progress file.'); }
        var n = np.scalar('SELECT count(*) FROM _qd_clinic');
        return verifyData(np).then(function (r) {
          if (!r.ok) { var rb = rebuildFrom(np); np.close(); np = rb.project; }
          return replaceProject(np, 'restore').then(function () {
            S.drafts = {}; S.hints = {}; S.answers = {}; S.verdict = null;
            setView('units'); render();
            toast('Restored ' + plural(n, 'exercise record') + (r.ok ? '' : ', with the practice data rebuilt'));
          });
        });
      }).catch(function (e) { toast('Could not restore ' + file.name + '. ' + e.message); });
    }

    function download() {
      var bytes = S.p.export(APP);
      QD.download(bytes, 'query-clinic-progress.sqlite', 'application/vnd.sqlite3');
      if (S.auto) S.auto.flush();
      toast('Downloaded query-clinic-progress.sqlite (' + QD.formatBytes(bytes.length) + ')');
    }

    function openSheet(name) {
      if (name === 'schemaScrim') renderTables();
      if (name === 'setScrim') { R.setTsql.checked = S.tsql; R.btnReset.textContent = 'Reset progress'; R.btnReset.removeAttribute('data-armed'); }
      show(R[name], true);
    }
    function closeSheet(name) { show(R[name], false); }

    /* ---------------------------------------------------------- wiring */

    on(root, 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || !root.contains(b)) { if (e.target.classList && e.target.classList.contains('scrim')) show(e.target, false); return; }
      var a;
      if ((a = b.getAttribute('data-qc-close'))) closeSheet(a);
      else if ((a = b.getAttribute('data-qc-unit'))) { var u = parseInt(a, 10); S.openUnit = S.openUnit === u ? null : u; renderUnits(); }
      else if ((a = b.getAttribute('data-qc-ex'))) openExercise(a);
      else if ((a = b.getAttribute('data-qc-act'))) {
        if (a === 'rebuild') rebuild();
        else if (a === 'next') afterPass();
        else if (a === 'units') goUnits();
        else if (a === 'continue') { var nx = firstOpen(progress()); if (nx) openExercise(nx); }
        else if (a === 'useAnswer') { R.editor.value = QDClinic.exercise(S.exId).solution; renderExercise(); R.editor.focus(); }
      }
    });
    on(R.btnBack, 'click', goUnits);
    on(R.btnPrev, 'click', function () { step(-1); });
    on(R.btnNext, 'click', function () { step(1); });
    on(R.btnRun, 'click', run);
    on(R.btnCheck, 'click', check);
    on(R.btnHint, 'click', function () { S.hints[S.exId] = true; renderExercise(); });
    on(R.btnAnswer, 'click', function () { S.answers[S.exId] = true; renderExercise(); });
    on(R.btnLast, 'click', function () { var rec = progress().byId[S.exId]; if (rec && rec.lastSql) { R.editor.value = rec.lastSql; S.drafts[S.exId] = rec.lastSql; } renderExercise(); R.editor.focus(); });
    on(R.editor, 'input', function () { if (S.exId) S.drafts[S.exId] = R.editor.value; var rec = progress().byId[S.exId]; show(R.btnLast, !!(rec && rec.lastSql) && R.editor.value.trim() !== String(rec.lastSql).trim()); });
    on(R.editor, 'keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); check(); }
      else if (e.key === 'Tab' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        var el = R.editor, s = el.selectionStart, en = el.selectionEnd;
        el.value = el.value.slice(0, s) + '  ' + el.value.slice(en); el.selectionStart = el.selectionEnd = s + 2;
      }
    });
    on(R.btnNextUp, 'click', function () { var t = R.btnNextUp.getAttribute('data-target'); if (t) openExercise(t); else goFinish(); });
    on(R.btnTotals, 'click', goFinish);
    on(R.btnSchema, 'click', function () { openSheet('schemaScrim'); });
    on(R.btnGear, 'click', function () { openSheet('setScrim'); });
    on(R.setTsql, 'change', function () { S.tsql = R.setTsql.checked; lsSet(LS_TSQL, S.tsql ? '1' : '0'); if (S.view === 'ex') renderExercise(); });
    on(R.btnDownload, 'click', download);
    on(R.btnRestore, 'click', function () { R.fileIn.click(); });
    on(R.fileIn, 'change', function () { var f = R.fileIn.files[0]; R.fileIn.value = ''; if (f) { closeSheet('setScrim'); restoreFile(f); } });
    on(R.btnVerify, 'click', function () { R.verifyText.textContent = 'Checking'; verify().then(function (r) { toast(r.ok ? 'The practice data is intact' : 'The practice data has been changed'); }); });
    on(R.btnRebuild, 'click', function () { closeSheet('setScrim'); rebuild(); });
    on(R.btnReset, 'click', function () {
      if (R.btnReset.getAttribute('data-armed') !== '1') { R.btnReset.setAttribute('data-armed', '1'); R.btnReset.textContent = 'Tap again to clear all progress'; return; }
      closeSheet('setScrim'); resetProgress();
    });
    on(document, 'keydown', function (e) { if (e.key === 'Escape') { closeSheet('schemaScrim'); closeSheet('setScrim'); } });
    on(window, 'pagehide', function () { if (S.auto && S.p && S.p.isDirty()) S.auto.flush(); });

    /* ---------------------------------------------------------- start */

    var ready;
    if (opts.project) {
      use(opts.project, 'host');
      ready = Promise.resolve();
    } else {
      setSaveState('', 'Opening');
      ready = QD.store.load(QDClinic.PROJECT_NAME).then(function (rec) {
        var p = null;
        if (rec) { try { p = QD.open(rec.bytes, QDClinic.PROJECT_NAME); } catch (e) { p = null; } }
        var fresh = !p;
        if (fresh) p = QDClinic.createProject();
        use(p, fresh ? 'new' : 'open');
        if (fresh) saveNow(); else setSaveState('saved', 'Saved');
      });
    }
    ready = ready.then(function () { setView('units'); render(); return S.verifying; }).then(function () { return api; });

    var api = {
      root: root, ready: ready, state: S,
      project: function () { return S.p; },
      open: openExercise, units: goUnits, finish: goFinish,
      verify: verify, rebuild: rebuild, refresh: render,
      unmount: function () {
        if (S.destroyed) return;
        S.destroyed = true;
        S.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
        if (S.unsub) S.unsub();
        var done = S.auto && S.p && S.p.isDirty() ? S.auto.flush() : Promise.resolve();
        var a = S.auto; S.auto = null;
        return done.then(function () { if (a) a.stop(); if (S.stored && S.p) S.p.close(); clear(root); root.classList.remove('qc'); });
      }
    };
    return api;
  }

  window.QueryClinic = { mount: mount, verifyData: verifyData, rebuildFrom: rebuildFrom, PINNED: PINNED, VERSION: '1.0.0' };
})();

/* Learn tab, Day 200: the Query Clinic course in its own space. It opens or creates the stored project
 * named Query Clinic with its own autosave on entering, and unmounts on leaving, which flushes the
 * progress, removes its document and window listeners, and closes its project. The shell's project is
 * never touched. */
(function () {
  'use strict';
  QDeskTabs.learn = {
    title: 'Learn',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
    mount: function (root, ctx) {
      root.innerHTML = '<div class="tab-in"><div data-t="host"></div></div>';
      var host = root.querySelector('[data-t="host"]');
      var S = { app: null, closing: Promise.resolve() };
      return {
        activate: function () {
          if (S.app) return;
          S.closing.then(function () {
            if (S.app) return;
            try { S.app = window.QueryClinic.mount(host, {}); window.QueryClinic.app = S.app; }
            catch (e) { host.innerHTML = '<div class="fatal"><h1>The course did not start</h1><p>' + String(e.message).replace(/</g, '&lt;') + '</p></div>'; }
          });
        },
        deactivate: function () {
          var a = S.app;
          S.app = null;
          if (window.QueryClinic.app === a) window.QueryClinic.app = null;
          if (a) S.closing = Promise.resolve(a.unmount());
        },
        projectChanged: function () { /* Learn keeps its own project */ },
        stale: function () {},
        unmount: function () { var a = S.app; S.app = null; return a ? a.unmount() : Promise.resolve(); },
        state: S
      };
    }
  };
})();
