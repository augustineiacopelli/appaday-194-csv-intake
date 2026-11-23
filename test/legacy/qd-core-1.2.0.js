/* QD:CORE BEGIN v1.2.0 */
/*
 * Query Desk shared core. One classic script, no dependencies of its own.
 * It expects the sql.js loader (initSqlJs) to be present, or passed to QD.boot.
 * Vendored unchanged into AppADay 194 to 200. Do not edit a vendored copy:
 * edit core/qd-core.js, run the tests, then re-vendor.
 *
 * Nothing in this file runs at load time except the definition of globalThis.QD.
 * ASCII only. No Claude model ID appears here: models come from window.AppModels.
 */
(function (root) {
  'use strict';

  var QD = {};
  QD.VERSION = '1.2.0';
  QD.FORMAT_VERSION = 1;
  QD.SQLJS_VERSION = '1.16.0';
  QD.SQLJS_CDN = 'https://cdn.jsdelivr.net/npm/sql.js@' + QD.SQLJS_VERSION + '/dist/';
  QD.PREFIX = '_qd_';

  /* Limits in bytes of CSV text or database file, set on Day 194. CSV Intake warns at warn and refuses at max. */
  QD.LIMITS = {
    phone: { warn: 10 * 1048576, max: 15 * 1048576 },
    desktop: { warn: 40 * 1048576, max: 80 * 1048576 },
    resultRows: 5000,
    cellChars: 2000
  };

  var SQL = null;

  /* ------------------------------------------------------------------ boot */

  /**
   * Load the SQLite engine once. In the browser, call QD.boot() after the sql.js script tag.
   * In Node tests, call QD.boot(require('sql.js')).
   */
  QD.boot = function (initFn, opts) {
    if (SQL) return Promise.resolve(SQL);
    var init = initFn || root.initSqlJs;
    if (typeof init !== 'function') {
      return Promise.reject(new Error('QD.boot: the sql.js loader is missing'));
    }
    var cfg = opts || {};
    if (!cfg.locateFile && typeof root.document !== 'undefined') {
      cfg.locateFile = function (f) { return QD.SQLJS_CDN + f; };
    }
    return init(cfg).then(function (S) { SQL = S; return S; });
  };

  QD.ready = function () { return !!SQL; };

  function needEngine() {
    if (!SQL) throw new Error('QD: call QD.boot() before using a project');
  }

  /* ----------------------------------------------------------- identifiers */

  QD.quoteIdent = function (name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  };

  QD.quoteText = function (s) {
    return "'" + String(s).replace(/'/g, "''") + "'";
  };

  var RESERVED = {};
  ('abort action add after all alter always analyze and as asc attach autoincrement before begin between by ' +
   'cascade case cast check collate column commit conflict constraint create cross current current_date ' +
   'current_time current_timestamp database default deferrable deferred delete desc detach distinct do drop ' +
   'each else end escape except exclude exclusive exists explain fail filter first following for foreign from ' +
   'full generated glob group groups having if ignore immediate in index indexed initially inner insert instead ' +
   'intersect into is isnull join key last left like limit match materialized natural no not nothing notnull ' +
   'null nulls of offset on or order others outer over partition plan pragma preceding primary query raise ' +
   'range recursive references regexp reindex release rename replace restrict returning right rollback row ' +
   'rows savepoint select set table temp temporary then ties to transaction trigger unbounded union unique ' +
   'update using vacuum values view virtual when where window with without').split(' ').forEach(function (w) {
    RESERVED[w] = true;
  });

  /**
   * Turn any header or file name into a safe snake_case SQL name.
   * Never returns an empty string, a reserved word, a name starting with a digit,
   * or a name starting with the reserved _qd_ or sqlite_ prefixes.
   */
  QD.cleanName = function (raw, fallback) {
    var s = String(raw == null ? '' : raw);
    s = s.replace(/\.[A-Za-z0-9]{1,5}$/, function (ext) {
      return /^\.(csv|tsv|txt|tab|dat)$/i.test(ext) ? '' : ext;
    });
    s = s.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    s = s.replace(/%/g, ' pct ').replace(/#/g, ' num ').replace(/&/g, ' and ').replace(/\$/g, ' usd ');
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) s = fallback || 'col';
    if (/^[0-9]/.test(s)) s = 'n_' + s;
    if (RESERVED[s]) s = s + '_';
    if (s.indexOf('qd_') === 0 || s.indexOf('sqlite_') === 0) s = 'x_' + s;
    if (s.length > 60) s = s.slice(0, 60).replace(/_+$/, '');
    return s;
  };

  /** Make every name in the list unique by appending _2, _3 and so on. Input order is kept. */
  QD.uniqueNames = function (names, taken) {
    var seen = {};
    (taken || []).forEach(function (t) { seen[String(t).toLowerCase()] = true; });
    return names.map(function (n) {
      var base = n, k = 1, out = n;
      while (seen[out.toLowerCase()]) { k += 1; out = base + '_' + k; }
      seen[out.toLowerCase()] = true;
      return out;
    });
  };

  /* -------------------------------------------------------------------- CSV */

  /** Pick the delimiter that splits the first lines most consistently. */
  QD.sniffDelimiter = function (text) {
    var sample = text.slice(0, 20000);
    var cands = [',', '\t', ';', '|'];
    var best = ',', bestScore = -1;
    cands.forEach(function (d) {
      var rows = QD.parseCSV(sample, { delimiter: d, maxRows: 25 }).rows;
      if (rows.length < 1) return;
      var counts = rows.map(function (r) { return r.length; });
      var first = counts[0];
      if (first < 2) return;
      var same = counts.filter(function (c) { return c === first; }).length;
      var score = (same / counts.length) * 1000 + first;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  };

  /**
   * RFC 4180 style parser. Handles quoted fields, doubled quotes, embedded newlines,
   * CRLF, LF and bare CR line ends, and a leading byte order mark.
   * Returns { rows: string[][], delimiter, truncated }. Fully blank lines are skipped.
   */
  QD.parseCSV = function (text, opts) {
    var o = opts || {};
    var s = String(text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var d = o.delimiter || QD.sniffDelimiter(s);
    var maxRows = o.maxRows || Infinity;
    var rows = [], row = [], field = '', inQ = false, i = 0, n = s.length, c, sawQuote = false;
    var truncated = false;
    function endField() { row.push(field); field = ''; sawQuote = false; }
    function endRow() {
      endField();
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    }
    while (i < n) {
      c = s[i];
      if (inQ) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i += 1; continue;
        }
        field += c; i += 1; continue;
      }
      if (c === '"' && field === '' && !sawQuote) { inQ = true; sawQuote = true; i += 1; continue; }
      if (c === d) { endField(); i += 1; continue; }
      if (c === '\r') {
        endRow();
        i += (s[i + 1] === '\n') ? 2 : 1;
        if (rows.length >= maxRows) { truncated = i < n; break; }
        continue;
      }
      if (c === '\n') {
        endRow(); i += 1;
        if (rows.length >= maxRows) { truncated = i < n; break; }
        continue;
      }
      field += c; i += 1;
    }
    if (!truncated && (field !== '' || row.length > 0 || sawQuote)) endRow();
    return { rows: rows, delimiter: d, truncated: truncated };
  };

  /* --------------------------------------------------------- type inference */

  var NULL_TOKENS = { '': 1, 'na': 1, 'n/a': 1, 'null': 1, 'none': 1, 'nan': 1, '-': 1, '--': 1, '#n/a': 1, '?': 1 };
  QD.isNullToken = function (v) {
    if (v == null) return true;
    return NULL_TOKENS[String(v).trim().toLowerCase()] === 1;
  };

  var RE_INT = /^[+-]?\d+$/;
  var RE_REAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  var RE_MONEY = /^\(?[+-]?\s*[$]?\s*[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?\s*%?\)?$/;
  var RE_ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  var RE_ISO_DT = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
  var RE_SLASH = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;
  var BOOL_TRUE = { 'true': 1, 't': 1, 'yes': 1, 'y': 1 };
  var BOOL_FALSE = { 'false': 1, 'f': 1, 'no': 1, 'n': 1 };

  function pad2(x) { return (x < 10 ? '0' : '') + x; }
  function validYMD(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return false;
    var dim = [31, ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= dim[m - 1];
  }

  /** Integers that are safe to store as INTEGER: no leading zeros (those are codes), and inside the JS safe range. */
  function isCleanInt(v) {
    if (!RE_INT.test(v)) return false;
    var digits = v.replace(/^[+-]/, '');
    if (digits.length > 1 && digits[0] === '0') return false;
    if (digits.length > 15) return false;
    return true;
  }
  function isCleanReal(v) {
    if (!RE_REAL.test(v)) return false;
    if (RE_INT.test(v)) return false; /* an integer that failed isCleanInt is a code or too long for a number */
    var digits = v.replace(/^[+-]/, '');
    if (/^0\d/.test(digits)) return false;
    return isFinite(Number(v));
  }
  function parseMoney(v) {
    if (!RE_MONEY.test(v)) return null;
    if (RE_INT.test(v) && !isCleanInt(v)) return null;
    var neg = /^\(.*\)$/.test(v) || /-/.test(v);
    var num = Number(v.replace(/[()$,%\s+-]/g, ''));
    if (!isFinite(num)) return null;
    return neg ? -num : num;
  }
  /** Returns the ISO form, or null. order is 'mdy' or 'dmy' for slash dates. */
  function parseDateLike(v, order) {
    var m = RE_ISO_DATE.exec(v);
    if (m) {
      return validYMD(+m[1], +m[2], +m[3]) ? { iso: m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]), time: false } : null;
    }
    m = RE_ISO_DT.exec(v);
    if (m) {
      if (!validYMD(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59) return null;
      return {
        iso: m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) + ' ' + pad2(+m[4]) + ':' + m[5] + ':' + (m[6] || '00'),
        time: true
      };
    }
    m = RE_SLASH.exec(v);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (m[3].length === 2) y += (y < 70 ? 2000 : 1900);
      var mo = order === 'dmy' ? b : a, da = order === 'dmy' ? a : b;
      if (!validYMD(y, mo, da)) return null;
      var iso = y + '-' + pad2(mo) + '-' + pad2(da);
      if (m[4] === undefined) return { iso: iso, time: false };
      var hh = +m[4], mi = +m[5];
      if (m[7]) {
        var pm = /p/i.test(m[7]);
        if (hh < 1 || hh > 12) return null;
        hh = (hh % 12) + (pm ? 12 : 0);
      }
      if (hh > 23 || mi > 59) return null;
      return { iso: iso + ' ' + pad2(hh) + ':' + m[5] + ':' + (m[6] || '00'), time: true };
    }
    return null;
  }

  /**
   * Infer one column from its raw string values.
   * Types: integer, real, boolean, date, datetime, text.
   * Strict by default: a type is chosen only when every non-null value fits.
   * The result also reports the best near miss so the interface can offer a coercion.
   *
   * Returns { type, nulls, count, dateOrder, money, nearMiss: {type, fit, misfits: [..5]} | null, note }
   */
  QD.inferColumn = function (values, opts) {
    var o = opts || {};
    var tolerance = o.tolerance || 0;
    var n = 0, nulls = 0;
    var fit = { integer: 0, real: 0, money: 0, boolean: 0, mdy: 0, dmy: 0, isoish: 0, time: 0, zeroLead: 0 };
    var miss = { integer: [], real: [], boolean: [], date: [] };
    var bool01 = true, i, v, t;
    for (i = 0; i < values.length; i += 1) {
      v = values[i];
      if (QD.isNullToken(v)) { nulls += 1; continue; }
      v = String(v).trim();
      n += 1;
      if (isCleanInt(v)) { fit.integer += 1; fit.real += 1; if (v !== '0' && v !== '1') bool01 = false; }
      else {
        bool01 = false;
        if (miss.integer.length < 5) miss.integer.push(v);
        if (isCleanReal(v)) fit.real += 1;
        else if (miss.real.length < 5) miss.real.push(v);
      }
      if (RE_INT.test(v) && /^[+-]?0\d/.test(v)) fit.zeroLead += 1;
      if (parseMoney(v) !== null) fit.money += 1;
      t = v.toLowerCase();
      if (BOOL_TRUE[t] || BOOL_FALSE[t]) fit.boolean += 1;
      else if (miss.boolean.length < 5) miss.boolean.push(v);
      var dm = parseDateLike(v, 'mdy'), dd = parseDateLike(v, 'dmy');
      if (dm) fit.mdy += 1;
      if (dd) fit.dmy += 1;
      if (!dm && !dd && miss.date.length < 5) miss.date.push(v);
      if ((dm && dm.time) || (dd && dd.time)) fit.time += 1;
    }
    var res = { type: 'text', nulls: nulls, count: n, dateOrder: null, money: false, nearMiss: null, note: '' };
    if (n === 0) { res.note = 'Every value is empty.'; return res; }
    var need = Math.ceil(n * (1 - tolerance));
    function near(type, got, misfits) {
      if (got < n && got / n >= 0.9 && (!res.nearMiss || got / n > res.nearMiss.fit)) {
        res.nearMiss = { type: type, fit: got / n, misfits: misfits };
      }
    }
    if (fit.boolean >= need && fit.boolean === n) { res.type = 'boolean'; return res; }
    if (fit.integer >= need) {
      res.type = 'integer';
      if (bool01 && n >= 2) res.note = 'Only 0 and 1 appear. This may be a yes or no flag.';
      return res;
    }
    if (fit.zeroLead > 0 && fit.zeroLead + fit.integer === n) {
      res.note = 'Digits with leading zeros are kept as text so codes such as ZIP codes stay intact.';
      return res;
    }
    if (fit.real >= need) { res.type = 'real'; return res; }
    var dateFit = Math.max(fit.mdy, fit.dmy);
    if (dateFit >= need) {
      res.dateOrder = (fit.dmy > fit.mdy) ? 'dmy' : 'mdy';
      if (fit.mdy === fit.dmy && o.dateOrder) res.dateOrder = o.dateOrder;
      res.type = fit.time > 0 ? 'datetime' : 'date';
      if (fit.mdy === n && fit.dmy === n && fit.time < n) {
        var sample = null;
        for (i = 0; i < values.length && !sample; i += 1) {
          if (!QD.isNullToken(values[i]) && RE_SLASH.test(String(values[i]).trim())) sample = String(values[i]).trim();
        }
        if (sample) res.note = 'Day and month are ambiguous in values such as ' + sample + '. Read as month first.';
      }
      return res;
    }
    if (fit.money >= need && fit.money === n) {
      res.type = 'real'; res.money = true;
      res.note = 'Currency symbols, commas, percent signs and accounting parentheses are stripped.';
      return res;
    }
    near('integer', fit.integer, miss.integer);
    near('real', fit.real, miss.real);
    near('date', dateFit, miss.date);
    near('boolean', fit.boolean, miss.boolean);
    if (res.nearMiss) {
      res.note = Math.round(res.nearMiss.fit * 1000) / 10 + ' percent of values look like ' + res.nearMiss.type +
        '. Kept as text because of values such as ' + res.nearMiss.misfits.slice(0, 3).join(', ') + '.';
    }
    return res;
  };

  /**
   * Convert one raw string to the value stored in SQLite for the given inferred column.
   * Values that do not fit the type become null and are counted by the caller.
   * Returns { v, bad }.
   */
  QD.convertValue = function (raw, info) {
    if (QD.isNullToken(raw)) return { v: null, bad: false };
    var v = String(raw).trim(), t;
    switch (info.type) {
      case 'integer':
        return isCleanInt(v) ? { v: Number(v), bad: false } : { v: null, bad: true };
      case 'real':
        if (info.money) { t = parseMoney(v); return t === null ? { v: null, bad: true } : { v: t, bad: false }; }
        return isCleanReal(v) ? { v: Number(v), bad: false } : { v: null, bad: true };
      case 'boolean':
        t = v.toLowerCase();
        if (BOOL_TRUE[t]) return { v: 1, bad: false };
        if (BOOL_FALSE[t]) return { v: 0, bad: false };
        return { v: null, bad: true };
      case 'date':
      case 'datetime':
        t = parseDateLike(v, info.dateOrder || 'mdy');
        if (!t) return { v: null, bad: true };
        return { v: (info.type === 'date') ? t.iso.slice(0, 10) : (t.time ? t.iso : t.iso + ' 00:00:00'), bad: false };
      default:
        return { v: String(raw), bad: false };
    }
  };

  var AFFINITY = { integer: 'INTEGER', real: 'REAL', boolean: 'INTEGER', date: 'TEXT', datetime: 'TEXT', text: 'TEXT' };
  QD.affinity = function (type) { return AFFINITY[type] || 'TEXT'; };

  /* ---------------------------------------------------------------- schema */

  var DDL = [
    'CREATE TABLE IF NOT EXISTS _qd_meta (key TEXT PRIMARY KEY, value TEXT)',
    'CREATE TABLE IF NOT EXISTS _qd_sources (id INTEGER PRIMARY KEY, table_name TEXT NOT NULL, file_name TEXT, ' +
      'row_count INTEGER, col_count INTEGER, bad_rows INTEGER DEFAULT 0, bad_cells INTEGER DEFAULT 0, ' +
      'loaded_at TEXT, options_json TEXT)',
    'CREATE TABLE IF NOT EXISTS _qd_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, ordinal INTEGER, ' +
      'original_header TEXT, inferred_type TEXT, null_count INTEGER, bad_count INTEGER DEFAULT 0, note TEXT, ' +
      'PRIMARY KEY (table_name, column_name))',
    'CREATE TABLE IF NOT EXISTS _qd_keys (id INTEGER PRIMARY KEY, table_name TEXT NOT NULL, columns_json TEXT NOT NULL, ' +
      "status TEXT NOT NULL DEFAULT 'proposed', score REAL, evidence_json TEXT, updated_at TEXT)",
    'CREATE TABLE IF NOT EXISTS _qd_relations (id INTEGER PRIMARY KEY, from_table TEXT NOT NULL, from_columns_json TEXT NOT NULL, ' +
      "to_table TEXT NOT NULL, to_columns_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', score REAL, " +
      'cardinality TEXT, evidence_json TEXT, updated_at TEXT)',
    'CREATE TABLE IF NOT EXISTS _qd_queries (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sql TEXT NOT NULL, note TEXT, ' +
      "origin TEXT NOT NULL DEFAULT 'manual', question TEXT, pinned INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)",
    'CREATE TABLE IF NOT EXISTS _qd_history (id INTEGER PRIMARY KEY, sql TEXT NOT NULL, ran_at TEXT, ms REAL, ' +
      'row_count INTEGER, ok INTEGER, error TEXT)',
    'CREATE TABLE IF NOT EXISTS _qd_charts (id INTEGER PRIMARY KEY, query_id INTEGER, name TEXT, spec_json TEXT NOT NULL, ' +
      'position INTEGER DEFAULT 0, created_at TEXT)',
    'CREATE TABLE IF NOT EXISTS _qd_notebook (id INTEGER PRIMARY KEY, position INTEGER NOT NULL, kind TEXT NOT NULL, ' +
      'ref_id INTEGER, body TEXT, created_at TEXT)',
    'CREATE TABLE IF NOT EXISTS _qd_clinic (exercise_id TEXT PRIMARY KEY, status TEXT, attempts INTEGER DEFAULT 0, ' +
      'last_sql TEXT, solved_at TEXT)'
  ];
  QD.RESERVED_TABLES = ['_qd_meta', '_qd_sources', '_qd_columns', '_qd_keys', '_qd_relations', '_qd_queries',
    '_qd_history', '_qd_charts', '_qd_notebook', '_qd_clinic'];
  QD.HISTORY_KEEP = 200;

  QD.now = function () { return new Date().toISOString(); };

  /* ---------------------------------------------------------- SQL scanning */

  /**
   * Blank out comments and the contents of string literals and quoted identifiers, keeping length.
   * Used to look at SQL keywords without being fooled by text inside quotes.
   */
  QD.maskSql = function (sql) {
    var s = String(sql), out = '', i = 0, n = s.length, c, q;
    while (i < n) {
      c = s[i];
      if (c === '-' && s[i + 1] === '-') {
        while (i < n && s[i] !== '\n') { out += ' '; i += 1; }
        continue;
      }
      if (c === '/' && s[i + 1] === '*') {
        out += '  '; i += 2;
        while (i < n && !(s[i] === '*' && s[i + 1] === '/')) { out += (s[i] === '\n' ? '\n' : ' '); i += 1; }
        if (i < n) { out += '  '; i += 2; }
        continue;
      }
      if (c === "'" || c === '"' || c === '`' || c === '[') {
        q = (c === '[') ? ']' : c;
        out += c; i += 1;
        while (i < n) {
          if (s[i] === q) {
            if (q !== ']' && s[i + 1] === q) { out += '  '; i += 2; continue; }
            break;
          }
          out += (s[i] === '\n' ? '\n' : ' '); i += 1;
        }
        if (i < n) { out += q; i += 1; }
        continue;
      }
      out += c; i += 1;
    }
    return out;
  };

  /** Split a script into statements on semicolons that are outside quotes and comments. Empty statements are dropped. */
  QD.splitStatements = function (sql) {
    var s = String(sql), m = QD.maskSql(s), out = [], start = 0, i, piece;
    var upper = m.toUpperCase();
    for (i = 0; i < m.length; i += 1) {
      /* Trigger bodies contain semicolons: track BEGIN ... END only inside CREATE TRIGGER. */
      if (m[i] === ';') {
        piece = upper.slice(start, i);
        if (/^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/.test(piece) && !/\bEND\s*$/.test(piece)) continue;
        if (m.slice(start, i).trim()) out.push(s.slice(start, i).trim());
        start = i + 1;
      }
    }
    if (m.slice(start).trim()) out.push(s.slice(start).trim());
    return out;
  };

  var WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|ANALYZE)\b/;

  /**
   * Text level check that a piece of SQL is a single read only statement.
   * Returns { ok, reason, statement }. This is the first of two guards. The second is the
   * engine switch PRAGMA query_only, applied by project.query().
   * It errs on the safe side: a column literally named update must be quoted to pass.
   */
  QD.checkReadOnly = function (sql) {
    var parts = QD.splitStatements(sql);
    if (parts.length === 0) return { ok: false, reason: 'There is no SQL to run.', statement: '' };
    if (parts.length > 1) return { ok: false, reason: 'Only one statement can run at a time here.', statement: parts[0] };
    var masked = QD.maskSql(parts[0]).toUpperCase();
    var first = (/^\s*\(*\s*([A-Z]+)/.exec(masked) || [])[1] || '';
    if (first !== 'SELECT' && first !== 'WITH' && first !== 'VALUES' && first !== 'EXPLAIN') {
      return { ok: false, reason: 'Only SELECT statements can run here. This one starts with ' + (first || 'something else') + '.', statement: parts[0] };
    }
    var hit = WRITE_WORDS.exec(masked);
    if (hit) {
      return { ok: false, reason: 'This statement contains ' + hit[1] + ', which changes data or settings.', statement: parts[0] };
    }
    return { ok: true, reason: '', statement: parts[0] };
  };

  /* --------------------------------------------------------------- project */

  function Project(db, name) {
    this.db = db;
    this.name = name || 'Untitled';
    this._listeners = [];
    this._dirty = false;
    this.closed = false;
  }

  /** Create an empty project. */
  QD.create = function (name) {
    needEngine();
    var p = new Project(new SQL.Database(), name);
    p._ensureSchema(true);
    return p;
  };

  /**
   * Open a project from the bytes of a .sqlite file. A plain SQLite file with no _qd_ tables
   * is adopted: the reserved tables are added and its user tables are left exactly as they are.
   * Throws a plain language error when the bytes are not a SQLite database.
   */
  QD.open = function (bytes, name) {
    needEngine();
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var magic = 'SQLite format 3';
    var ok = u8.length >= 16, i;
    for (i = 0; ok && i < magic.length; i += 1) { if (u8[i] !== magic.charCodeAt(i)) ok = false; }
    if (!ok) throw new Error('That file is not a SQLite database.');
    var db = new SQL.Database(u8);
    try {
      db.exec('SELECT count(*) FROM sqlite_master');
    } catch (e) {
      db.close();
      throw new Error('That file looks damaged and could not be opened.');
    }
    var p = new Project(db, name);
    var had = p.scalar("SELECT count(*) FROM sqlite_master WHERE name = '_qd_meta'") > 0;
    var ver = had ? Number(p.getMeta('format_version') || 1) : 0;
    if (ver > QD.FORMAT_VERSION) {
      db.close();
      throw new Error('This project was saved by a newer version of Query Desk (format ' + ver + ').');
    }
    p._ensureSchema(!had);
    if (!name) p.name = p.getMeta('project_name') || 'Untitled';
    return p;
  };

  Project.prototype._ensureSchema = function (fresh) {
    var db = this.db;
    DDL.forEach(function (d) { db.run(d); });
    if (fresh) {
      this.setMeta('format_version', String(QD.FORMAT_VERSION));
      this.setMeta('created_at', QD.now());
      this.setMeta('core_version', QD.VERSION);
      this.setMeta('project_name', this.name);
    }
    /* Future migrations go here, keyed on format_version, each one additive. */
    this._dirty = false;
  };

  Project.prototype.getMeta = function (key) {
    var r = this.rows('SELECT value FROM _qd_meta WHERE key = ?', [key]);
    return r.length ? r[0][0] : null;
  };
  Project.prototype.setMeta = function (key, value) {
    this.db.run('INSERT INTO _qd_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value == null ? null : String(value)]);
    this._touch('meta');
  };
  Project.prototype.rename = function (name) {
    this.name = name; this.setMeta('project_name', name);
  };

  /** Subscribe to changes. fn(kind) is called after any write made through this object. Returns an unsubscribe function. */
  Project.prototype.onChange = function (fn) {
    var L = this._listeners; L.push(fn);
    return function () { var i = L.indexOf(fn); if (i >= 0) L.splice(i, 1); };
  };
  Project.prototype._touch = function (kind) {
    this._dirty = true;
    var L = this._listeners.slice(), i;
    for (i = 0; i < L.length; i += 1) { try { L[i](kind || 'data'); } catch (e) { /* a listener must not break a write */ } }
  };
  Project.prototype.isDirty = function () { return this._dirty; };

  /** The bytes of the project as a standard .sqlite file. */
  Project.prototype.export = function (appTag) {
    this.db.run("INSERT INTO _qd_meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [QD.now()]);
    if (appTag) {
      this.db.run("INSERT INTO _qd_meta (key, value) VALUES ('last_app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(appTag)]);
    }
    var bytes = this.db.export();
    this._dirty = false;
    return bytes;
  };
  Project.prototype.close = function () {
    if (!this.closed) { this.db.close(); this.closed = true; this._listeners = []; }
  };

  /* low level reads */
  Project.prototype.rows = function (sql, params) {
    var st = this.db.prepare(sql), out = [];
    try {
      if (params) st.bind(params);
      while (st.step()) out.push(st.get());
    } finally { st.free(); }
    return out;
  };
  Project.prototype.scalar = function (sql, params) {
    var r = this.rows(sql, params);
    return r.length ? r[0][0] : null;
  };
  Project.prototype.objects = function (sql, params) {
    var st = this.db.prepare(sql), out = [];
    try {
      if (params) st.bind(params);
      while (st.step()) out.push(st.getAsObject());
    } finally { st.free(); }
    return out;
  };

  /* ------------------------------------------------------------ user schema */

  Project.prototype.userTables = function () {
    return this.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_qd\\_%' ESCAPE '\\' " +
      "AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name COLLATE NOCASE").map(function (r) { return r[0]; });
  };
  Project.prototype.userViews = function () {
    return this.rows("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name COLLATE NOCASE").map(function (r) { return r[0]; });
  };
  Project.prototype.hasTable = function (name) {
    return this.scalar("SELECT count(*) FROM sqlite_master WHERE type IN ('table','view') AND lower(name) = lower(?)", [name]) > 0;
  };

  /**
   * Full description of the user schema.
   * [{ name, rowCount, columns: [{ name, type, notNull, pk, inferredType, originalHeader, note }], foreignKeys: [{ from, table, to }] }]
   */
  Project.prototype.schema = function () {
    var self = this;
    var meta = {};
    this.objects('SELECT * FROM _qd_columns').forEach(function (m) { meta[m.table_name + '\u0000' + m.column_name] = m; });
    return this.userTables().map(function (t) {
      var q = QD.quoteIdent(t);
      var cols = self.objects('PRAGMA table_info(' + q + ')').map(function (c) {
        var m = meta[t + '\u0000' + c.name] || {};
        return {
          name: c.name, type: c.type || '', notNull: !!c.notnull, pk: c.pk || 0,
          inferredType: m.inferred_type || null, originalHeader: m.original_header || null, note: m.note || null
        };
      });
      var fks = self.objects('PRAGMA foreign_key_list(' + q + ')').map(function (f) {
        return { from: f.from, table: f.table, to: f.to };
      });
      return { name: t, rowCount: self.scalar('SELECT count(*) FROM ' + q), columns: cols, foreignKeys: fks };
    });
  };

  /**
   * A compact text description of the schema for a Claude prompt: CREATE style lines, confirmed
   * relationships, and up to sampleRows example rows per table. Long cells are clipped.
   * No more than sampleRows rows of any table ever leave the browser.
   */
  Project.prototype.schemaText = function (opts) {
    var o = opts || {}, self = this, lines = [];
    var sampleRows = o.sampleRows == null ? 3 : o.sampleRows;
    this.schema().forEach(function (t) {
      lines.push('TABLE ' + QD.quoteIdent(t.name) + ' (' + t.rowCount + ' rows)');
      t.columns.forEach(function (c) {
        lines.push('  ' + QD.quoteIdent(c.name) + ' ' + (c.inferredType || c.type || 'TEXT').toUpperCase() + (c.pk ? ' PRIMARY KEY' : ''));
      });
      if (sampleRows > 0 && t.rowCount > 0) {
        var res = self.query('SELECT * FROM ' + QD.quoteIdent(t.name) + ' LIMIT ' + sampleRows, { history: false });
        lines.push('  sample rows:');
        res.rows.forEach(function (r) {
          lines.push('    ' + JSON.stringify(r.map(function (v) {
            return (typeof v === 'string' && v.length > 40) ? v.slice(0, 40) + '...' : v;
          })));
        });
      }
      lines.push('');
    });
    var rel = [], seenRel = {};
    function addRel(line) { if (!seenRel[line]) { seenRel[line] = true; rel.push(line); } }
    this.relations('confirmed').forEach(function (r) {
      addRel('  ' + r.fromTable + '(' + r.fromColumns.join(', ') + ') -> ' + r.toTable + '(' + r.toColumns.join(', ') + ')');
    });
    /* foreign keys declared inside the file itself count as confirmed */
    this.userTables().forEach(function (t) {
      var groups = {};
      self.objects('PRAGMA foreign_key_list(' + QD.quoteIdent(t) + ')').forEach(function (f) { (groups[f.id] = groups[f.id] || []).push(f); });
      Object.keys(groups).forEach(function (id) {
        var g = groups[id].sort(function (x, y) { return x.seq - y.seq; });
        if (g.some(function (f) { return f.to == null; })) return;
        addRel('  ' + t + '(' + g.map(function (f) { return f.from; }).join(', ') + ') -> ' + g[0].table + '(' + g.map(function (f) { return f.to; }).join(', ') + ')');
      });
    });
    if (rel.length) { lines.push('RELATIONSHIPS'); lines = lines.concat(rel); }
    return lines.join('\n').trim();
  };

  /* ------------------------------------------------------------- data load */

  /**
   * Load parsed CSV rows as a new table.
   *   headers: string[] original header text
   *   rows: string[][] data rows, header excluded
   *   opts: { tableName, fileName, tolerance, dateOrder, types: {cleanColumnName: type}, replace }
   * Short rows are padded with nulls. Rows with extra cells keep the first N cells and count as bad rows.
   * Cells that do not fit the chosen type become null and count as bad cells.
   * Returns { table, rowCount, columns: [{ name, originalHeader, type, nulls, bad, note }], badRows, badCells }.
   */
  Project.prototype.loadTable = function (headers, rows, opts) {
    var o = opts || {}, self = this, db = this.db;
    var ncol = headers.length;
    if (ncol === 0) throw new Error('The file has no columns.');
    var existing = this.userTables().concat(this.userViews());
    var tname = QD.cleanName(o.tableName || o.fileName || 'table', 'table');
    if (o.replace && this.hasTable(tname)) this.dropTable(tname);
    else tname = QD.uniqueNames([tname], existing)[0];
    var names = QD.uniqueNames(headers.map(function (h, i) { return QD.cleanName(h, 'col_' + (i + 1)); }));
    var infos = [], c, r, i;
    for (c = 0; c < ncol; c += 1) {
      var colVals = new Array(rows.length);
      for (r = 0; r < rows.length; r += 1) colVals[r] = rows[r][c];
      var inf = QD.inferColumn(colVals, { tolerance: o.tolerance || 0, dateOrder: o.dateOrder });
      var forced = o.types && o.types[names[c]];
      if (forced && forced !== inf.type) {
        inf = { type: forced, nulls: inf.nulls, count: inf.count, dateOrder: inf.dateOrder || o.dateOrder || 'mdy',
          money: forced === 'real', nearMiss: null, note: 'Type set by hand.' };
      }
      infos.push(inf);
    }
    var ddl = 'CREATE TABLE ' + QD.quoteIdent(tname) + ' (' + names.map(function (nm, k) {
      return QD.quoteIdent(nm) + ' ' + QD.affinity(infos[k].type);
    }).join(', ') + ')';
    var badRows = 0, badCells = 0, badPer = new Array(ncol).fill(0), nullPer = new Array(ncol).fill(0);
    db.run('BEGIN');
    try {
      db.run(ddl);
      var st = db.prepare('INSERT INTO ' + QD.quoteIdent(tname) + ' VALUES (' + names.map(function () { return '?'; }).join(',') + ')');
      try {
        var vals = new Array(ncol);
        for (r = 0; r < rows.length; r += 1) {
          var row = rows[r];
          if (row.length > ncol) badRows += 1;
          for (c = 0; c < ncol; c += 1) {
            var cv = QD.convertValue(c < row.length ? row[c] : null, infos[c]);
            if (cv.bad) { badCells += 1; badPer[c] += 1; }
            if (cv.v === null) nullPer[c] += 1;
            vals[c] = cv.v;
          }
          st.run(vals);
        }
      } finally { st.free(); }
      db.run('INSERT INTO _qd_sources (table_name, file_name, row_count, col_count, bad_rows, bad_cells, loaded_at, options_json) VALUES (?,?,?,?,?,?,?,?)',
        [tname, o.fileName || null, rows.length, ncol, badRows, badCells, QD.now(),
          JSON.stringify({ tolerance: o.tolerance || 0, dateOrder: o.dateOrder || null })]);
      for (i = 0; i < ncol; i += 1) {
        db.run('INSERT OR REPLACE INTO _qd_columns (table_name, column_name, ordinal, original_header, inferred_type, null_count, bad_count, note) VALUES (?,?,?,?,?,?,?,?)',
          [tname, names[i], i, String(headers[i]), infos[i].type, nullPer[i], badPer[i], infos[i].note || null]);
      }
      db.run('COMMIT');
    } catch (e) {
      try { db.run('ROLLBACK'); } catch (e2) { /* nothing to roll back */ }
      throw e;
    }
    this._touch('schema');
    return {
      table: tname, rowCount: rows.length, badRows: badRows, badCells: badCells,
      columns: names.map(function (nm, k) {
        return { name: nm, originalHeader: String(headers[k]), type: infos[k].type, nulls: nullPer[k], bad: badPer[k],
          note: infos[k].note || '', nearMiss: infos[k].nearMiss };
      })
    };
  };

  /** Parse CSV text and load it. The first row is the header unless opts.header === false. */
  Project.prototype.loadCSV = function (text, opts) {
    var o = opts || {};
    var parsed = QD.parseCSV(text, { delimiter: o.delimiter });
    var rows = parsed.rows;
    if (rows.length === 0) throw new Error('The file is empty.');
    var headers;
    if (o.header === false) {
      var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      headers = []; for (var i = 0; i < width; i += 1) headers.push('col_' + (i + 1));
    } else {
      headers = rows[0]; rows = rows.slice(1);
    }
    var res = this.loadTable(headers, rows, o);
    res.delimiter = parsed.delimiter;
    return res;
  };

  /** Remove a user table and every piece of project metadata that points at it. */
  Project.prototype.dropTable = function (name) {
    if (String(name).toLowerCase().indexOf(QD.PREFIX) === 0) throw new Error('Reserved tables cannot be dropped.');
    var db = this.db;
    db.run('BEGIN');
    try {
      db.run('DROP TABLE IF EXISTS ' + QD.quoteIdent(name));
      db.run('DELETE FROM _qd_sources WHERE table_name = ?', [name]);
      db.run('DELETE FROM _qd_columns WHERE table_name = ?', [name]);
      db.run('DELETE FROM _qd_keys WHERE table_name = ?', [name]);
      db.run('DELETE FROM _qd_relations WHERE from_table = ? OR to_table = ?', [name, name]);
      db.run('COMMIT');
    } catch (e) { try { db.run('ROLLBACK'); } catch (e2) { /* ignore */ } throw e; }
    this._touch('schema');
  };

  /* ---------------------------------------------------------------- queries */

  function clip(v) {
    return (typeof v === 'string' && v.length > 100000) ? v.slice(0, 100000) : v;
  }

  /**
   * Run one read only statement and return a result set. This is the path for anything typed by
   * a person or written by Claude. Two guards apply: the text check, then PRAGMA query_only.
   *   opts: { params, maxRows (default QD.LIMITS.resultRows), history (default true) }
   * Returns { columns, rows, rowCount, truncated, ms }. rowCount is the number of rows returned,
   * and truncated is true when the statement had more rows than maxRows.
   * Throws an Error whose message is safe to show. err.kind is 'guard' or 'sql'.
   */
  Project.prototype.query = function (sql, opts) {
    var o = opts || {}, self = this;
    var guard = QD.checkReadOnly(sql);
    if (!guard.ok) {
      var ge = new Error(guard.reason); ge.kind = 'guard';
      if (o.history !== false) this._log(sql, 0, 0, false, guard.reason);
      throw ge;
    }
    var maxRows = o.maxRows || QD.LIMITS.resultRows;
    var t0 = QD._clock(), cols = [], rows = [], truncated = false, st = null;
    this.db.run('PRAGMA query_only = 1');
    try {
      st = this.db.prepare(guard.statement);
      if (o.params) st.bind(o.params);
      cols = st.getColumnNames();
      while (st.step()) {
        if (rows.length >= maxRows) { truncated = true; break; }
        rows.push(st.get().map(clip));
      }
    } catch (e) {
      var se = new Error(QD.explainError(e.message, this)); se.kind = 'sql'; se.raw = e.message;
      if (st) { try { st.free(); } catch (e3) { /* ignore */ } st = null; }
      this.db.run('PRAGMA query_only = 0');
      if (o.history !== false) this._log(sql, QD._clock() - t0, 0, false, e.message);
      throw se;
    }
    if (st) st.free();
    this.db.run('PRAGMA query_only = 0');
    var ms = QD._clock() - t0;
    if (o.history !== false) this._log(sql, ms, rows.length, true, null);
    return { columns: cols, rows: rows, rowCount: rows.length, truncated: truncated, ms: ms };
  };

  /**
   * Run a script that may change the database. Only for trusted callers: Table Forge, the Clinic
   * seeder, and a Query Bench session where the person has switched writes on.
   * Reserved tables are protected by a text check. Returns the result of the last statement that
   * produced rows, or null.
   */
  Project.prototype.execute = function (sql, opts) {
    var o = opts || {}, parts = QD.splitStatements(sql), last = null, self = this, i;
    for (i = 0; i < parts.length; i += 1) {
      var masked = QD.maskSql(parts[i]).toUpperCase();
      var bare = parts[i].toUpperCase();
      if (!o.allowReserved && bare.indexOf('_QD_') !== -1 && /\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE|CREATE)\b/.test(masked)) {
        var pe = new Error('Tables that start with _qd_ belong to Query Desk and cannot be changed here.'); pe.kind = 'guard';
        throw pe;
      }
      if (/^\s*(ATTACH|DETACH)\b/.test(masked)) {
        var ae = new Error('ATTACH and DETACH are not available in the browser.'); ae.kind = 'guard';
        throw ae;
      }
    }
    var t0 = QD._clock();
    try {
      for (i = 0; i < parts.length; i += 1) {
        var st = this.db.prepare(parts[i]);
        try {
          var cols = st.getColumnNames(), rows = [];
          while (st.step()) { if (rows.length < QD.LIMITS.resultRows) rows.push(st.get().map(clip)); }
          if (cols.length) last = { columns: cols, rows: rows, rowCount: rows.length, truncated: false, ms: 0 };
        } finally { st.free(); }
      }
    } catch (e) {
      var se = new Error(QD.explainError(e.message, this)); se.kind = 'sql'; se.raw = e.message;
      if (o.history !== false) this._log(sql, QD._clock() - t0, 0, false, e.message);
      throw se;
    }
    var ms = QD._clock() - t0;
    if (last) last.ms = ms;
    if (o.history !== false) this._log(sql, ms, last ? last.rowCount : 0, true, null);
    this._touch('schema');
    return last;
  };

  Project.prototype._log = function (sql, ms, rowCount, ok, error) {
    try {
      this.db.run('INSERT INTO _qd_history (sql, ran_at, ms, row_count, ok, error) VALUES (?,?,?,?,?,?)',
        [String(sql), QD.now(), ms, rowCount, ok ? 1 : 0, error || null]);
      this.db.run('DELETE FROM _qd_history WHERE id <= (SELECT max(id) FROM _qd_history) - ' + QD.HISTORY_KEEP);
      this._touch('history');
    } catch (e) { /* history is best effort */ }
  };
  Project.prototype.history = function (limit) {
    return this.objects('SELECT id, sql, ran_at, ms, row_count, ok, error FROM _qd_history ORDER BY id DESC LIMIT ' + (limit | 0 || 50));
  };

  QD._clock = function () {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  };

  function editDistance(a, b) {
    var m = a.length, n = b.length, i, j, prev = [], cur = [];
    for (j = 0; j <= n; j += 1) prev[j] = j;
    for (i = 1; i <= m; i += 1) {
      cur = [i];
      for (j = 1; j <= n; j += 1) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  function closest(word, list) {
    var best = null, bd = 99, w = String(word).toLowerCase();
    list.forEach(function (x) {
      var d = editDistance(w, String(x).toLowerCase());
      if (d < bd) { bd = d; best = x; }
    });
    return (best !== null && bd <= Math.max(2, Math.floor(w.length / 3))) ? best : null;
  }

  /** Turn a raw SQLite error into one plain sentence, with a suggestion when a name is close to a real one. */
  QD.explainError = function (raw, project) {
    var msg = String(raw || 'Unknown error'), m, hint;
    if ((m = /no such table: (.+)$/.exec(msg))) {
      hint = project ? closest(m[1].replace(/^main\./, ''), project.userTables().concat(project.userViews())) : null;
      return 'There is no table named ' + m[1] + '.' + (hint ? ' Did you mean ' + hint + '?' : '');
    }
    if ((m = /no such column: (.+)$/.exec(msg))) {
      var col = m[1].split('.').pop(), all = [];
      if (project) project.schema().forEach(function (t) { t.columns.forEach(function (c) { all.push(c.name); }); });
      hint = closest(col, all);
      return 'There is no column named ' + m[1] + '.' + (hint ? ' Did you mean ' + hint + '?' : '') +
        ' Text values need single quotes, and double quotes mean a column name.';
    }
    if ((m = /ambiguous column name: (.+)$/.exec(msg))) {
      return 'The column ' + m[1] + ' exists in more than one table in this query. Put the table name in front of it, like table.' + m[1] + '.';
    }
    if ((m = /near "(.+?)": syntax error/.exec(msg))) {
      return 'SQLite could not read the query at or just before ' + m[1] + '. Check for a missing comma, a missing quote, or a keyword out of order.';
    }
    if (/incomplete input/.test(msg)) return 'The query ends too soon. Check for an unclosed parenthesis or quote.';
    if (/readonly database|read-only/.test(msg)) return 'This statement tries to change data, and only SELECT statements can run here.';
    if ((m = /no such function: (.+)$/.exec(msg))) {
      return 'SQLite has no function named ' + m[1] + '. SQL Server functions such as GETDATE, DATEPART, ISNULL and LEN have different names here.';
    }
    if (/misuse of aggregate/.test(msg)) return 'An aggregate such as COUNT or SUM is used where it is not allowed. Filters on aggregates belong in HAVING, not WHERE.';
    if ((m = /misuse of window function (.+)$/.exec(msg))) return 'The window function ' + m[1] + ' cannot be used in WHERE or GROUP BY. Wrap the query in a CTE and filter outside it.';
    if (/SELECTs to the left and right of (UNION|EXCEPT|INTERSECT).* do not have the same number/.test(msg)) {
      return 'Both halves of a UNION, EXCEPT or INTERSECT must return the same number of columns.';
    }
    if (/table .* already exists/.test(msg)) return msg.charAt(0).toUpperCase() + msg.slice(1) + '.';
    return 'SQLite reported: ' + msg;
  };

  /* --------------------------------------------------------- saved queries */

  Project.prototype.saveQuery = function (q) {
    var now = QD.now();
    if (q.id) {
      this.db.run('UPDATE _qd_queries SET name = ?, sql = ?, note = ?, pinned = ?, updated_at = ? WHERE id = ?',
        [q.name, q.sql, q.note || null, q.pinned ? 1 : 0, now, q.id]);
      this._touch('queries');
      return q.id;
    }
    this.db.run('INSERT INTO _qd_queries (name, sql, note, origin, question, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [q.name || 'Untitled query', q.sql, q.note || null, q.origin || 'manual', q.question || null, q.pinned ? 1 : 0, now, now]);
    var id = this.scalar('SELECT last_insert_rowid()');
    this._touch('queries');
    return id;
  };
  Project.prototype.queries = function () {
    return this.objects('SELECT * FROM _qd_queries ORDER BY pinned DESC, updated_at DESC, id DESC');
  };
  Project.prototype.getQuery = function (id) {
    return this.objects('SELECT * FROM _qd_queries WHERE id = ?', [id])[0] || null;
  };
  Project.prototype.deleteQuery = function (id) {
    this.db.run('DELETE FROM _qd_charts WHERE query_id = ?', [id]);
    this.db.run("DELETE FROM _qd_notebook WHERE kind = 'query' AND ref_id = ?", [id]);
    this.db.run('DELETE FROM _qd_queries WHERE id = ?', [id]);
    this._touch('queries');
  };

  /* ---------------------------------------------------------------- charts */

  QD.CHART_TYPES = ['bar', 'line', 'scatter', 'pie', 'tile'];
  QD.CHART_SORTS = ['none', 'asc', 'desc'];
  QD.CHART_KEYS = ['type', 'x', 'y', 'series', 'stacked', 'sort', 'limit', 'title'];

  /**
   * Check a chart spec against the fixed shape shared by Days 198 and 200:
   * { type, x, y, series, stacked, sort, limit, title } and nothing else.
   * Returns { ok, reason }.
   */
  QD.validateChartSpec = function (spec) {
    function no(reason) { return { ok: false, reason: reason }; }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return no('A chart spec must be an object.');
    var keys = Object.keys(spec), i;
    for (i = 0; i < keys.length; i += 1) {
      if (QD.CHART_KEYS.indexOf(keys[i]) < 0) return no('A chart spec cannot carry ' + keys[i] + '.');
    }
    for (i = 0; i < QD.CHART_KEYS.length; i += 1) {
      if (!(QD.CHART_KEYS[i] in spec)) return no('A chart spec needs ' + QD.CHART_KEYS[i] + '.');
    }
    if (QD.CHART_TYPES.indexOf(spec.type) < 0) return no('The chart type must be one of ' + QD.CHART_TYPES.join(', ') + '.');
    function name(v) { return typeof v === 'string' && v.length > 0 && v.length <= 200; }
    if (spec.type === 'tile') { if (spec.x !== null && !name(spec.x)) return no('x must be a column name or null.'); }
    else if (!name(spec.x)) return no('x must be a column name.');
    if (!Array.isArray(spec.y) || spec.y.length < 1 || spec.y.length > 4) return no('y must list one to four columns.');
    for (i = 0; i < spec.y.length; i += 1) { if (!name(spec.y[i])) return no('Every y entry must be a column name.'); }
    if (spec.series !== null && !name(spec.series)) return no('series must be a column name or null.');
    if (typeof spec.stacked !== 'boolean') return no('stacked must be true or false.');
    if (QD.CHART_SORTS.indexOf(spec.sort) < 0) return no('sort must be none, asc or desc.');
    if (typeof spec.limit !== 'number' || Math.floor(spec.limit) !== spec.limit || spec.limit < 1 || spec.limit > 1000) {
      return no('limit must be a whole number from 1 to 1000.');
    }
    if (typeof spec.title !== 'string' || spec.title.length > 200) return no('title must be text of 200 characters or fewer.');
    return { ok: true, reason: null };
  };

  function checkSpec(spec) {
    var v = QD.validateChartSpec(spec);
    if (!v.ok) { var e = new Error(v.reason); e.kind = 'spec'; throw e; }
  }
  function chartRow(r) {
    var spec = null;
    try { spec = JSON.parse(r.spec_json); } catch (e) { spec = null; }
    return { id: r.id, queryId: r.query_id, name: r.name, spec: spec, position: r.position, createdAt: r.created_at };
  }

  /** Pin a chart. c: { queryId, spec, position }. Without a position it goes to the end of the board. Returns the id. */
  Project.prototype.saveChart = function (c) {
    checkSpec(c.spec);
    var pos = c.position;
    if (pos == null) pos = Number(this.scalar('SELECT coalesce(max(position), -1) + 1 FROM _qd_charts'));
    this.db.run('INSERT INTO _qd_charts (query_id, name, spec_json, position, created_at) VALUES (?,?,?,?,?)',
      [c.queryId == null ? null : c.queryId, c.spec.title || null, JSON.stringify(c.spec), pos, QD.now()]);
    var id = this.scalar('SELECT last_insert_rowid()');
    this._touch('charts');
    return id;
  };
  /** Pinned charts in board order. */
  Project.prototype.charts = function () {
    return this.objects('SELECT * FROM _qd_charts ORDER BY position, id').map(chartRow);
  };
  Project.prototype.updateChart = function (id, spec) {
    checkSpec(spec);
    this.db.run('UPDATE _qd_charts SET spec_json = ?, name = ? WHERE id = ?', [JSON.stringify(spec), spec.title || null, id]);
    this._touch('charts');
  };
  /** Move a chart to a zero based place on the board and renumber the rest in order. */
  Project.prototype.moveChart = function (id, position) {
    var ids = this.charts().map(function (c) { return c.id; }), from = ids.indexOf(id), db = this.db;
    if (from < 0) return;
    ids.splice(from, 1);
    var to = Math.max(0, Math.min(ids.length, Math.floor(position)));
    ids.splice(to, 0, id);
    ids.forEach(function (cid, i) { db.run('UPDATE _qd_charts SET position = ? WHERE id = ?', [i, cid]); });
    this._touch('charts');
  };
  Project.prototype.deleteChart = function (id) {
    this.db.run('DELETE FROM _qd_charts WHERE id = ?', [id]);
    this.db.run("DELETE FROM _qd_notebook WHERE kind = 'chart' AND ref_id = ?", [id]);
    this._touch('charts');
  };

  /* ------------------------------------------------- keys and relationships */

  function parseCols(row, field) {
    try { return JSON.parse(row[field]); } catch (e) { return []; }
  }
  function sameCols(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /**
   * Store a primary key decision. status is proposed, confirmed or rejected.
   * Confirming one key for a table demotes any other confirmed key for that table to proposed.
   */
  Project.prototype.setKey = function (table, columns, status, score, evidence) {
    var existing = this.objects('SELECT * FROM _qd_keys WHERE table_name = ?', [table]).filter(function (k) {
      return sameCols(parseCols(k, 'columns_json'), columns);
    })[0];
    if (status === 'confirmed') {
      this.db.run("UPDATE _qd_keys SET status = 'proposed' WHERE table_name = ? AND status = 'confirmed'", [table]);
    }
    if (existing) {
      this.db.run('UPDATE _qd_keys SET status = ?, score = coalesce(?, score), evidence_json = coalesce(?, evidence_json), updated_at = ? WHERE id = ?',
        [status, score == null ? null : score, evidence ? JSON.stringify(evidence) : null, QD.now(), existing.id]);
    } else {
      this.db.run('INSERT INTO _qd_keys (table_name, columns_json, status, score, evidence_json, updated_at) VALUES (?,?,?,?,?,?)',
        [table, JSON.stringify(columns), status, score == null ? null : score, evidence ? JSON.stringify(evidence) : null, QD.now()]);
    }
    this._touch('keys');
  };
  Project.prototype.keys = function (status) {
    return this.objects('SELECT * FROM _qd_keys' + (status ? ' WHERE status = ?' : '') + ' ORDER BY table_name, score DESC', status ? [status] : undefined)
      .map(function (k) {
        return { id: k.id, table: k.table_name, columns: parseCols(k, 'columns_json'), status: k.status, score: k.score,
          evidence: k.evidence_json ? JSON.parse(k.evidence_json) : null };
      });
  };

  /** Store a relationship decision. rel: { fromTable, fromColumns, toTable, toColumns, status, score, cardinality, evidence } */
  Project.prototype.setRelation = function (rel) {
    var existing = this.objects('SELECT * FROM _qd_relations WHERE from_table = ? AND to_table = ?', [rel.fromTable, rel.toTable]).filter(function (r) {
      return sameCols(parseCols(r, 'from_columns_json'), rel.fromColumns) && sameCols(parseCols(r, 'to_columns_json'), rel.toColumns);
    })[0];
    var ev = rel.evidence ? JSON.stringify(rel.evidence) : null;
    if (existing) {
      this.db.run('UPDATE _qd_relations SET status = ?, score = coalesce(?, score), cardinality = coalesce(?, cardinality), evidence_json = coalesce(?, evidence_json), updated_at = ? WHERE id = ?',
        [rel.status || existing.status, rel.score == null ? null : rel.score, rel.cardinality || null, ev, QD.now(), existing.id]);
      this._touch('relations');
      return existing.id;
    }
    this.db.run('INSERT INTO _qd_relations (from_table, from_columns_json, to_table, to_columns_json, status, score, cardinality, evidence_json, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [rel.fromTable, JSON.stringify(rel.fromColumns), rel.toTable, JSON.stringify(rel.toColumns), rel.status || 'proposed',
        rel.score == null ? null : rel.score, rel.cardinality || null, ev, QD.now()]);
    var id = this.scalar('SELECT last_insert_rowid()');
    this._touch('relations');
    return id;
  };
  Project.prototype.relations = function (status) {
    return this.objects('SELECT * FROM _qd_relations' + (status ? ' WHERE status = ?' : '') + ' ORDER BY from_table, score DESC', status ? [status] : undefined)
      .map(function (r) {
        return { id: r.id, fromTable: r.from_table, fromColumns: parseCols(r, 'from_columns_json'), toTable: r.to_table,
          toColumns: parseCols(r, 'to_columns_json'), status: r.status, score: r.score, cardinality: r.cardinality,
          evidence: r.evidence_json ? JSON.parse(r.evidence_json) : null };
      });
  };
  Project.prototype.deleteRelation = function (id) {
    this.db.run('DELETE FROM _qd_relations WHERE id = ?', [id]); this._touch('relations');
  };

  /* -------------------------------------------------------- result compare */

  function canon(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    if (v instanceof Uint8Array) return 'b:' + Array.prototype.join.call(v, ',');
    var s = String(v), t = s.trim();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) && t === String(Number(t))) return Number(t);
    return s;
  }
  function sortKey(v) {
    if (v === null) return '0';
    if (typeof v === 'number') return '1' + (isFinite(v) ? (Math.round(v * 100) / 100 + 1e15).toFixed(2) : String(v));
    return '2' + v;
  }
  function cellEq(a, b, tol) {
    if (a === null || b === null) return a === b;
    if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= tol;
    return a === b;
  }

  /**
   * Compare a learner result with a reference result. Column names never matter; column order does
   * unless opts.anyColumnOrder is true. Row order matters only when opts.ordered is true.
   * Numbers match within opts.tolerance (default 0.0051, so a value and its two place rounding agree).
   * Numeric text such as '2' equals the number 2, but '02' does not. NULL equals only NULL.
   * Returns { match, reason } where reason is one plain sentence a learner can act on.
   */
  QD.compareResults = function (got, want, opts) {
    var o = opts || {}, tol = o.tolerance || 0.0051;
    if (got.truncated || want.truncated) return { match: false, reason: 'The result is too large to check. Narrow the query.' };
    if (got.columns.length !== want.columns.length) {
      return { match: false, reason: 'Expected ' + want.columns.length + ' column' + (want.columns.length === 1 ? '' : 's') + ' and got ' + got.columns.length + '.' };
    }
    if (got.rows.length !== want.rows.length) {
      return { match: false, reason: 'Expected ' + want.rows.length + ' row' + (want.rows.length === 1 ? '' : 's') + ' and got ' + got.rows.length + '.' };
    }
    var W = want.rows.map(function (r) { return r.map(canon); });
    var G0 = got.rows.map(function (r) { return r.map(canon); });
    function byKey(x, y) {
      var kx = x.map(sortKey).join('\u0001'), ky = y.map(sortKey).join('\u0001');
      return kx < ky ? -1 : (kx > ky ? 1 : 0);
    }
    function same(G, ordered) {
      var a = ordered ? G : G.slice().sort(byKey), b = ordered ? W : W.slice().sort(byKey), i, j;
      for (i = 0; i < b.length; i += 1) {
        for (j = 0; j < b[i].length; j += 1) if (!cellEq(a[i][j], b[i][j], tol)) return false;
      }
      return true;
    }
    function check(G) {
      if (same(G, !!o.ordered)) return 'match';
      if (o.ordered && same(G, false)) return 'order';
      return 'no';
    }
    var res = check(G0);
    if (res === 'match') return { match: true, reason: '' };
    if (o.anyColumnOrder && want.columns.length <= 6) {
      var idx = want.columns.map(function (_, i) { return i; }), best = res;
      (function permute(arr, k) {
        if (best === 'match') return;
        if (k === arr.length) {
          var r = check(G0.map(function (row) { return arr.map(function (c) { return row[c]; }); }));
          if (r === 'match' || (r === 'order' && best === 'no')) best = r;
          return;
        }
        for (var i = k; i < arr.length; i += 1) {
          var t = arr[k]; arr[k] = arr[i]; arr[i] = t;
          permute(arr, k + 1);
          t = arr[k]; arr[k] = arr[i]; arr[i] = t;
        }
      })(idx, 0);
      res = best;
      if (res === 'match') return { match: true, reason: '' };
    }
    if (res === 'order') return { match: false, reason: 'The rows are right but the order is not. Check ORDER BY.' };
    return { match: false, reason: 'The shape is right but some values differ from the expected result.' };
  };

  /* -------------------------------------------------------------- CSV out */

  QD.toCSV = function (result) {
    function cell(v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s;
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [result.columns.map(cell).join(',')];
    result.rows.forEach(function (r) { lines.push(r.map(cell).join(',')); });
    return lines.join('\r\n') + '\r\n';
  };

  /* ---------------------------------------------------------------- storage */

  /**
   * Project storage in IndexedDB, shared by every Query Desk app on the same origin
   * (all AppADay apps share augustineiacopelli.github.io, so a project made in one app opens in the next).
   * Every method returns a promise and never rejects for a missing or blocked IndexedDB: it resolves
   * to null, false or [] so an app keeps working without persistence.
   */
  QD.store = (function () {
    var DB_NAME = 'querydesk', STORE = 'projects', dbp = null;
    function idb() { return root.indexedDB || null; }
    function openDb() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve) {
        var f = idb();
        if (!f) { resolve(null); return; }
        var req;
        try { req = f.open(DB_NAME, 1); } catch (e) { resolve(null); return; }
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'name' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      });
      return dbp;
    }
    function tx(mode, fn, fallback) {
      return openDb().then(function (db) {
        if (!db) return fallback;
        return new Promise(function (resolve) {
          var out = fallback, t;
          try { t = db.transaction(STORE, mode); } catch (e) { resolve(fallback); return; }
          var req = fn(t.objectStore(STORE));
          if (req) req.onsuccess = function () { out = req.result; };
          t.oncomplete = function () { resolve(out === undefined ? fallback : out); };
          t.onerror = function () { resolve(fallback); };
          t.onabort = function () { resolve(fallback); };
        });
      });
    }
    return {
      /** Save bytes under a project name. Resolves true on success. */
      save: function (name, bytes, appTag) {
        var rec = { name: name, bytes: bytes, size: bytes.length, savedAt: QD.now(), app: appTag || null };
        return tx('readwrite', function (s) { return s.put(rec); }, false).then(function (r) { return r !== false; });
      },
      /** Resolves { name, bytes, size, savedAt, app } or null. */
      load: function (name) {
        return tx('readonly', function (s) { return s.get(name); }, null).then(function (r) { return r || null; });
      },
      /** Resolves [{ name, size, savedAt, app }] newest first, without the bytes. */
      list: function () {
        return tx('readonly', function (s) { return s.getAll(); }, []).then(function (all) {
          return (all || []).map(function (r) { return { name: r.name, size: r.size, savedAt: r.savedAt, app: r.app }; })
            .sort(function (a, b) { return a.savedAt < b.savedAt ? 1 : -1; });
        });
      },
      remove: function (name) {
        return tx('readwrite', function (s) { s.delete(name); return null; }, false).then(function () { return true; });
      },
      _reset: function () { dbp = null; }
    };
  })();

  /**
   * Save the project to IndexedDB shortly after each change. Returns { flush(), stop() }.
   * History only changes are saved on a longer delay so running queries does not thrash storage.
   */
  QD.autosave = function (project, opts) {
    var o = opts || {}, delay = o.delay || 1500, timer = null, stopped = false, appTag = o.app || null;
    function flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (stopped || project.closed) return Promise.resolve(false);
      var bytes = project.export(appTag);
      return QD.store.save(project.name, bytes, appTag).then(function (ok) {
        if (o.onSave) { try { o.onSave(ok, bytes.length); } catch (e) { /* ignore */ } }
        return ok;
      });
    }
    var off = project.onChange(function (kind) {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, kind === 'history' ? delay * 4 : delay);
    });
    return { flush: flush, stop: function () { stopped = true; if (timer) clearTimeout(timer); off(); } };
  };

  /* ------------------------------------------------------------ file helpers */

  /** Browser only. Offer bytes or text as a download. */
  QD.download = function (data, filename, mime) {
    var blob = new Blob([data], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  };
  QD.fileName = function (project) {
    return QD.cleanName(project.name, 'project').replace(/_/g, '-') + '.sqlite';
  };
  /** Browser only. Read a File as bytes or text. */
  QD.readFile = function (file, asText) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(asText ? fr.result : new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(new Error('The file could not be read.')); };
      if (asText) fr.readAsText(file); else fr.readAsArrayBuffer(file);
    });
  };
  QD.isPhone = function () {
    return typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  };
  /** Returns 'ok', 'warn' or 'refuse' for a file of this many bytes on this device. */
  QD.sizeVerdict = function (bytes) {
    var lim = QD.isPhone() ? QD.LIMITS.phone : QD.LIMITS.desktop;
    return bytes > lim.max ? 'refuse' : (bytes > lim.warn ? 'warn' : 'ok');
  };
  QD.formatBytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };

  /* ------------------------------------------------------------------ Claude */

  var thinkingForm = {};
  var THINK_FORMS = [{ type: 'between_tools' }, { type: 'disabled' }, null];

  /**
   * One Claude call under the AppADay conventions.
   *   opts: { tier ('sonnet'), system, messages | prompt, maxTokens (1500), signal }
   * The key comes from window.AppKeys and the model from window.AppModels. Never call this at the
   * top level of a script: keys.js is deferred. Resolves { text, stopReason, model } or null when the
   * person declines to give a key. Rejects with a plain language Error otherwise.
   */
  QD.claude = function (opts) {
    var o = opts || {};
    var fetchFn = o.fetch || root.fetch;
    var keys = o.keys || root.AppKeys, models = o.models || root.AppModels;
    if (!keys || !models) return Promise.reject(new Error('The shared key and model scripts did not load. Check the connection and reload.'));
    var model = models.id(o.tier || 'sonnet');
    return Promise.resolve(keys.get()).then(function (key) {
      if (!key) return null;
      var messages = o.messages || [{ role: 'user', content: String(o.prompt || '') }];
      var start = thinkingForm[model] === undefined ? 0 : thinkingForm[model];
      function attempt(formIdx, retried) {
        var body = { model: model, max_tokens: o.maxTokens || 1500, messages: messages };
        if (o.system) body.system = o.system;
        if (THINK_FORMS[formIdx]) body.thinking = THINK_FORMS[formIdx];
        return fetchFn('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: o.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify(body)
        }).then(function (resp) {
          return resp.text().then(function (raw) {
            var data = null;
            try { data = JSON.parse(raw); } catch (e) { data = null; }
            if (resp.ok && data) {
              thinkingForm[model] = formIdx;
              var text = (data.content || []).filter(function (b) { return b.type === 'text'; })
                .map(function (b) { return b.text; }).join('');
              if (!text.trim()) {
                var kinds = (data.content || []).map(function (b) { return b.type; }).join(', ') || 'none';
                if (root.console) root.console.warn('QD.claude: empty reply. blocks: ' + kinds + ' stop_reason: ' + data.stop_reason);
                throw new Error('Claude returned an empty reply. Try again.');
              }
              return { text: text, stopReason: data.stop_reason, model: data.model || model };
            }
            var emsg = (data && data.error && data.error.message) || ('HTTP ' + resp.status);
            if (resp.status === 400 && /thinking/i.test(emsg) && formIdx < THINK_FORMS.length - 1) {
              return attempt(formIdx + 1, retried);
            }
            if ((resp.status === 429 || resp.status >= 500) && !retried) {
              return new Promise(function (r) { setTimeout(r, o.retryDelay == null ? 1500 : o.retryDelay); })
                .then(function () { return attempt(formIdx, true); });
            }
            if (resp.status === 401) throw new Error('The API key was rejected. Open Settings and check the key.');
            if (resp.status === 429) throw new Error('Claude is rate limited right now. Wait a minute and try again.');
            if (resp.status >= 500) throw new Error('Claude is having trouble right now. Try again in a moment.');
            throw new Error('Claude could not answer: ' + emsg);
          });
        }, function (netErr) {
          if (netErr && netErr.name === 'AbortError') throw netErr;
          throw new Error('The request could not reach Claude. Check the connection.');
        });
      }
      return attempt(start, false);
    });
  };
  QD.claude._resetThinking = function () { thinkingForm = {}; };

  /** Pull the first fenced or bare JSON object out of a Claude reply. Returns the parsed value or null. */
  QD.extractJSON = function (text) {
    var s = String(text || '');
    var fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
    var cand = fence ? fence[1] : s;
    var a = cand.indexOf('{'), b = cand.lastIndexOf('}');
    if (a === -1 || b <= a) return null;
    try { return JSON.parse(cand.slice(a, b + 1)); } catch (e) { return null; }
  };

  root.QD = QD;
  if (typeof module !== 'undefined' && module.exports) module.exports = QD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
/* QD:CORE END */
