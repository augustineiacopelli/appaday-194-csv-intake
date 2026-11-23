'use strict';
/* Report blocks (core 1.3.0, Day 200): the _qd_notebook methods, their rules, the delete cascades,
 * persistence, and a file written by 1.3.0 opening under the 1.2.0 core kept in test/legacy. */
const test = require('node:test');
const assert = require('node:assert/strict');
require('fake-indexeddb/auto');
const initSqlJs = require('sql.js');
const QD = require('../core/qd-core.js');
global.QD = QD;
const QDClinic = require('../core/qd-clinic.js');

const SPEC = { type: 'bar', x: 'campus', y: ['students'], series: null, stacked: false, sort: 'desc', limit: 50, title: 'Students per campus' };
const BAR = 'SELECT c.name AS campus, count(*) AS students FROM students s JOIN campuses c ON c.campus_id = s.home_campus_id GROUP BY c.name';

let p;
test.before(async () => { await QD.boot(initSqlJs); p = QDClinic.createProject(); });
test.after(() => { p.close(); });

function clear() { p.blocks().forEach(b => p.deleteBlock(b.id)); }
function refused(fn, re) {
  assert.throws(fn, e => e.kind === 'spec' && re.test(e.message));
}

test('the core reports version 1.3.0 and the block constants', () => {
  assert.equal(QD.VERSION, '1.3.0');
  assert.equal(QD.FORMAT_VERSION, 1);
  assert.deepEqual(QD.BLOCK_KINDS, ['text', 'query', 'chart']);
  assert.equal(QD.BLOCK_BODY_MAX, 20000);
});

test('each kind adds and reads back in order', () => {
  clear();
  const qid = p.saveQuery({ name: 'Students per campus', sql: BAR });
  const cid = p.saveChart({ queryId: qid, spec: SPEC });
  const a = p.addBlock({ kind: 'text', body: 'Opening note.' });
  const b = p.addBlock({ kind: 'query', refId: qid });
  const c = p.addBlock({ kind: 'chart', refId: cid, body: 'Riverbend leads.' });
  const bl = p.blocks();
  assert.deepEqual(bl.map(x => x.id), [a, b, c]);
  assert.deepEqual(bl.map(x => x.position), [0, 1, 2]);
  assert.deepEqual(bl.map(x => x.kind), ['text', 'query', 'chart']);
  assert.equal(bl[0].body, 'Opening note.');
  assert.equal(bl[0].refId, null);
  assert.equal(bl[1].refId, qid);
  assert.equal(bl[1].body, null);
  assert.equal(bl[2].refId, cid);
  assert.equal(bl[2].body, 'Riverbend leads.');
  assert.equal(typeof bl[0].createdAt, 'string');
  p.deleteQuery(qid);
  clear();
});

test('a position places the new block and renumbers the rest', () => {
  clear();
  const a = p.addBlock({ kind: 'text', body: 'A' });
  const b = p.addBlock({ kind: 'text', body: 'B' });
  const c = p.addBlock({ kind: 'text', body: 'C', position: 0 });
  assert.deepEqual(p.blocks().map(x => x.id), [c, a, b]);
  assert.deepEqual(p.blocks().map(x => x.position), [0, 1, 2]);
  clear();
});

test('bad blocks are refused with a reason', () => {
  clear();
  const qid = p.saveQuery({ name: 'q', sql: 'SELECT 1 AS one' });
  refused(() => p.addBlock({ kind: 'table', body: 'x' }), /note, a query or a chart/);
  refused(() => p.addBlock({}), /note, a query or a chart/);
  refused(() => p.addBlock({ kind: 'text', body: '' }), /needs some text/);
  refused(() => p.addBlock({ kind: 'text', body: '   ' }), /needs some text/);
  refused(() => p.addBlock({ kind: 'text' }), /needs some text/);
  refused(() => p.addBlock({ kind: 'text', body: 'x'.repeat(20001) }), /at most 20000/);
  refused(() => p.addBlock({ kind: 'query', refId: qid, body: 'x'.repeat(20001) }), /at most 20000/);
  refused(() => p.addBlock({ kind: 'text', body: 'x', refId: qid }), /does not point/);
  refused(() => p.addBlock({ kind: 'query' }), /needs the saved query/);
  refused(() => p.addBlock({ kind: 'chart' }), /needs the pinned chart/);
  refused(() => p.addBlock({ kind: 'query', refId: 987654 }), /saved query no longer exists/);
  refused(() => p.addBlock({ kind: 'chart', refId: 987654 }), /pinned chart no longer exists/);
  refused(() => p.addBlock({ kind: 'query', refId: qid, body: 42 }), /caption must be text/);
  assert.equal(p.blocks().length, 0);
  /* exactly at the cap is allowed */
  p.addBlock({ kind: 'text', body: 'x'.repeat(20000) });
  assert.equal(p.blocks().length, 1);
  p.deleteQuery(qid);
  clear();
});

test('moveBlock reorders and renumbers from 0', () => {
  clear();
  const ids = ['A', 'B', 'C', 'D'].map(t => p.addBlock({ kind: 'text', body: t }));
  p.moveBlock(ids[3], 0);
  assert.deepEqual(p.blocks().map(x => x.body), ['D', 'A', 'B', 'C']);
  p.moveBlock(ids[3], 99);
  assert.deepEqual(p.blocks().map(x => x.body), ['A', 'B', 'C', 'D']);
  p.moveBlock(ids[2], 1);
  assert.deepEqual(p.blocks().map(x => x.body), ['A', 'C', 'B', 'D']);
  p.moveBlock(ids[0], -5);
  assert.deepEqual(p.blocks().map(x => x.position), [0, 1, 2, 3]);
  p.moveBlock(424242, 0); /* unknown id is a no op */
  assert.deepEqual(p.blocks().map(x => x.body), ['A', 'C', 'B', 'D']);
  clear();
});

test('updateBlock changes only the body', () => {
  clear();
  const qid = p.saveQuery({ name: 'q', sql: 'SELECT 1 AS one' });
  const t = p.addBlock({ kind: 'text', body: 'Before' });
  const q = p.addBlock({ kind: 'query', refId: qid });
  const before = p.blocks();
  p.updateBlock(t, { body: 'After' });
  p.updateBlock(q, { body: 'A caption' });
  const after = p.blocks();
  assert.equal(after[0].body, 'After');
  assert.equal(after[1].body, 'A caption');
  ['id', 'position', 'kind', 'refId', 'createdAt'].forEach(k => {
    assert.equal(after[0][k], before[0][k]); assert.equal(after[1][k], before[1][k]);
  });
  p.updateBlock(q, { body: '' });
  assert.equal(p.blocks()[1].body, null);
  refused(() => p.updateBlock(t, { body: '' }), /needs some text/);
  refused(() => p.updateBlock(t, { body: 'x'.repeat(20001) }), /at most 20000/);
  refused(() => p.updateBlock(999999, { body: 'x' }), /no longer exists/);
  assert.equal(p.blocks()[0].body, 'After');
  p.deleteQuery(qid);
  clear();
});

test('deleteBlock removes one block and leaves the rest', () => {
  clear();
  const a = p.addBlock({ kind: 'text', body: 'A' });
  const b = p.addBlock({ kind: 'text', body: 'B' });
  p.deleteBlock(a);
  assert.deepEqual(p.blocks().map(x => x.id), [b]);
  clear();
});

test('deleteChart removes the blocks that show it', () => {
  clear();
  const qid = p.saveQuery({ name: 'q', sql: BAR });
  const cid = p.saveChart({ queryId: qid, spec: SPEC });
  p.addBlock({ kind: 'chart', refId: cid });
  const keep = p.addBlock({ kind: 'query', refId: qid });
  p.deleteChart(cid);
  assert.deepEqual(p.blocks().map(x => x.id), [keep]);
  p.deleteQuery(qid);
  clear();
});

test('deleteQuery removes its query blocks and the blocks of its charts', () => {
  clear();
  const qid = p.saveQuery({ name: 'q', sql: BAR });
  const other = p.saveQuery({ name: 'other', sql: BAR });
  const c1 = p.saveChart({ queryId: qid, spec: SPEC });
  const c2 = p.saveChart({ queryId: qid, spec: Object.assign({}, SPEC, { type: 'pie' }) });
  const c3 = p.saveChart({ queryId: other, spec: SPEC });
  p.addBlock({ kind: 'query', refId: qid });
  p.addBlock({ kind: 'chart', refId: c1 });
  p.addBlock({ kind: 'chart', refId: c2 });
  const n = p.addBlock({ kind: 'text', body: 'Stays' });
  const o = p.addBlock({ kind: 'chart', refId: c3 });
  p.deleteQuery(qid);
  assert.deepEqual(p.blocks().map(x => x.id), [n, o]);
  assert.equal(Number(p.scalar('SELECT count(*) FROM _qd_notebook WHERE ref_id NOT IN (SELECT id FROM _qd_charts) AND kind = \'chart\'')), 0);
  p.deleteQuery(other);
  clear();
});

test('execute still refuses to write _qd_notebook', () => {
  assert.throws(() => p.execute("INSERT INTO _qd_notebook (position, kind, body) VALUES (0, 'text', 'x')"), e => e.kind === 'guard');
  assert.throws(() => p.execute('DELETE FROM _qd_notebook'), e => e.kind === 'guard');
  assert.throws(() => p.query("INSERT INTO _qd_notebook (position, kind, body) VALUES (0, 'text', 'x')"));
});

test('the change listener receives notebook', () => {
  clear();
  const seen = [];
  const off = p.onChange(k => seen.push(k));
  const id = p.addBlock({ kind: 'text', body: 'x' });
  p.updateBlock(id, { body: 'y' });
  p.addBlock({ kind: 'text', body: 'z' });
  p.moveBlock(id, 1);
  p.deleteBlock(id);
  off();
  assert.deepEqual(seen, ['notebook', 'notebook', 'notebook', 'notebook', 'notebook']);
  clear();
});

test('the report title defaults to the project name and is capped', () => {
  assert.equal(p.reportTitle(), p.name);
  p.setReportTitle('  Fall enrollment review  ');
  assert.equal(p.reportTitle(), 'Fall enrollment review');
  assert.equal(p.getMeta('report_title'), 'Fall enrollment review');
  refused(() => p.setReportTitle('x'.repeat(201)), /at most 200/);
  p.setReportTitle('x'.repeat(200));
  assert.equal(p.reportTitle().length, 200);
  p.setReportTitle('');
  assert.equal(p.reportTitle(), p.name);
});

function buildReport() {
  clear();
  const qid = p.saveQuery({ name: 'Students per campus', sql: BAR, origin: 'ask', question: 'How many students per campus?' });
  const cid = p.saveChart({ queryId: qid, spec: SPEC });
  p.setReportTitle('Campus report');
  const ids = [
    p.addBlock({ kind: 'text', body: 'Line one\n\nLine two' }),
    p.addBlock({ kind: 'query', refId: qid, body: 'Counts by home campus.' }),
    p.addBlock({ kind: 'chart', refId: cid })
  ];
  p.setRelation({ fromTable: 'students', fromColumns: ['home_campus_id'], toTable: 'campuses', toColumns: ['campus_id'], status: 'confirmed' });
  return { qid, cid, ids };
}

test('blocks and the report title survive export and QD.open', () => {
  const r = buildReport();
  const before = p.blocks();
  const p2 = QD.open(p.export('200'));
  assert.deepEqual(p2.blocks(), before);
  assert.equal(p2.reportTitle(), 'Campus report');
  assert.equal(p2.getMeta('last_app'), '200');
  p2.close();
  p.deleteQuery(r.qid);
  p.setReportTitle('');
  clear();
});

test('a file written by 1.3.0 with blocks opens under the 1.2.0 core with everything else intact', async () => {
  const r = buildReport();
  const bytes = p.export('200');
  const wantQueries = p.queries().map(q => [q.id, q.name, q.sql, q.origin, q.question]);
  const wantCharts = p.charts().map(c => [c.id, c.queryId, JSON.stringify(c.spec), c.position]);
  const wantRel = p.relations('confirmed').length;
  const Old = require('./legacy/qd-core-1.2.0.js');
  assert.notEqual(Old, QD);
  assert.equal(Old.VERSION, '1.2.0');
  await Old.boot(initSqlJs);
  const o = Old.open(bytes);
  assert.deepEqual(o.queries().map(q => [q.id, q.name, q.sql, q.origin, q.question]), wantQueries);
  assert.deepEqual(o.charts().map(c => [c.id, c.queryId, JSON.stringify(c.spec), c.position]), wantCharts);
  assert.equal(o.relations('confirmed').length, wantRel);
  assert.equal(Number(o.scalar('SELECT count(*) FROM _qd_notebook')), 3);
  assert.equal(o.query('SELECT count(*) AS n FROM students').rows[0][0], 400);
  /* and the 1.2.0 save comes back to 1.3.0 with the blocks still in order */
  const back = QD.open(o.export('199'));
  assert.deepEqual(back.blocks().map(b => b.id), r.ids);
  back.close(); o.close();
  p.deleteQuery(r.qid);
  p.setReportTitle('');
  clear();
});

test('the core is still ASCII clean', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'core', 'qd-core.js'), 'utf8');
  for (let i = 0; i < src.length; i++) assert.ok(src.charCodeAt(i) < 128, 'non ASCII at ' + i);
});
