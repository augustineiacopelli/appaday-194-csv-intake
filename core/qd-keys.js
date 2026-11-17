/* QD:KEYS BEGIN v1.0.0 */
/*
 * Query Desk key and relationship inference. Depends on QD:CORE (globalThis.QD).
 * Pure analysis: analyze() only reads. apply() writes proposals into _qd_keys and _qd_relations
 * and never overrides a decision a person already made (confirmed or rejected).
 *
 * The central idea: containment alone proves nothing when keys are row numbers. Every integer
 * column that holds small values is "contained" in every table whose key runs 1..N. So for
 * range like parent keys the column NAME has to carry the proposal, and for natural keys
 * (codes, sparse numbers) the VALUES can carry it on their own.
 */
(function (root) {
  'use strict';
  var QD = root.QD || (typeof require === 'function' ? require('./qd-core.js') : null);
  var K = {};
  K.VERSION = '1.0.0';
  K.THRESHOLDS = { strong: 0.75, likely: 0.5, weak: 0.3 };
  K.MIN_CONTAINMENT = 0.9;   /* share of child rows that must find a parent */
  K.MIN_DISTINCT = 0.5;      /* share of distinct child values that must find a parent */

  function label(score) {
    return score >= K.THRESHOLDS.strong ? 'strong' : (score >= K.THRESHOLDS.likely ? 'likely' : (score >= K.THRESHOLDS.weak ? 'weak' : 'none'));
  }
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function round2(x) { return Math.round(x * 100) / 100; }
  var q = function (n) { return QD.quoteIdent(n); };

  /* ----------------------------------------------------------------- names */

  var KEY_SUFFIX = { id: 1, key: 1, code: 1, no: 1, num: 1, nbr: 1, number: 1, cd: 1, fk: 1, pk: 1, ref: 1 };
  var TABLE_PREFIX = { tbl: 1, dim: 1, fact: 1, d: 1, f: 1, t: 1, lkp: 1, lookup: 1, ref: 1 };
  var ROLE_WORDS = { report: 1, replac: 1, manager: 1, parent: 1, supervisor: 1, reports: 1, boss: 1, mentor: 1, lead: 1, referrer: 1, referred: 1, predecessor: 1, previous: 1, prev: 1, next: 1, replaced: 1, replaces: 1, original: 1, root: 1 };

  function singular(w) {
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }
  /* Light stemming applied to both sides of every comparison, so campuses, campus and course, courses agree. */
  function stem(w) {
    var s = singular(w);
    if (s.length > 4 && /e$/.test(s)) s = s.slice(0, -1);
    return s;
  }
  function tokens(name) {
    return String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  }
  function tableTokens(name) {
    var t = tokens(name);
    while (t.length > 1 && TABLE_PREFIX[t[0]]) t = t.slice(1);
    return t;
  }
  function splitKey(name) {
    var t = tokens(name), suffix = false;
    while (t.length > 0 && KEY_SUFFIX[t[t.length - 1]]) { t = t.slice(0, -1); suffix = true; }
    if (t.length > 1 && (t[0] === 'fk' || t[0] === 'pk')) t = t.slice(1);
    return { stem: t, suffix: suffix };
  }
  function eqTokens(a, b) { return a.length === b.length && a.length > 0 && a.join('_') === b.join('_'); }
  function endsWithTokens(a, b) {
    if (b.length === 0 || a.length <= b.length) return false;
    return a.slice(a.length - b.length).join('_') === b.join('_');
  }
  function containsTokens(a, b) {
    if (b.length === 0 || a.length <= b.length) return false;
    for (var i = 0; i + b.length <= a.length; i += 1) if (a.slice(i, i + b.length).join('_') === b.join('_')) return true;
    return false;
  }
  /** True when short is a believable abbreviation of long: cust/customer, dept/department, emp/employee. */
  function abbrev(short, long) {
    if (short === long) return true;
    if (short.length < 3 || short.length >= long.length) return false;
    if (short[0] !== long[0]) return false;
    if (long.indexOf(short) === 0) return true;
    if (short.length / long.length < 0.34) return false;
    var i = 0, j = 0;
    while (i < short.length && j < long.length) { if (short[i] === long[j]) i += 1; j += 1; }
    return i === short.length;
  }
  function fuzzyTokens(a, b) {
    if (a.length === 0 || b.length === 0) return false;
    var x = a.join(''), y = b.join('');
    return abbrev(x, y) || abbrev(y, x);
  }

  /**
   * How strongly does the child column's name point at this parent table and column? 0 to 1.
   * Returns { score, why }.
   */
  function nameEvidence(childTable, childCol, parentTable, parentCol) {
    var c = splitKey(childCol), pt = tableTokens(parentTable), p = splitKey(parentCol);
    var cc = tokens(childCol).join('_'), pc = tokens(parentCol).join('_');
    var best = { score: 0, why: '' };
    function take(score, why) { if (score > best.score) best = { score: score, why: why }; }
    if (c.stem.length) {
      if (eqTokens(c.stem, pt)) take(c.suffix ? 1 : 0.85, 'the column is named after the ' + parentTable + ' table');
      else if (endsWithTokens(c.stem, pt)) take(0.9, 'the column name ends with the name of the ' + parentTable + ' table');
      else if (containsTokens(c.stem, pt)) take(0.7, 'the column name contains the name of the ' + parentTable + ' table');
      else if (fuzzyTokens(c.stem, pt)) take(0.8, 'the column name looks like a short form of ' + parentTable);
      else if (c.stem.length > 1 && fuzzyTokens([c.stem[c.stem.length - 1]], pt)) take(0.7, 'the end of the column name looks like a short form of ' + parentTable);
    }
    if (cc === pc && p.stem.length) {
      take(eqTokens(p.stem, pt) ? 1 : 0.8, 'both columns have the same name');
    } else if (p.stem.length && c.stem.length) {
      if (eqTokens(c.stem, p.stem)) take(0.75, 'the two column names share the same root');
      else if (fuzzyTokens(c.stem, p.stem)) take(0.7, 'the column names look like forms of the same word');
      else if (endsWithTokens(c.stem, p.stem)) take(0.7, 'the column name ends with the parent column name');
    }
    if (cc === pc && !p.stem.length && cc !== 'id') take(0.3, 'both columns have the same generic name');
    if (childTable === parentTable && c.stem.length && c.stem.some(function (t) { return ROLE_WORDS[t]; })) {
      take(0.75, 'the column name describes a role inside the same table');
    }
    return best;
  }

  /* --------------------------------------------------------------- profile */

  /**
   * Profile every user table. One pass per table.
   * Column profile: { name, ordinal, n, nonNull, distinct, cls ('int'|'real'|'text'|'mixed'|'empty'), min, max,
   *   avgLen, maxLen, intLike, dateLike, unique, rangeLike, sequential, boolLike, inferredType, declaredPk }
   */
  K.profile = function (project) {
    var meta = {};
    project.objects('SELECT * FROM _qd_columns').forEach(function (m) { meta[m.table_name + '\u0000' + m.column_name] = m; });
    return project.userTables().map(function (t) {
      var info = project.objects('PRAGMA table_info(' + q(t) + ')');
      var parts = ['count(*)'];
      info.forEach(function (c) {
        var x = q(c.name);
        parts.push('count(' + x + ')', 'count(DISTINCT ' + x + ')', 'min(' + x + ')', 'max(' + x + ')',
          "sum(typeof(" + x + ")='integer')", "sum(typeof(" + x + ")='real')", "sum(typeof(" + x + ")='text')",
          'avg(length(' + x + '))', 'max(length(' + x + '))',
          "sum(typeof(" + x + ")='text' AND trim(" + x + ") <> '' AND trim(" + x + ") NOT GLOB '*[^0-9]*')",
          "sum(typeof(" + x + ")='text' AND " + x + " GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*')");
      });
      var r = project.rows('SELECT ' + parts.join(', ') + ' FROM ' + q(t))[0];
      var n = r[0];
      var cols = info.map(function (c, i) {
        var b = 1 + i * 11, nn = r[b], d = r[b + 1], ints = r[b + 4] || 0, reals = r[b + 5] || 0, texts = r[b + 6] || 0;
        var m = meta[t + '\u0000' + c.name] || {};
        var cls = nn === 0 ? 'empty' : (ints === nn ? 'int' : (texts === nn ? 'text' : (ints + reals === nn ? 'real' : 'mixed')));
        var mn = r[b + 2], mx = r[b + 3];
        var span = (cls === 'int') ? (mx - mn + 1) : null;
        var p = {
          name: c.name, ordinal: i, n: n, nonNull: nn, distinct: d, cls: cls, min: mn, max: mx,
          avgLen: r[b + 7] || 0, maxLen: r[b + 8] || 0, intLike: r[b + 9] || 0, dateLike: r[b + 10] || 0,
          inferredType: m.inferred_type || null, declaredPk: c.pk || 0
        };
        p.unique = n > 0 && nn === n && d === n;
        p.rangeLike = cls === 'int' && d > 0 && span <= Math.max(d * 1.5, d + 2);
        p.sequential = p.rangeLike && p.unique && (mn === 0 || mn === 1) && span === d;
        p.boolLike = p.inferredType === 'boolean' || (cls === 'int' && d <= 2 && mn >= 0 && mx <= 1 && !p.unique);
        p.isDate = p.inferredType === 'date' || p.inferredType === 'datetime' || (cls === 'text' && nn > 0 && p.dateLike === nn);
        p.allIntText = cls === 'text' && nn > 0 && p.intLike === nn;
        return p;
      });
      var fks = project.objects('PRAGMA foreign_key_list(' + q(t) + ')');
      return { name: t, rowCount: n, columns: cols, declaredFks: fks };
    });
  };

  function keyable(p) {
    if (p.cls === 'real' || p.cls === 'mixed' || p.cls === 'empty') return false;
    if (p.isDate || p.inferredType === 'boolean') return false;
    if (p.cls === 'text' && (p.avgLen > 40 || p.maxLen > 120)) return false;
    return true;
  }

  /* ---------------------------------------------------------- primary keys */

  function scoreSingleKey(table, p) {
    var reasons = ['every row has a different value and none are empty'], s = 0.35;
    var parts = splitKey(p.name), tt = tableTokens(table.name), nm = tokens(p.name).join('_');
    var named = false;
    if (nm === 'id') { s += 0.45; named = true; reasons.push('it is named id'); }
    else if (parts.suffix && eqTokens(parts.stem, tt)) { s += 0.5; named = true; reasons.push('it is named after its own table'); }
    else if (parts.suffix && parts.stem.length === 0) { s += 0.3; named = true; reasons.push('its name is a key word'); }
    else if (parts.suffix) { s += 0.2; reasons.push('its name ends like a key'); }
    else if (/^(uuid|guid|sku|isbn|ssn|ein|vin|upc|slug|email|username|iata|icao|abbr|abbreviation|symbol|ticker)$/.test(nm)) {
      s += 0.25; named = true; reasons.push('its name is a common natural key');
    }
    if (p.ordinal === 0) { s += 0.1; reasons.push('it is the first column'); }
    if (p.cls === 'int') s += 0.1;
    else if (p.cls === 'text' && p.maxLen <= 40) s += 0.05;
    if (p.sequential) s += 0.05;
    if (p.cls === 'real') { s -= 0.45; reasons.push('but decimal numbers make poor keys'); }
    if (p.isDate) { s -= 0.4; reasons.push('but dates and times make poor keys'); }
    if (p.cls === 'text' && p.avgLen > 40) { s -= 0.35; reasons.push('but the values are long free text'); }
    if (p.cls === 'text' && p.avgLen > 12 && !named && !/[0-9]/.test(String(p.min))) { s -= 0.1; }
    if (table.rowCount < 5 && !named) { s -= 0.15; reasons.push('but the table is too small for uniqueness to mean much'); }
    if (p.declaredPk) { s = 1; reasons = ['it is declared as the primary key in the file']; }
    return { score: clamp(s), reasons: reasons, named: named };
  }

  function isUniqueCombo(project, table, cols) {
    var list = cols.map(q).join(', ');
    return project.rows('SELECT 1 FROM ' + q(table) + ' GROUP BY ' + list + ' HAVING count(*) > 1 LIMIT 1').length === 0;
  }

  /* ---------------------------------------------------------- containment */

  /**
   * How much of the child column is found in the parent column, by rows and by distinct values, and the
   * number of child rows left without a parent. mode: exact | text | numeric.
   */
  function containment(project, ct, cc, pt, pc, mode) {
    var c = q(cc), p = q(pc), ce = c, pe = p;
    if (mode === 'text') { ce = 'trim(CAST(' + c + ' AS TEXT))'; pe = 'trim(CAST(' + p + ' AS TEXT))'; }
    if (mode === 'numeric') { ce = 'CAST(' + c + ' AS INTEGER)'; pe = 'CAST(' + p + ' AS INTEGER)'; }
    var r = project.rows(
      'WITH p AS (SELECT DISTINCT ' + pe + ' AS v FROM ' + q(pt) + ' WHERE ' + p + ' IS NOT NULL), ' +
      'c AS (SELECT ' + ce + ' AS v, count(*) AS k FROM ' + q(ct) + ' WHERE ' + c + ' IS NOT NULL GROUP BY 1) ' +
      'SELECT count(*), sum(c.v IN (SELECT v FROM p)), sum(CASE WHEN c.v IN (SELECT v FROM p) THEN 0 ELSE c.k END), ' +
      '(SELECT count(*) FROM p), sum(c.k) FROM c')[0];
    var d = r[0] || 0, hit = r[1] || 0, rowsTotal = r[4] || 0, orphans = r[2] || 0;
    /* ratio is weighted by rows, so a handful of one off bad values does not sink a real relationship.
       distinctRatio guards the other way: most of the distinct values must still be found. */
    return { distinct: d, matched: hit, ratio: rowsTotal ? 1 - orphans / rowsTotal : 0, distinctRatio: d ? hit / d : 0,
      orphanRows: orphans, parentDistinct: r[3] || 0 };
  }

  function compatMode(c, p) {
    if (c.cls === p.cls) return 'exact';
    if (c.cls === 'int' && p.allIntText) return 'numeric';
    if (p.cls === 'int' && c.allIntText) return 'numeric';
    return null;
  }

  /* --------------------------------------------------------------- analyze */

  /**
   * Analyze a project. Returns
   * {
   *   tables: profile,
   *   keys: [{ table, columns, score, label, best, reasons }],
   *   relations: [{ fromTable, fromColumns, toTable, toColumns, score, label, cardinality, optional, orphanRows,
   *                 containment, coverage, mode, ambiguous, alternates: [{ toTable, toColumns, score }], reasons }],
   *   stats: { pairsTested, ms }
   * }
   * keys holds every candidate with label weak or better. relations holds the best parent for each child
   * column with label weak or better. Show likely and strong as proposals and weak in a maybe drawer.
   */
  K.analyze = function (project, opts) {
    var o = opts || {}, t0 = QD._clock();
    var tables = K.profile(project), byName = {};
    tables.forEach(function (t) { byName[t.name] = t; });
    var keys = [], pairsTested = 0;

    /* single column keys */
    var singleByTable = {};
    tables.forEach(function (t) {
      singleByTable[t.name] = [];
      if (t.rowCount === 0) return;
      t.columns.forEach(function (p) {
        if (!p.unique || p.boolLike) return;
        var sc = scoreSingleKey(t, p);
        var k = { table: t.name, columns: [p.name], score: round2(sc.score), label: label(round2(sc.score)), best: false, reasons: sc.reasons, _p: p, _named: sc.named };
        singleByTable[t.name].push(k);
      });
      singleByTable[t.name].sort(function (a, b) { return b.score - a.score || a._p.ordinal - b._p.ordinal; });
    });

    /* parent candidates: unique, keyable columns */
    var parents = [];
    tables.forEach(function (t) {
      singleByTable[t.name].forEach(function (k) {
        if (keyable(k._p) && k.score >= 0.2) parents.push({ table: t, p: k._p, keyScore: k.score });
      });
    });

    /* best name evidence each child column has toward any table, used to stop a column that clearly
       names one table from being matched to another on values alone */
    function bestNamedElsewhere(ct, cp, exceptTable) {
      var best = 0;
      parents.forEach(function (par) {
        if (par.table.name === exceptTable) return;
        var ne = nameEvidence(ct.name, cp.name, par.table.name, par.p.name).score;
        if (ne > best) best = ne;
      });
      return best;
    }

    var candidates = [];
    tables.forEach(function (ct) {
      if (ct.rowCount === 0) return;
      ct.columns.forEach(function (cp) {
        if (!keyable(cp) || cp.distinct === 0) return;
        var forChild = [];
        parents.forEach(function (par) {
          var pp = par.p, pt = par.table;
          if (pt.name === ct.name && pp.name === cp.name) return;
          var mode = compatMode(cp, pp);
          var ne = nameEvidence(ct.name, cp.name, pt.name, pp.name);
          if (!mode) return;
          /* cheap pruning for integers: no overlap of ranges means no containment */
          if (mode === 'exact' && cp.cls === 'int' && (cp.max < pp.min || cp.min > pp.max)) return;
          if (cp.boolLike && ne.score < 0.85) return;
          pairsTested += 1;
          var con = containment(project, ct.name, cp.name, pt.name, pp.name, mode);
          if (con.ratio < K.MIN_CONTAINMENT && mode === 'exact' && cp.cls === 'text') {
            var con2 = containment(project, ct.name, cp.name, pt.name, pp.name, 'text');
            if (con2.ratio >= K.MIN_CONTAINMENT) { con = con2; mode = 'text'; }
          }
          if (con.ratio < K.MIN_CONTAINMENT || con.distinctRatio < K.MIN_DISTINCT) return;

          var reasons = [], coverage = con.parentDistinct ? con.matched / con.parentDistinct : 0;
          var trivial = pp.rangeLike;
          var value;
          if (trivial) {
            value = (pp.min <= 20) ? 0.15 : 0.3;
            var tight = cp.cls === 'int' && cp.distinct >= 8 && coverage >= 0.5 && cp.max >= pp.max * 0.9;
            if (tight) value = Math.max(value, 0.4);
            reasons.push('every value falls inside the key range of ' + pt.name + ', which row numbers do easily');
            if (tight) reasons.push('the values use most of that range');
          } else {
            value = cp.distinct >= 5 ? 0.6 : (cp.distinct >= 3 ? 0.45 : 0.25);
            if (cp.cls === 'text' && cp.maxLen <= 1) value = Math.min(value, 0.2);
            value += Math.min(0.1, coverage * 0.1);
            reasons.push(con.matched + ' of ' + con.distinct + ' distinct values exist in ' + pt.name + '.' + pp.name +
              ', and these are not simple row numbers');
          }
          var score = trivial ? value + 0.7 * ne.score : value + 0.3 * ne.score;
          if (ne.score > 0) reasons.push(ne.why);

          var selfRef = pt.name === ct.name;
          if (selfRef && ne.score < 0.7) return;
          if (!trivial && ne.score === 0 && selfRef) return;

          /* a column that plainly names another table does not get matched here on values alone */
          if (ne.score < 0.5) {
            var elsewhere = bestNamedElsewhere(ct, cp, pt.name);
            if (elsewhere >= 0.7) { score = Math.min(score, 0.2); }
            else if (trivial && value >= 0.4 && /^(id|key|fk|ref)$/.test(tokens(cp.name).slice(-1)[0] || '')) {
              score += 0.1;
              reasons.push('the name ends like a key but names no table, so the fit of the values decides');
            }
          }

          var oneToOne = cp.unique;
          if (oneToOne) {
            if (trivial && ne.score < 0.85) return; /* two row number columns always contain each other */
            score -= (ne.score >= 0.85) ? 0.05 : 0.15;
            reasons.push('each value appears once on both sides, so this is one to one');
          }
          if (con.ratio < 1) {
            score -= (1 - con.ratio) * 1.5;
            reasons.push(con.orphanRows + ' row' + (con.orphanRows === 1 ? '' : 's') + ' in ' + ct.name + ' point at a value missing from ' + pt.name);
          }
          if (mode !== 'exact') {
            score -= 0.05;
            reasons.push(mode === 'numeric' ? 'the values match once text is read as a number' : 'the values match once spaces are trimmed');
          }
          score *= (0.85 + 0.15 * Math.min(1, par.keyScore / 0.6));
          score = round2(clamp(score));
          forChild.push({
            fromTable: ct.name, fromColumns: [cp.name], toTable: pt.name, toColumns: [pp.name],
            score: score, label: label(score), cardinality: oneToOne ? 'one-to-one' : 'many-to-one',
            optional: cp.nonNull < cp.n, orphanRows: con.orphanRows, containment: round2(con.ratio), coverage: round2(coverage),
            mode: mode, ambiguous: false, alternates: [], reasons: reasons, _name: ne.score, _trivial: trivial, _value: value
          });
        });
        if (!forChild.length) return;
        forChild.sort(function (a, b) { return b.score - a.score || b._name - a._name || b.coverage - a.coverage; });
        var top = forChild[0];
        var rivals = forChild.slice(1).filter(function (x) { return x.score >= K.THRESHOLDS.weak && top.score - x.score <= 0.1; });
        if (rivals.length) {
          top.ambiguous = true;
          top.alternates = rivals.map(function (x) { return { toTable: x.toTable, toColumns: x.toColumns, score: x.score }; });
          /* a values only proposal with an equally good rival is a guess: keep it out of the proposals */
          if (top._name < 0.5 && top._trivial) {
            top.score = Math.min(top.score, round2(K.THRESHOLDS.likely - 0.05));
            top.label = label(top.score);
            top.reasons.push('but ' + rivals[0].toTable + ' fits about as well, so this needs a person to decide');
          }
        }
        if (top.label !== 'none') candidates.push(top);
      });
    });

    /* one to one pairs found in both directions: keep the direction whose parent is the stronger key */
    var relations = [], seen = {};
    candidates.sort(function (a, b) { return b.score - a.score; });
    candidates.forEach(function (r) {
      var rev = r.toTable + '.' + r.toColumns[0] + '>' + r.fromTable + '.' + r.fromColumns[0];
      var fwd = r.fromTable + '.' + r.fromColumns[0] + '>' + r.toTable + '.' + r.toColumns[0];
      if (seen[rev]) return;
      seen[fwd] = true;
      relations.push(r);
    });

    /* declared foreign keys in an adopted file always win */
    tables.forEach(function (t) {
      var groups = {};
      t.declaredFks.forEach(function (f) { (groups[f.id] = groups[f.id] || []).push(f); });
      Object.keys(groups).forEach(function (id) {
        var g = groups[id].sort(function (a, b) { return a.seq - b.seq; });
        var from = g.map(function (f) { return f.from; }), toT = g[0].table;
        var to = g.map(function (f) { return f.to; });
        if (to.some(function (x) { return x == null; })) {
          var pk = (byName[toT] ? byName[toT].columns : []).filter(function (c) { return c.declaredPk; })
            .sort(function (a, b) { return a.declaredPk - b.declaredPk; }).map(function (c) { return c.name; });
          to = pk;
        }
        if (!byName[toT] || to.length !== from.length) return;
        relations = relations.filter(function (r) { return !(r.fromTable === t.name && r.fromColumns.join() === from.join()); });
        relations.push({ fromTable: t.name, fromColumns: from, toTable: toT, toColumns: to, score: 1, label: 'strong',
          cardinality: 'many-to-one', optional: false, orphanRows: 0, containment: 1, coverage: 0, mode: 'exact', ambiguous: false,
          alternates: [], reasons: ['it is declared as a foreign key in the file'] });
      });
    });

    /* composite keys for tables with no convincing single key */
    var fkCols = {};
    relations.forEach(function (r) {
      if (r.score >= K.THRESHOLDS.likely) r.fromColumns.forEach(function (c) { fkCols[r.fromTable + '\u0000' + c] = true; });
    });
    tables.forEach(function (t) {
      var singles = singleByTable[t.name];
      var declared = t.columns.filter(function (c) { return c.declaredPk; }).sort(function (a, b) { return a.declaredPk - b.declaredPk; });
      if (declared.length > 1) {
        keys.push({ table: t.name, columns: declared.map(function (c) { return c.name; }), score: 1, label: 'strong', best: true,
          reasons: ['it is declared as the primary key in the file'] });
        return;
      }
      /* a unique column that is itself a likely foreign key is a weaker key than its name suggests */
      singles.forEach(function (k) {
        if (fkCols[t.name + '\u0000' + k.columns[0]] && !k._p.declaredPk) {
          var own = splitKey(k.columns[0]);
          if (!eqTokens(own.stem, tableTokens(t.name)) && tokens(k.columns[0]).join('_') !== 'id') {
            k.score = round2(Math.max(0, k.score - 0.25)); k.label = label(k.score);
            k.reasons.push('but it points at another table, so it may only be unique by accident');
          }
        }
      });
      singles.sort(function (a, b) { return b.score - a.score || a._p.ordinal - b._p.ordinal; });
      var haveStrongSingle = singles.length && singles[0].score >= K.THRESHOLDS.likely;
      var combos = [];
      if (!haveStrongSingle && t.rowCount > 1) {
        var pool = t.columns.filter(function (p) { return keyable(p) && p.nonNull === p.n && !p.boolLike; });
        var withDates = t.columns.filter(function (p) { return p.isDate && p.nonNull === p.n; });
        pool.sort(function (a, b) {
          var fa = fkCols[t.name + '\u0000' + a.name] ? 0 : 1, fb = fkCols[t.name + '\u0000' + b.name] ? 0 : 1;
          return fa - fb || a.ordinal - b.ordinal;
        });
        pool = pool.slice(0, o.maxCompositeColumns || 10);
        var i, j, k2;
        function scoreCombo(cols) {
          var s = 0.4, nfk = cols.filter(function (c) { return fkCols[t.name + '\u0000' + c.name]; }).length;
          var nkey = cols.filter(function (c) { return splitKey(c.name).suffix; }).length;
          s += 0.3 * (nfk / cols.length) + 0.1 * (nkey / cols.length);
          if (cols.length === 3) s -= 0.1;
          var why = ['no single column is unique, but these together are'];
          if (nfk === cols.length) why.push('each one points at another table, which is the shape of a link table');
          return { score: clamp(s), reasons: why };
        }
        for (i = 0; i < pool.length; i += 1) for (j = i + 1; j < pool.length; j += 1) {
          if (pool[i].distinct * pool[j].distinct < t.rowCount) continue;
          if (isUniqueCombo(project, t.name, [pool[i].name, pool[j].name])) combos.push([pool[i], pool[j]]);
        }
        if (!combos.length) {
          var pool3 = pool.slice(0, 7).concat(withDates.slice(0, 2));
          for (i = 0; i < pool3.length; i += 1) for (j = i + 1; j < pool3.length; j += 1) for (k2 = j + 1; k2 < pool3.length; k2 += 1) {
            if (pool3[i].distinct * pool3[j].distinct * pool3[k2].distinct < t.rowCount) continue;
            if (isUniqueCombo(project, t.name, [pool3[i].name, pool3[j].name, pool3[k2].name])) combos.push([pool3[i], pool3[j], pool3[k2]]);
          }
        }
        combos = combos.map(function (cols) {
          var sc = scoreCombo(cols);
          cols = cols.slice().sort(function (a, b) { return a.ordinal - b.ordinal; });
          return { table: t.name, columns: cols.map(function (c) { return c.name; }), score: round2(sc.score), label: label(round2(sc.score)), best: false, reasons: sc.reasons };
        }).sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
      }
      var all = singles.map(function (k) {
        return { table: k.table, columns: k.columns, score: k.score, label: k.label, best: false, reasons: k.reasons };
      }).concat(combos).filter(function (k) { return k.label !== 'none'; })
        .sort(function (a, b) { return b.score - a.score || a.columns.length - b.columns.length; });
      if (all.length) all[0].best = true;
      keys = keys.concat(all);
    });

    relations.forEach(function (r) { delete r._name; delete r._trivial; delete r._value; });
    relations.sort(function (a, b) { return a.fromTable < b.fromTable ? -1 : (a.fromTable > b.fromTable ? 1 : b.score - a.score); });
    tables.forEach(function (t) { delete t.declaredFks; });
    return { tables: tables, keys: keys, relations: relations, stats: { pairsTested: pairsTested, ms: QD._clock() - t0 } };
  };

  /**
   * Write an analysis into the project as proposals. Decisions already made by a person
   * (confirmed or rejected) are left alone. minLabel defaults to 'weak'.
   * Returns { keys, relations } counts written.
   */
  K.apply = function (project, analysis, opts) {
    var min = K.THRESHOLDS[(opts && opts.minLabel) || 'weak'];
    var decidedK = {}, decidedR = {}, nk = 0, nr = 0;
    project.keys().forEach(function (k) { if (k.status !== 'proposed') decidedK[k.table + '|' + k.columns.join(',')] = true; });
    project.relations().forEach(function (r) {
      if (r.status !== 'proposed') decidedR[r.fromTable + '|' + r.fromColumns.join(',') + '|' + r.toTable + '|' + r.toColumns.join(',')] = true;
    });
    project.db.run("DELETE FROM _qd_keys WHERE status = 'proposed'");
    project.db.run("DELETE FROM _qd_relations WHERE status = 'proposed'");
    analysis.keys.forEach(function (k) {
      if (k.score < min || decidedK[k.table + '|' + k.columns.join(',')]) return;
      project.setKey(k.table, k.columns, 'proposed', k.score, { label: k.label, best: k.best, reasons: k.reasons });
      nk += 1;
    });
    analysis.relations.forEach(function (r) {
      if (r.score < min || decidedR[r.fromTable + '|' + r.fromColumns.join(',') + '|' + r.toTable + '|' + r.toColumns.join(',')]) return;
      project.setRelation({ fromTable: r.fromTable, fromColumns: r.fromColumns, toTable: r.toTable, toColumns: r.toColumns,
        status: 'proposed', score: r.score, cardinality: r.cardinality,
        evidence: { label: r.label, mode: r.mode, optional: r.optional, orphanRows: r.orphanRows, containment: r.containment,
          coverage: r.coverage, ambiguous: r.ambiguous, alternates: r.alternates, reasons: r.reasons } });
      nr += 1;
    });
    return { keys: nk, relations: nr };
  };

  /* ------------------------------------------------------------ join paths */

  /**
   * Shortest chain of relationships between two tables, walking relationships in either direction.
   * relations is the array from project.relations('confirmed') or analysis.relations.
   * Returns [{ relation, forward }] or null when the tables are not connected. An empty array means from === to.
   */
  K.joinPath = function (relations, from, to) {
    if (from === to) return [];
    var adj = {};
    relations.forEach(function (r) {
      (adj[r.fromTable] = adj[r.fromTable] || []).push({ next: r.toTable, relation: r, forward: true });
      (adj[r.toTable] = adj[r.toTable] || []).push({ next: r.fromTable, relation: r, forward: false });
    });
    var queue = [from], prev = {}; prev[from] = null;
    while (queue.length) {
      var cur = queue.shift();
      if (cur === to) break;
      (adj[cur] || []).forEach(function (e) {
        if (e.next in prev) return;
        prev[e.next] = { at: cur, edge: e };
        queue.push(e.next);
      });
    }
    if (!(to in prev)) return null;
    var path = [], node = to;
    while (prev[node]) { path.unshift({ relation: prev[node].edge.relation, forward: prev[node].edge.forward }); node = prev[node].at; }
    return path;
  };

  function onExpr(leftAlias, leftCol, rightAlias, rightCol, mode) {
    var l = leftAlias + '.' + q(leftCol), r = rightAlias + '.' + q(rightCol);
    if (mode === 'text') return 'trim(CAST(' + l + ' AS TEXT)) = trim(CAST(' + r + ' AS TEXT))';
    if (mode === 'numeric') return 'CAST(' + l + ' AS INTEGER) = CAST(' + r + ' AS INTEGER)';
    return l + ' = ' + r;
  }

  /**
   * Write a SELECT that joins along a path from K.joinPath. Returns the SQL text, or null for a null path.
   * opts: { left: true } uses LEFT JOIN so rows without a match are kept.
   */
  K.joinSQL = function (from, path, opts) {
    if (!path) return null;
    var o = opts || {}, used = {}, aliasOf = {};
    function alias(t) {
      var base = tableTokens(t).map(function (w) { return w[0]; }).join('') || 't', a = base, k = 1;
      while (used[a]) { k += 1; a = base + k; }
      used[a] = true; return a;
    }
    var a0 = alias(from), cur = from, curAlias = a0;
    var lines = ['SELECT *', 'FROM ' + q(from) + ' AS ' + a0];
    path.forEach(function (step) {
      var r = step.relation, mode = r.mode || (r.evidence && r.evidence.mode) || 'exact';
      var nextT = step.forward ? r.toTable : r.fromTable, na = alias(nextT);
      var hereCols = step.forward ? r.fromColumns : r.toColumns, thereCols = step.forward ? r.toColumns : r.fromColumns;
      var conds = hereCols.map(function (c, i) { return onExpr(curAlias, c, na, thereCols[i], mode); });
      lines.push((o.left ? 'LEFT JOIN ' : 'JOIN ') + q(nextT) + ' AS ' + na + ' ON ' + conds.join(' AND '));
      cur = nextT; curAlias = na; aliasOf[nextT] = na;
    });
    return lines.join('\n');
  };

  K._nameEvidence = nameEvidence;
  K._abbrev = abbrev;
  K._singular = singular;

  root.QDKeys = K;
  if (typeof module !== 'undefined' && module.exports) module.exports = K;
})(typeof globalThis !== 'undefined' ? globalThis : this);
/* QD:KEYS END */
