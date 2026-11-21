/* QD:CHARTS BEGIN v1.0.0 */
/*
 * Query Desk charts: reads the shape of a query result and turns it into a chart spec and chart data.
 * Pure JavaScript with no reference to any charting library, so Day 198 and Day 200 can draw the
 * same rows with whatever renderer they carry. Depends on nothing; QD:CORE validates stored specs.
 *
 * The spec is exactly { type, x, y, series, stacked, sort, limit, title }.
 * ASCII only.
 */
(function (root) {
  'use strict';

  var Q = {};
  Q.VERSION = '1.0.0';
  Q.DEFAULT_LIMIT = 50;
  Q.MAX_SERIES = 8;
  Q.PIE_MAX_ROWS = 6;

  var DATE_VALUE = /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/;
  var DATE_NAME = /(year|month|term|quarter|week|period)/i;
  var ID_NAME = /id$/i;

  function columnValues(result, i) {
    var out = [], r;
    for (r = 0; r < result.rows.length; r += 1) out.push(result.rows[r][i]);
    return out;
  }

  /**
   * Label each column of a result as number, date or label.
   * Returns [{ name, index, kind, distinct, positive }].
   */
  Q.profile = function (result) {
    var cols = (result && result.columns) || [];
    return cols.map(function (name, i) {
      var vals = columnValues(result, i), present = vals.filter(function (v) { return v !== null && v !== undefined && v !== ''; });
      var numeric = present.length > 0 && present.every(function (v) { return typeof v === 'number' && isFinite(v); });
      var dateLike = present.length > 0 && present.every(function (v) { return typeof v === 'string' && DATE_VALUE.test(v); });
      var idName = ID_NAME.test(String(name));
      var kind;
      if (numeric && idName) kind = 'label';
      else if (dateLike || (!idName && DATE_NAME.test(String(name)) && present.length > 0)) kind = 'date';
      else if (numeric) kind = 'number';
      else kind = 'label';
      var seen = {}, distinct = 0;
      present.forEach(function (v) { var k = String(v); if (!seen[k]) { seen[k] = true; distinct += 1; } });
      return { name: name, index: i, kind: kind, distinct: distinct,
        positive: numeric && present.every(function (v) { return v > 0; }) };
    });
  };

  function spec(type, x, y, series, sort, title) {
    return { type: type, x: x, y: y, series: series, stacked: false, sort: sort, limit: Q.DEFAULT_LIMIT, title: title || '' };
  }

  /**
   * Decide the first chart for a result.
   * Returns { spec, types, shape, reason, profile }. spec is null when no chart fits, and reason says why.
   * opts: { title }
   */
  Q.suggest = function (result, opts) {
    var o = opts || {}, title = o.title || '', prof = Q.profile(result);
    var nums = prof.filter(function (c) { return c.kind === 'number'; });
    var dates = prof.filter(function (c) { return c.kind === 'date'; });
    var labels = prof.filter(function (c) { return c.kind === 'label'; });
    var rows = result && result.rows ? result.rows.length : 0;
    function out(s, types, shape) { return { spec: s, types: types, shape: shape, reason: null, profile: prof }; }
    function none(reason) { return { spec: null, types: [], shape: 'none', reason: reason, profile: prof }; }

    if (!prof.length) return none('The query returned no columns to chart.');
    if (!rows) return none('The query returned no rows, so there is nothing to chart.');
    if (rows === 1 && prof.length === 1) {
      return out(spec('tile', null, [prof[0].name], null, 'none', title), ['tile'], 'tile');
    }
    if (dates.length === 1 && labels.length === 0 && nums.length >= 1 && nums.length <= 4) {
      return out(spec('line', dates[0].name, nums.map(function (c) { return c.name; }), null, 'asc', title), ['line', 'bar'], 'line');
    }
    if (labels.length === 2 && nums.length === 1 && dates.length === 0) {
      return out(spec('bar', labels[0].name, [nums[0].name], labels[1].name, 'none', title), ['bar', 'line'], 'pivot');
    }
    if (labels.length === 1 && nums.length === 1 && dates.length === 0) {
      var types = ['bar'];
      if (rows <= Q.PIE_MAX_ROWS && nums[0].positive) types.push('pie');
      return out(spec('bar', labels[0].name, [nums[0].name], null, 'desc', title), types, 'bar');
    }
    if (nums.length === 2 && labels.length === 0 && dates.length === 0) {
      return out(spec('scatter', nums[0].name, [nums[1].name], null, 'none', title), ['scatter'], 'scatter');
    }
    if (rows === 1) return none('A single row with several columns has no chart. Return one value for a number tile.');
    if (!nums.length) return none('A chart needs at least one number column, and this result has none.');
    if (nums.length > 4 && dates.length) return none('A line chart can show at most four number columns.');
    if (labels.length > 2) return none('Charts read at most two label columns, and this result has ' + labels.length + '.');
    return none('This mix of columns has no chart. Try one label with one number, a date with up to four numbers, or two numbers.');
  };

  function colIndex(result, name) {
    var i = result.columns.indexOf(name);
    if (i < 0) { var e = new Error('The column ' + name + ' is not in this result.'); e.kind = 'column'; throw e; }
    return i;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : (v === null || v === undefined || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null)); }
  function key(v) { return v === null || v === undefined || v === '' ? '(blank)' : String(v); }
  function cmp(a, b) {
    var na = Number(a), nb = Number(b);
    if (a !== '' && b !== '' && isFinite(na) && isFinite(nb)) return na - nb;
    return a < b ? -1 : (a > b ? 1 : 0);
  }

  /**
   * Turn a result and a spec into chart data, after pivot, sort and limit.
   * Returns { labels, datasets: [{ label, data }], type, truncated }.
   * Scatter data points are { x, y }. A tile has one dataset with one value.
   * Throws an Error with kind 'column' when the spec names a column the result does not have.
   */
  Q.data = function (result, sp) {
    var s = sp, rows = result.rows || [], limit = s.limit || Q.DEFAULT_LIMIT, i;
    if (s.type === 'tile') {
      var ti = colIndex(result, s.y[0]);
      return { labels: [s.y[0]], datasets: [{ label: s.y[0], data: [rows.length ? rows[0][ti] : null] }], type: 'tile', truncated: false };
    }
    var xi = colIndex(result, s.x);
    var yis = s.y.map(function (c) { return colIndex(result, c); });

    if (s.type === 'scatter') {
      var pts = [];
      for (i = 0; i < rows.length; i += 1) {
        var px = num(rows[i][xi]), py = num(rows[i][yis[0]]);
        if (px !== null && py !== null) pts.push({ x: px, y: py });
      }
      var cut = pts.length > limit;
      return { labels: [], datasets: [{ label: s.y[0], data: pts.slice(0, limit) }], type: 'scatter', truncated: cut };
    }

    var order = [], sums = {}, seriesNames = [], seriesTotals = {};
    if (s.series) {
      var si = colIndex(result, s.series), yi = yis[0];
      for (i = 0; i < rows.length; i += 1) {
        var kx = key(rows[i][xi]), ks = key(rows[i][si]), v = num(rows[i][yi]) || 0;
        if (!(kx in sums)) { sums[kx] = {}; order.push(kx); }
        if (!(ks in seriesTotals)) { seriesTotals[ks] = 0; seriesNames.push(ks); }
        sums[kx][ks] = (sums[kx][ks] || 0) + v;
        seriesTotals[ks] += v;
      }
      if (seriesNames.length > Q.MAX_SERIES) {
        var ranked = seriesNames.slice().sort(function (a, b) { return seriesTotals[b] - seriesTotals[a]; });
        var keep = ranked.slice(0, Q.MAX_SERIES - 1), keepSet = {};
        keep.forEach(function (k) { keepSet[k] = true; });
        order.forEach(function (kx) {
          var other = 0;
          Object.keys(sums[kx]).forEach(function (ks) { if (!keepSet[ks]) { other += sums[kx][ks]; delete sums[kx][ks]; } });
          if (other) sums[kx].Other = other;
        });
        seriesNames = seriesNames.filter(function (k) { return keepSet[k]; }).concat(['Other']);
      }
    } else {
      seriesNames = s.y.slice();
      for (i = 0; i < rows.length; i += 1) {
        var k = key(rows[i][xi]);
        if (!(k in sums)) { sums[k] = {}; order.push(k); }
        yis.forEach(function (yIdx, j) {
          var val = num(rows[i][yIdx]);
          if (val === null) { if (!(seriesNames[j] in sums[k])) sums[k][seriesNames[j]] = null; return; }
          sums[k][seriesNames[j]] = (sums[k][seriesNames[j]] || 0) + val;
        });
      }
    }
    function total(kx) {
      var t = 0;
      seriesNames.forEach(function (n) { t += sums[kx][n] || 0; });
      return t;
    }
    var byX = s.type === 'line';
    if (s.sort === 'asc') order.sort(function (a, b) { return byX ? cmp(a, b) : total(a) - total(b); });
    else if (s.sort === 'desc') order.sort(function (a, b) { return byX ? cmp(b, a) : total(b) - total(a); });
    var truncated = order.length > limit;
    order = order.slice(0, limit);
    var fillZero = !!s.series || s.type !== 'line';
    var datasets = seriesNames.map(function (n) {
      return { label: n, data: order.map(function (kx) {
        var v = sums[kx][n];
        return v === undefined || v === null ? (fillZero ? 0 : null) : v;
      }) };
    });
    if (s.type === 'pie') datasets = datasets.slice(0, 1);
    return { labels: order, datasets: datasets, type: s.type, truncated: truncated };
  };

  root.QDCharts = Q;
  if (typeof module !== 'undefined' && module.exports) module.exports = Q;
})(typeof globalThis !== 'undefined' ? globalThis : this);
/* QD:CHARTS END */
