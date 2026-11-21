'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('fake-indexeddb/auto');
const initSqlJs = require('sql.js');
const QD = require('../core/qd-core.js');
global.QD = QD;
const QDClinic = require('../core/qd-clinic.js');
const QDCharts = require('../core/qd-charts.js');

let p;
test.before(async () => { await QD.boot(initSqlJs); p = QDClinic.createProject(); });
test.after(() => { p.close(); });

/* The six sample chart queries the Day 198 chips use. Kept here so the tests and the app agree. */
const SAMPLES = {
  tile: 'SELECT count(*) AS students FROM students',
  bar: 'SELECT c.name AS campus, count(*) AS students FROM students s JOIN campuses c ON c.campus_id = s.home_campus_id GROUP BY c.name',
  pie: "SELECT CASE WHEN closed_on IS NULL THEN 'Open' ELSE 'Closed' END AS status, count(*) AS work_orders FROM work_orders GROUP BY 1",
  line: 'SELECT t.start_date AS term_start, count(*) AS enrollments FROM enrollments e JOIN sections s ON s.section_id = e.section_id ' +
    'JOIN terms t ON t.term_id = s.term_id GROUP BY t.term_id',
  scatter: 'SELECT i.salary, (SELECT count(*) FROM sections s WHERE s.instructor_id = i.instructor_id) AS sections_taught FROM instructors i',
  pivot: "SELECT d.name AS department, coalesce(e.grade, 'W') AS grade, count(*) AS enrollments FROM enrollments e " +
    'JOIN sections s ON s.section_id = e.section_id JOIN courses c ON c.course_id = s.course_id JOIN departments d ON d.dept_id = c.dept_id ' +
    "WHERE e.status IN ('Completed', 'Withdrawn') GROUP BY d.name, coalesce(e.grade, 'W')"
};
const q = sql => p.query(sql, { history: false });

test('shape: a single value gives a tile', () => {
  const g = QDCharts.suggest(q(SAMPLES.tile), { title: 'Students' });
  assert.equal(g.spec.type, 'tile');
  assert.deepEqual(g.types, ['tile']);
  assert.equal(g.spec.title, 'Students');
  assert.deepEqual(QDCharts.data(q(SAMPLES.tile), g.spec).datasets[0].data, [400]);
});

test('shape: a date column and numbers give a line sorted ascending', () => {
  const r = p.query(SAMPLES.line + ' ORDER BY t.start_date DESC', { history: false });
  const g = QDCharts.suggest(r);
  assert.equal(g.spec.type, 'line');
  assert.equal(g.spec.x, 'term_start');
  assert.equal(g.spec.sort, 'asc');
  const d = QDCharts.data(r, g.spec);
  assert.deepEqual(d.labels, d.labels.slice().sort());
  assert.equal(d.labels.length, 6);
});

test('shape: two labels and a number give a grouped bar through a pivot', () => {
  const g = QDCharts.suggest(q(SAMPLES.pivot));
  assert.equal(g.shape, 'pivot');
  assert.equal(g.spec.type, 'bar');
  assert.equal(g.spec.x, 'department');
  assert.equal(g.spec.series, 'grade');
  const d = QDCharts.data(q(SAMPLES.pivot), g.spec);
  assert.ok(d.datasets.length >= 2 && d.datasets.length <= 8);
  d.datasets.forEach(ds => assert.equal(ds.data.length, d.labels.length));
});

test('shape: one label and one number give a bar sorted descending, and pie when it fits', () => {
  const g = QDCharts.suggest(q(SAMPLES.bar));
  assert.equal(g.spec.type, 'bar');
  assert.equal(g.spec.sort, 'desc');
  assert.deepEqual(g.types, ['bar', 'pie']);
  const vals = QDCharts.data(q(SAMPLES.bar), g.spec).datasets[0].data;
  assert.deepEqual(vals, vals.slice().sort((a, b) => b - a));
  const pie = QDCharts.suggest(q(SAMPLES.pie));
  assert.ok(pie.types.includes('pie'));
  const many = QDCharts.suggest(q('SELECT title, credits FROM courses'));
  assert.deepEqual(many.types, ['bar']);
});

test('shape: two numbers give a scatter', () => {
  const g = QDCharts.suggest(q(SAMPLES.scatter));
  assert.equal(g.spec.type, 'scatter');
  const d = QDCharts.data(q(SAMPLES.scatter), g.spec);
  assert.ok(d.datasets[0].data.length > 10);
  assert.ok('x' in d.datasets[0].data[0] && 'y' in d.datasets[0].data[0]);
});

test('shape: anything else gives no chart with a reason', () => {
  const g = QDCharts.suggest(q('SELECT first_name, last_name, email FROM students'));
  assert.equal(g.spec, null);
  assert.equal(g.types.length, 0);
  assert.match(g.reason, /number/);
  assert.equal(QDCharts.suggest(q('SELECT * FROM students WHERE 0')).spec, null);
});

test('pivot fills a missing combination with zero', () => {
  const r = { columns: ['campus', 'kind', 'n'], rows: [['A', 'x', 3], ['A', 'y', 2], ['B', 'x', 5]] };
  const g = QDCharts.suggest(r);
  const d = QDCharts.data(r, Object.assign({}, g.spec, { sort: 'none' }));
  assert.deepEqual(d.labels, ['A', 'B']);
  assert.deepEqual(d.datasets.find(s => s.label === 'y').data, [2, 0]);
  assert.deepEqual(d.datasets.find(s => s.label === 'x').data, [3, 5]);
});

test('pivot caps the series at eight', () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(['A', 's' + i, i + 1]);
  const r = { columns: ['x', 's', 'n'], rows };
  const d = QDCharts.data(r, QDCharts.suggest(r).spec);
  assert.equal(d.datasets.length, 8);
  assert.equal(d.datasets[7].label, 'Other');
  assert.equal(d.datasets.reduce((t, s) => t + s.data[0], 0), 78);
});

test('a numeric column whose name ends in id counts as a label', () => {
  const r = q('SELECT campus_id, count(*) AS rooms FROM rooms GROUP BY campus_id');
  const prof = QDCharts.profile(r);
  assert.equal(prof[0].kind, 'label');
  assert.equal(prof[1].kind, 'number');
  assert.equal(QDCharts.suggest(r).spec.type, 'bar');
  assert.equal(QDCharts.profile(q('SELECT opened_year FROM campuses'))[0].kind, 'date');
});

test('a spec outside the fixed shape is refused', () => {
  const good = QDCharts.suggest(q(SAMPLES.bar)).spec;
  assert.equal(QD.validateChartSpec(good).ok, true);
  assert.throws(() => p.saveChart({ queryId: null, spec: Object.assign({}, good, { color: 'red' }) }), /cannot carry color/);
  assert.throws(() => p.saveChart({ queryId: null, spec: Object.assign({}, good, { type: 'donut' }) }), /type/);
  const missing = Object.assign({}, good); delete missing.limit;
  assert.throws(() => p.saveChart({ queryId: null, spec: missing }), /needs limit/);
  assert.throws(() => p.updateChart(1, Object.assign({}, good, { y: [] })), /one to four/);
});

test('a chart is saved, moved and deleted', () => {
  const qid = p.saveQuery({ name: 'Students per campus', sql: SAMPLES.bar });
  assert.equal(typeof qid, 'number');
  const spec = QDCharts.suggest(q(SAMPLES.bar), { title: 'Students per campus' }).spec;
  const a = p.saveChart({ queryId: qid, spec });
  const b = p.saveChart({ queryId: qid, spec: Object.assign({}, spec, { type: 'pie' }) });
  const c = p.saveChart({ queryId: qid, spec: Object.assign({}, spec, { sort: 'asc' }) });
  assert.deepEqual(p.charts().map(x => x.id), [a, b, c]);
  p.moveChart(c, 0);
  assert.deepEqual(p.charts().map(x => x.id), [c, a, b]);
  p.moveChart(c, 9);
  assert.deepEqual(p.charts().map(x => x.id), [a, b, c]);
  p.updateChart(a, Object.assign({}, spec, { title: 'Renamed' }));
  assert.equal(p.charts()[0].spec.title, 'Renamed');
  assert.equal(p.charts()[0].queryId, qid);
  p.deleteChart(b);
  assert.deepEqual(p.charts().map(x => x.id), [a, c]);
  p.deleteChart(a); p.deleteChart(c);
});

test('a pinned chart survives export and reopen and reflects changed data', () => {
  const qid = p.saveQuery({ name: 'Students', sql: SAMPLES.tile });
  const spec = QDCharts.suggest(q(SAMPLES.tile), { title: 'Students' }).spec;
  const id = p.saveChart({ queryId: qid, spec });
  const p2 = QD.open(p.export('198'));
  const ch = p2.charts();
  assert.equal(ch.length, 1);
  assert.equal(ch[0].id, id);
  assert.deepEqual(ch[0].spec, spec);
  p2.execute("INSERT INTO students (student_id, first_name, last_name) VALUES (9999, 'New', 'Student')");
  const sql = p2.getQuery(ch[0].queryId).sql;
  assert.deepEqual(QDCharts.data(p2.query(sql), ch[0].spec).datasets[0].data, [401]);
  assert.equal(p2.getMeta('core_version') !== null, true);
  p2.close();
  p.deleteChart(id);
});

test('data names the missing column when a query changed under a chart', () => {
  const spec = QDCharts.suggest(q(SAMPLES.bar)).spec;
  assert.throws(() => QDCharts.data(q('SELECT name, city FROM campuses'), spec), /The column campus is not in this result/);
});

test('the charts module is ASCII and never references Chart.js', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'core', 'qd-charts.js'), 'utf8');
  for (let i = 0; i < src.length; i++) assert.ok(src.charCodeAt(i) < 128, 'non ASCII at ' + i);
  assert.ok(!/new Chart\b|Chart\.(defaults|register)/.test(src));
});

module.exports = { SAMPLES };
