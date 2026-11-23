/* Load tab, from CSV Intake (AppADay 194): read CSV files into tables with every column typed, change a type
 * with a tap, coerce near misses, preview rows and remove tables. Day 200 adds the Relate banner and
 * Query this table, and creates a project named after the first file when none is open. */
(function () {
  'use strict';
  var PREVIEW_ROWS = 20;
  var TYPES = ['integer', 'real', 'boolean', 'date', 'datetime', 'text'];
  var TYPE_LABEL = { integer: 'Integer', real: 'Decimal', boolean: 'Yes or no', date: 'Date', datetime: 'Date and time', text: 'Text' };
  var DELIM_LABEL = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };
  var DOT = ' \u00b7 ';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function show(el, on) { el.classList[on ? 'remove' : 'add']('hidden'); }
  function plural(n, one, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? one : (many || one + 's')); }
  function tick() { return new Promise(function (r) { setTimeout(r, 30); }); }

  /* ================================================================ pipeline (194) */

  /** Bytes to text. Honors UTF-8, UTF-16 LE and BE byte order marks, guesses BOM-less UTF-16, and falls back to Windows-1252. */
  function decodeBytes(input) {
    var u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    function dec(label, bytes) { return new TextDecoder(label).decode(bytes); }
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return { text: dec('utf-8', u8.subarray(3)), encoding: 'UTF-8', bom: true };
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return { text: dec('utf-16le', u8.subarray(2)), encoding: 'UTF-16 LE', bom: true };
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return { text: dec('utf-16be', u8.subarray(2)), encoding: 'UTF-16 BE', bom: true };
    var n = Math.min(u8.length, 4000) & ~1, pairs = n / 2, even = 0, odd = 0, i;
    for (i = 0; i < n; i += 2) { if (u8[i] === 0) even += 1; if (u8[i + 1] === 0) odd += 1; }
    if (pairs >= 2) {
      if (odd > pairs * 0.4 && even < pairs * 0.05) return { text: dec('utf-16le', u8), encoding: 'UTF-16 LE', bom: false };
      if (even > pairs * 0.4 && odd < pairs * 0.05) return { text: dec('utf-16be', u8), encoding: 'UTF-16 BE', bom: false };
    }
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'UTF-8', bom: false }; }
    catch (e) { return { text: dec('windows-1252', u8), encoding: 'Windows-1252', bom: false }; }
  }

  function parseCsv(text) { return QD.parseCSV(text, { delimiter: QD.sniffDelimiter(text) }); }

  function normalizeHeaders(row) {
    var original = row.map(function (h) { return String(h == null ? '' : h).trim(); });
    var names = QD.uniqueNames(original.map(function (h, i) { return QD.cleanName(h, 'col_' + (i + 1)); }));
    return { original: original, names: names };
  }

  function inferColumn(values, dateOrder) {
    var r = QD.inferColumn(values, { dateOrder: dateOrder });
    r.ambiguous = (r.type === 'date' || r.type === 'datetime') && /ambiguous/i.test(r.note || '');
    r.leadingZero = /leading zeros/i.test(r.note || '');
    return r;
  }

  function scoreCoercion(values, type, dateOrder) {
    var n = 0, ok = 0, info = { type: type, dateOrder: dateOrder || 'mdy', money: type === 'real' };
    for (var i = 0; i < values.length; i += 1) {
      if (QD.isNullToken(values[i])) continue;
      n += 1;
      if (!QD.convertValue(values[i], info).bad) ok += 1;
    }
    var fit = n ? ok / n : 0;
    return { type: type, fit: fit, blanks: n - ok, eligible: n > 0 && fit >= 0.95 && ok < n };
  }

  function buildTables(fileName, decoded, dateOrder) {
    var parsed = parseCsv(decoded.text);
    if (!parsed.rows.length) throw new Error(fileName + ' is empty.');
    var head = parsed.rows[0], body = parsed.rows.slice(1), width = head.length, r, c;
    while (width > 1 && String(head[width - 1]).trim() === '') {
      var used = false;
      for (r = 0; r < body.length && !used; r += 1) if (width - 1 < body[r].length && String(body[r][width - 1]).trim() !== '') used = true;
      if (used) break;
      width -= 1;
    }
    if (width < head.length) {
      head = head.slice(0, width);
      body = body.map(function (row) { return row.length > width ? row.slice(0, width) : row; });
    }
    var hdr = normalizeHeaders(head), badRows = 0, shortRows = 0, firstBad = [];
    var flags = new Array(body.length);
    for (r = 0; r < body.length; r += 1) {
      if (body[r].length > width) { badRows += 1; flags[r] = 'bad'; if (firstBad.length < 5) firstBad.push(r + 2); }
      else if (body[r].length < width) { shortRows += 1; flags[r] = 'short'; }
    }
    var infer = [];
    for (c = 0; c < width; c += 1) {
      var vals = new Array(body.length);
      for (r = 0; r < body.length; r += 1) vals[r] = body[r][c];
      infer.push(inferColumn(vals, dateOrder));
    }
    return {
      fileName: fileName, tableName: QD.cleanName(fileName, 'table'), headers: hdr.original, names: hdr.names, rows: body,
      rowFlags: flags, badRows: badRows, shortRows: shortRows, firstBadLines: firstBad, delimiter: parsed.delimiter,
      encoding: decoded.encoding, bom: decoded.bom, infer: infer, types: {}, dateOrder: dateOrder, bytes: 0
    };
  }

  function sizeVerdict(bytes, fileName) {
    var phone = QD.isPhone(), lim = phone ? QD.LIMITS.phone : QD.LIMITS.desktop, level = QD.sizeVerdict(bytes);
    var where = phone ? 'this phone' : 'a computer', size = QD.formatBytes(bytes), name = fileName || 'This file';
    var msg = '';
    if (level === 'refuse') {
      msg = name + ' is ' + size + '. The limit on ' + where + ' is ' + QD.formatBytes(lim.max) + ', so it was not loaded. ' +
        (phone ? 'Split it into smaller files, or open it on a computer, where the limit is ' + QD.formatBytes(QD.LIMITS.desktop.max) + '.' : 'Split it into smaller files and load them one at a time.');
    } else if (level === 'warn') {
      msg = name + ' is ' + size + '. Files over ' + QD.formatBytes(lim.warn) + ' can slow ' + where + ' down or close the tab.';
    }
    return { level: level, phone: phone, limit: lim, bytes: bytes, message: msg };
  }

  function loadIntoSqlite(project, staged, opts) {
    var o = opts || {};
    return project.loadTable(staged.headers, staged.rows, {
      tableName: o.tableName || staged.tableName, fileName: staged.fileName, types: staged.types,
      dateOrder: staged.dateOrder, replace: !!o.replace
    });
  }

  function affinityType(decl) {
    var d = String(decl || '').toUpperCase();
    if (/INT/.test(d)) return 'integer';
    if (/REAL|FLOA|DOUB|NUM|DEC/.test(d)) return 'real';
    if (/BOOL/.test(d)) return 'boolean';
    if (/DATETIME|TIMESTAMP/.test(d)) return 'datetime';
    if (/DATE/.test(d)) return 'date';
    return 'text';
  }

  var TEMPLATE =
    '<div class="tab-in">' +
    '<div data-t="strip" class="strip" aria-live="polite"></div>' +
    '<section data-t="empty" class="empty hidden">' +
      '<div class="empty-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6M12 10v10"/></svg></div>' +
      '<h1>Spreadsheets in, database out.</h1>' +
      '<p class="lede">Load one or more CSV files and each becomes a table in a real SQLite database. Every column is read as a number, date, yes or no, or text, and you can change any of them. Nothing leaves this device.</p>' +
      '<div class="cta">' +
        '<button data-t="btnSample" class="btn primary" type="button">Load sample data</button>' +
        '<button data-t="btnPickEmpty" class="btn" type="button">Choose CSV files</button>' +
        '<button data-t="btnOpenEmpty" class="btn" type="button">Open a saved project</button>' +
      '</div>' +
      '<div class="facts">' +
        '<div class="fact"><b>ZIP codes stay intact</b>Digits with leading zeros are kept as text, never turned into numbers.</div>' +
        '<div class="fact"><b>Excel exports welcome</b>Byte order marks, semicolons, tabs and UTF-16 files are all read correctly.</div>' +
        '<div class="fact"><b>Then connect them</b>With two or more tables, Relate works out how they join.</div>' +
      '</div>' +
    '</section>' +
    '<section data-t="loaded" class="hidden">' +
      '<div class="drop">' +
        '<div class="hint"><b>Add more CSV files.</b> Drop them here or choose them. Each file becomes its own table.</div>' +
        '<button data-t="btnPick" class="btn primary" type="button">Choose CSV files</button>' +
      '</div>' +
      '<div data-t="relateBanner" class="notice ok relate-banner hidden"><div class="msg"><strong>Find how these tables connect</strong><span data-t="relateText"></span></div>' +
        '<div class="acts"><button data-t="btnRelate" class="btn small primary" type="button">Find connections</button></div></div>' +
      '<p data-t="summaryLine" class="summary-line"></p>' +
      '<div data-t="cards" class="cards"></div>' +
    '</section>' +
    '</div>' +
    '<input data-t="fileCsv" class="sr" type="file" accept=".csv,.tsv,.txt,.tab,text/csv,text/plain" multiple tabindex="-1" aria-hidden="true">';

  QDeskTabs.load = {
    title: 'Load',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>',
    mount: function (root, ctx) {
      root.innerHTML = TEMPLATE;
      var $ = function (name) { return root.querySelector('[data-t="' + name + '"]'); };
      var S = { p: null, sources: {}, results: {}, notices: [], busy: false, busyText: '', active: false, dirty: true };
      var listeners = [], noticeSeq = 0;
      function on(el, ev, fn, o) { el.addEventListener(ev, fn, o); listeners.push([el, ev, fn, o]); }

      /* ================================================================ intake */

      function addNotice(n) { S.notices.push(n); renderStrip(); }
      function dropNotice(id) { S.notices = S.notices.filter(function (n) { return n.id !== id; }); renderStrip(); }

      function ensureProject(files) {
        if (S.p) return Promise.resolve(S.p);
        var base = String(files[0].name || 'Untitled project').replace(/\.(csv|tsv|txt|tab)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Untitled project';
        return ctx.newProject(base.charAt(0).toUpperCase() + base.slice(1)).then(function (p) { useProject(p); return p; });
      }

      function handleFiles(list) {
        var files = Array.prototype.slice.call(list || []);
        if (!files.length) return Promise.resolve();
        var dbs = files.filter(function (f) { return /\.(sqlite3?|db)$/i.test(f.name); });
        if (dbs.length) return ctx.openDbFile(dbs[0]);
        S.notices = S.notices.filter(function (n) { return n.level === 'warn' && n.file; });
        var queue = [];
        files.forEach(function (f) {
          if (/\.(xlsx|xlsm|xls|ods|numbers)$/i.test(f.name)) {
            addNotice({ level: 'refuse', title: f.name + ' is a spreadsheet, not a CSV', text: 'In Excel or Sheets, use Save As or Download and choose CSV, then load that file.' });
            return;
          }
          var v = sizeVerdict(f.size, f.name);
          if (v.level === 'refuse') addNotice({ level: 'refuse', title: 'Too large for ' + (v.phone ? 'this phone' : 'the browser'), text: v.message });
          else if (v.level === 'warn') { noticeSeq += 1; addNotice({ id: 'w' + noticeSeq, level: 'warn', title: 'Large file', text: v.message + ' Load it anyway?', file: f }); }
          else queue.push(f);
        });
        if (!queue.length) { render(); return Promise.resolve(); }
        return ensureProject(queue).then(function () { return ingest(queue); });
      }

      function ingest(files) {
        if (!files.length) return Promise.resolve();
        var order = ctx.dateOrder(), loaded = [], chain = Promise.resolve();
        files.forEach(function (f) {
          chain = chain.then(function () {
            setBusy('Reading ' + f.name);
            return tick().then(function () { return QD.readFile(f, false); }).then(function (bytes) {
              return ingestBytes(f.name, bytes, order);
            }).then(function (res) { if (res) loaded.push(res); })
              .catch(function (e) { addNotice({ level: 'refuse', title: 'Could not load ' + f.name, text: e.message }); });
          });
        });
        return chain.then(function () {
          setBusy(null);
          if (loaded.length) {
            var rows = loaded.reduce(function (a, r) { return a + r.rowCount; }, 0);
            addNotice({ level: 'ok', title: plural(loaded.length, 'table') + ' loaded', text: plural(rows, 'row') + ' in all. Check the column types below and tap any chip to change one.', auto: true });
            ctx.saveNow();
          }
          render();
        });
      }

      function ingestBytes(fileName, bytes, order) {
        var staged = buildTables(fileName, decodeBytes(bytes), order);
        staged.bytes = bytes.length;
        var res = loadIntoSqlite(S.p, staged);
        staged.tableName = res.table;
        S.sources[res.table] = staged;
        S.results[res.table] = res;
        return tick().then(function () { return res; });
      }

      function reloadTable(table, newName) {
        var staged = S.sources[table];
        if (!staged) return null;
        var target = newName ? QD.cleanName(newName, table) : table;
        try {
          var res;
          if (target === table) res = loadIntoSqlite(S.p, staged, { tableName: table, replace: true });
          else {
            res = loadIntoSqlite(S.p, staged, { tableName: target });
            S.p.dropTable(table);
            delete S.sources[table]; delete S.results[table];
          }
          staged.tableName = res.table;
          S.sources[res.table] = staged;
          S.results[res.table] = res;
          render();
          return res;
        } catch (e) { ctx.toast(e.message); render(); return null; }
      }

      /* ================================================================ render */

      function setBusy(text) { S.busy = !!text; S.busyText = text || ''; renderStrip(); }

      function renderStrip() {
        var el = $('strip'), html = '';
        if (S.busy) html += '<div class="notice busy"><div class="msg">' + esc(S.busyText) + '\u2026</div></div>';
        S.notices.forEach(function (n, i) {
          html += '<div class="notice ' + n.level + '"><div class="msg"><strong>' + esc(n.title) + '</strong>' + esc(n.text) + '</div><div class="acts">';
          if (n.level === 'warn' && n.file) {
            html += '<button class="btn small primary" type="button" data-go="' + esc(n.id) + '">Load anyway</button>' +
              '<button class="btn small" type="button" data-skip="' + esc(n.id) + '">Skip</button>';
          } else html += '<button class="btn small ghost" type="button" data-dismiss="' + i + '">Dismiss</button>';
          html += '</div></div>';
        });
        if (S.notices.some(function (n) { return n.level !== 'ok'; })) {
          var phone = QD.isPhone(), lim = phone ? QD.LIMITS.phone : QD.LIMITS.desktop;
          html += '<div class="limits-line">This ' + (phone ? 'phone' : 'computer') + ': warn above ' + QD.formatBytes(lim.warn) + ', refuse above ' + QD.formatBytes(lim.max) + '.</div>';
        }
        el.innerHTML = html;
      }

      function tableInfo(t) {
        var res = S.results[t], src = S.p.objects('SELECT * FROM _qd_sources WHERE table_name = ? ORDER BY id DESC LIMIT 1', [t])[0] || null;
        var meta = {};
        S.p.objects('SELECT * FROM _qd_columns WHERE table_name = ?', [t]).forEach(function (m) { meta[m.column_name] = m; });
        var cols = S.p.objects('PRAGMA table_info(' + QD.quoteIdent(t) + ')').map(function (c, i) {
          var m = meta[c.name] || {}, r = res ? res.columns[i] : null;
          var type = (r && r.type) || m.inferred_type || affinityType(c.type);
          return {
            name: c.name, originalHeader: (r && r.originalHeader) || m.original_header || c.name, type: type,
            note: r ? r.note : (m.note || ''), bad: r ? r.bad : (m.bad_count || 0), nearMiss: r ? r.nearMiss : null
          };
        });
        var rowCount = S.p.scalar('SELECT count(*) FROM ' + QD.quoteIdent(t));
        return {
          name: t, cols: cols, rowCount: rowCount, fileName: src ? src.file_name : null,
          badRows: res ? res.badRows : (src ? src.bad_rows : 0), badCells: res ? res.badCells : (src ? src.bad_cells : 0)
        };
      }

      function render() {
        S.dirty = false;
        var tables = S.p ? S.p.userTables() : [];
        show($('empty'), tables.length === 0);
        show($('loaded'), tables.length > 0);
        renderStrip();
        var cards = $('cards');
        cards.innerHTML = '';
        if (!tables.length) { show($('relateBanner'), false); return; }
        var total = 0;
        tables.forEach(function (t) {
          var info = tableInfo(t);
          total += info.rowCount;
          var wrap = document.createElement('article');
          wrap.className = 'card';
          wrap.setAttribute('data-table', t);
          wrap.innerHTML = cardHtml(info);
          cards.appendChild(wrap);
        });
        $('summaryLine').textContent = plural(tables.length, 'table') + DOT + plural(total, 'row') + DOT + 'one SQLite file';
        var conf = S.p.relations('confirmed').length;
        show($('relateBanner'), tables.length >= 2);
        $('relateText').textContent = conf ? plural(conf, 'confirmed relationship') + ' so far. Relate shows the rest and draws the diagram.' :
          'Relate profiles every column and proposes the keys and the links between these ' + tables.length + ' tables, with its reasons.';
      }

      function cardHtml(info) {
        var t = info.name, staged = S.sources[t], editable = !!staged, h = '', sfx = Math.random().toString(36).slice(2, 7);
        h += '<div class="card-head"><div class="tname-wrap"><label class="sr" for="tn-' + sfx + '">Table name</label>' +
          '<input class="tname" id="tn-' + sfx + '" data-rename="' + esc(t) + '" value="' + esc(t) + '"' + (editable ? '' : ' readonly title="Load the CSV again to rename this table"') +
          ' autocomplete="off" spellcheck="false" maxlength="60"></div>' +
          '<button class="btn small" type="button" data-query="' + esc(t) + '">Query this table</button>' +
          '<button class="btn small danger" type="button" data-remove="' + esc(t) + '">Remove table</button></div>';
        var bits = ['<span><b>' + info.rowCount.toLocaleString() + '</b> rows</span>', '<span><b>' + info.cols.length + '</b> columns</span>'];
        if (staged) {
          bits.push('<span>' + esc(DELIM_LABEL[staged.delimiter] || 'custom') + ' separated</span>');
          bits.push('<span>' + esc(staged.encoding) + (staged.bom ? ' with byte order mark' : '') + '</span>');
          bits.push('<span>' + esc(QD.formatBytes(staged.bytes)) + '</span>');
        }
        h += '<div class="card-meta">' + bits.join('') + '</div>';
        var flags = '';
        if (info.badRows) flags += '<span class="flag bad">' + plural(info.badRows, 'bad row') + ': extra cells were dropped' + (staged && staged.firstBadLines.length ? ' (line ' + staged.firstBadLines.join(', ') + (info.badRows > staged.firstBadLines.length ? ', and more' : '') + ')' : '') + '</span>';
        if (info.badCells) flags += '<span class="flag bad">' + plural(info.badCells, 'bad cell') + ': left empty because they did not fit the type</span>';
        if (staged && staged.shortRows) flags += '<span class="flag warn">' + plural(staged.shortRows, 'short row') + ' padded with empty cells</span>';
        if (!info.badRows && !info.badCells) flags += '<span class="flag good">Every row and cell fit</span>';
        h += '<div class="flags">' + flags + '</div>';

        h += '<div class="cols">';
        info.cols.forEach(function (c, i) {
          var forced = staged && staged.types[c.name], id = 'ty-' + sfx + '-' + i;
          h += '<div class="col"><div class="col-top"><span class="col-name" title="' + esc(c.name) + '">' + esc(c.name) +
            (c.originalHeader && c.originalHeader !== c.name ? '<span class="col-orig">from ' + esc(c.originalHeader) + '</span>' : '') + '</span>';
          h += '<label class="sr" for="' + id + '">Type of ' + esc(c.name) + '</label><select class="chip t-' + c.type + (forced ? ' forced' : '') + '" id="' + id + '" data-col="' + esc(c.name) + '"' + (editable ? '' : ' disabled title="Load the CSV again to change types"') + '>';
          TYPES.forEach(function (ty) { h += '<option value="' + ty + '"' + (ty === c.type ? ' selected' : '') + '>' + TYPE_LABEL[ty] + '</option>'; });
          h += '</select></div>';
          var note = colNote(c, staged);
          if (note) h += '<div class="col-note' + (c.bad ? ' bad' : '') + '">' + esc(note) + '</div>';
          var acts = '';
          if (staged && c.type === 'text' && c.nearMiss) {
            var sc = scoreCoercion(columnValues(staged, i), c.nearMiss.type, staged.dateOrder);
            if (sc.eligible) {
              acts += '<button class="btn small" type="button" data-coerce="' + esc(c.name) + '" data-to="' + c.nearMiss.type + '">Make ' + esc(TYPE_LABEL[c.nearMiss.type].toLowerCase()) +
                ' (' + plural(sc.blanks, 'value') + ' left empty)</button>';
            }
          }
          if (staged && (c.type === 'date' || c.type === 'datetime') && /ambiguous/i.test(c.note || '')) {
            acts += '<div class="seg" role="group" aria-label="Date order for ' + esc(t) + '">' +
              '<button type="button" data-order-t="mdy" aria-pressed="' + (staged.dateOrder !== 'dmy') + '">Month first</button>' +
              '<button type="button" data-order-t="dmy" aria-pressed="' + (staged.dateOrder === 'dmy') + '">Day first</button></div>';
          }
          if (acts) h += '<div class="col-acts">' + acts + '</div>';
          h += '</div>';
        });
        h += '</div>';
        h += previewHtml(info, staged);
        h += '<div class="card-foot"><span class="src">' + (info.fileName ? 'From ' + esc(info.fileName) : 'Table in this project') + '</span></div>';
        return h;
      }

      function columnValues(staged, i) {
        var out = new Array(staged.rows.length);
        for (var r = 0; r < staged.rows.length; r += 1) out[r] = staged.rows[r][i];
        return out;
      }

      function colNote(c, staged) {
        var note = c.note || '';
        if (/ambiguous/i.test(note) && staged) {
          var m = /values such as ([^ ]+?)\. Read/.exec(note);
          note = 'Day and month could be read either way' + (m ? ' in values such as ' + m[1] : '') + '. Read as ' + (staged.dateOrder === 'dmy' ? 'day first' : 'month first') + '.';
        }
        if (c.bad) note = (note ? note + ' ' : '') + plural(c.bad, 'value') + ' did not fit and ' + (c.bad === 1 ? 'was' : 'were') + ' left empty.';
        return note;
      }

      function previewHtml(info, staged) {
        var t = info.name, res;
        try { res = S.p.query('SELECT * FROM ' + QD.quoteIdent(t) + ' ORDER BY rowid LIMIT ' + PREVIEW_ROWS, { history: false }); }
        catch (e) { res = S.p.query('SELECT * FROM ' + QD.quoteIdent(t) + ' LIMIT ' + PREVIEW_ROWS, { history: false }); }
        var h = '<div class="preview-wrap"><div class="preview-head"><span>First ' + Math.min(PREVIEW_ROWS, info.rowCount) + ' of ' + info.rowCount.toLocaleString() + ' rows</span>' +
          (staged ? '<span>Crossed out cells did not fit their type</span>' : '') + '</div><div class="grid-scroll"><table class="grid"><thead><tr><th class="rn">#</th>';
        info.cols.forEach(function (c) { h += '<th>' + esc(c.name) + '<small style="color:var(--t-' + c.type + ')">' + esc(TYPE_LABEL[c.type]) + '</small></th>'; });
        h += '</tr></thead><tbody>';
        res.rows.forEach(function (row, r) {
          var flag = staged ? staged.rowFlags[r] : null;
          h += '<tr' + (flag === 'bad' ? ' class="badrow" title="This row had extra cells, which were dropped"' : (flag === 'short' ? ' class="shortrow" title="This row was short and was padded"' : '')) + '><td class="rn">' + (r + 1) + '</td>';
          row.forEach(function (v, c) {
            var raw = staged && staged.rows[r] ? staged.rows[r][c] : undefined;
            if (v === null && raw !== undefined && !QD.isNullToken(raw)) h += '<td class="badcell" title="Did not fit ' + esc(TYPE_LABEL[info.cols[c].type]) + '">' + esc(raw) + '</td>';
            else if (v === null) h += '<td class="null">empty</td>';
            else {
              var ty = info.cols[c].type, shown = v;
              if (ty === 'boolean') shown = v === 1 ? 'yes' : (v === 0 ? 'no' : v);
              h += '<td' + (typeof v === 'number' ? ' class="num"' : '') + '>' + esc(shown) + '</td>';
            }
          });
          h += '</tr>';
        });
        return h + '</tbody></table></div></div>';
      }

      /* ================================================================ events */

      function pick() { $('fileCsv').click(); }
      on($('fileCsv'), 'change', function (e) { var f = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; handleFiles(f); });

      on(root, 'click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        var a, t = b.getAttribute('data-t');
        if (t === 'btnPick' || t === 'btnPickEmpty') pick();
        else if (t === 'btnSample') ctx.loadSample();
        else if (t === 'btnOpenEmpty') ctx.openProjects();
        else if (t === 'btnRelate') ctx.goTo('relate', { analyze: true });
        else if ((a = b.getAttribute('data-dismiss')) !== null) { S.notices.splice(+a, 1); renderStrip(); }
        else if ((a = b.getAttribute('data-go'))) {
          var n = S.notices.filter(function (x) { return x.id === a; })[0];
          dropNotice(a); if (n) ensureProject([n.file]).then(function () { return ingest([n.file]); });
        }
        else if ((a = b.getAttribute('data-skip'))) dropNotice(a);
        else if ((a = b.getAttribute('data-query'))) ctx.goTo('query', { sql: 'SELECT * FROM ' + QD.quoteIdent(a) + ' LIMIT 100', run: true });
        else if ((a = b.getAttribute('data-remove'))) {
          if (b.getAttribute('data-armed') !== '1') {
            b.setAttribute('data-armed', '1'); b.textContent = 'Tap again to remove';
            setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-armed'); b.textContent = 'Remove table'; } }, 3000);
            return;
          }
          S.p.dropTable(a); delete S.sources[a]; delete S.results[a]; render(); ctx.toast('Removed ' + a);
        }
        else if ((a = b.getAttribute('data-coerce'))) {
          var tc = b.closest('.card').getAttribute('data-table');
          S.sources[tc].types[a] = b.getAttribute('data-to');
          reloadTable(tc); ctx.toast(a + ' is now ' + TYPE_LABEL[b.getAttribute('data-to')].toLowerCase());
        }
        else if ((a = b.getAttribute('data-order-t'))) {
          var tt = b.closest('.card').getAttribute('data-table');
          if (S.sources[tt].dateOrder !== a) { S.sources[tt].dateOrder = a; reloadTable(tt); }
        }
      });

      on(root, 'change', function (e) {
        var sel = e.target;
        if (sel.matches && sel.matches('select.chip')) {
          var t = sel.closest('.card').getAttribute('data-table'), col = sel.getAttribute('data-col'), staged = S.sources[t];
          if (!staged) return;
          var inferred = staged.infer[staged.names.indexOf(col)];
          if (inferred && inferred.type === sel.value) delete staged.types[col]; else staged.types[col] = sel.value;
          var res = reloadTable(t);
          if (res) {
            var c = res.columns.filter(function (x) { return x.name === col; })[0];
            ctx.toast(col + ' is ' + TYPE_LABEL[sel.value].toLowerCase() + (c && c.bad ? DOT + plural(c.bad, 'value') + ' did not fit' : ''));
          }
        } else if (sel.matches && sel.matches('input.tname') && !sel.readOnly) {
          var from = sel.getAttribute('data-rename'), to = QD.cleanName(sel.value, from);
          if (to !== from) { var rr = reloadTable(from, to); if (rr) ctx.toast('Renamed to ' + rr.table); }
          else sel.value = from;
        }
      });
      on(root, 'keydown', function (e) { if (e.key === 'Enter' && e.target.matches && e.target.matches('input.tname')) e.target.blur(); });

      var depth = 0;
      function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
      on(root, 'dragenter', function (e) { if (hasFiles(e)) { depth += 1; root.classList.add('dragging'); e.preventDefault(); } });
      on(root, 'dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) root.classList.remove('dragging'); });
      on(root, 'dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
      on(root, 'drop', function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault(); depth = 0; root.classList.remove('dragging');
        handleFiles(e.dataTransfer.files);
      });

      /* ========================================================= the component */

      function useProject(p) {
        if (S.p !== p) { S.sources = {}; S.results = {}; S.notices = S.notices.filter(function (n) { return n.level === 'refuse'; }); }
        S.p = p;
        S.dirty = true;
        if (S.active) render();
      }
      useProject(ctx.project());

      return {
        activate: function () { S.active = true; if (S.p !== ctx.project()) useProject(ctx.project()); if (S.dirty) render(); },
        deactivate: function () { S.active = false; S.notices = S.notices.filter(function (n) { return n.level !== 'ok'; }); },
        projectChanged: function (p) { useProject(p); },
        stale: function () { S.dirty = true; if (S.active) render(); },
        unmount: function () { listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); }); root.innerHTML = ''; },
        addFiles: function (files) { return handleFiles(files); },
        pick: pick,
        state: S,
        intake: { decodeBytes: decodeBytes, buildTables: buildTables, sizeVerdict: sizeVerdict }
      };
    }
  };
})();
