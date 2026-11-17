'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('fake-indexeddb/auto');
const initSqlJs = require('sql.js');
const QD = require('../core/qd-core.js');

test.before(async () => { await QD.boot(initSqlJs); });

test('cleanName handles awkward headers', () => {
  assert.equal(QD.cleanName('Student ID'), 'student_id');
  assert.equal(QD.cleanName('firstName'), 'first_name');
  assert.equal(QD.cleanName('% Complete'), 'pct_complete');
  assert.equal(QD.cleanName('2024 Total'), 'n_2024_total');
  assert.equal(QD.cleanName('Order'), 'order_');
  assert.equal(QD.cleanName('select'), 'select_');
  assert.equal(QD.cleanName(''), 'col');
  assert.equal(QD.cleanName('   ', 'col_3'), 'col_3');
  assert.equal(QD.cleanName('_qd_meta'), 'x_qd_meta');
  assert.equal(QD.cleanName('sqlite_master'), 'x_sqlite_master');
  assert.equal(QD.cleanName('enrollments.csv'), 'enrollments');
  assert.equal(QD.cleanName('Fall 2026 Sections.CSV'), 'fall_2026_sections');
  assert.equal(QD.cleanName('v1.2 notes'), 'v1_2_notes');
  assert.equal(QD.cleanName('Cost ($)'), 'cost_usd');
  assert.ok(QD.cleanName('x'.repeat(200)).length <= 60);
  assert.deepEqual(QD.uniqueNames(['id', 'name', 'id', 'ID']), ['id', 'name', 'id_2', 'ID_3']);
  assert.deepEqual(QD.uniqueNames(['t'], ['t', 't_2']), ['t_3']);
});

test('parseCSV: quotes, embedded newlines, CRLF, BOM, delimiters', () => {
  const r = QD.parseCSV('﻿a,b,c\r\n1,"x, y","line1\nline2"\r\n2,"say ""hi""",\r\n\r\n3,,z');
  assert.deepEqual(r.rows, [['a', 'b', 'c'], ['1', 'x, y', 'line1\nline2'], ['2', 'say "hi"', ''], ['3', '', 'z']]);
  assert.equal(r.delimiter, ',');
  assert.equal(QD.parseCSV('a\tb\n1\t2\n').delimiter, '\t');
  assert.equal(QD.parseCSV('a;b;c\n1,5;2;3\n4,5;5;6\n').delimiter, ';');
  assert.equal(QD.parseCSV('a|b\n1|2\n').delimiter, '|');
  assert.deepEqual(QD.parseCSV('a,b\r1,2\r').rows, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(QD.parseCSV('a,b\n1,""\n').rows, [['a', 'b'], ['1', '']]);
  assert.deepEqual(QD.parseCSV('a,b\n1,2').rows, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(QD.parseCSV('a,b\n1,').rows, [['a', 'b'], ['1', '']]);
  assert.deepEqual(QD.parseCSV('name\n5" pipe\n', { delimiter: ',' }).rows, [['name'], ['5" pipe']]);
  const t = QD.parseCSV('a\n1\n2\n3\n', { delimiter: ',', maxRows: 2 });
  assert.equal(t.rows.length, 2); assert.equal(t.truncated, true);
  assert.deepEqual(QD.parseCSV('single\n', {}).rows, [['single']]);
});

test('inferColumn: core types', () => {
  assert.equal(QD.inferColumn(['1', '2', '-3', '']).type, 'integer');
  assert.equal(QD.inferColumn(['1.5', '2', '3e2']).type, 'real');
  assert.equal(QD.inferColumn(['yes', 'No', 'Y', 'n']).type, 'boolean');
  assert.equal(QD.inferColumn(['2026-01-05', '2026-12-31']).type, 'date');
  assert.equal(QD.inferColumn(['2026-01-05 13:45', '2026-12-31T08:00:00Z']).type, 'datetime');
  assert.equal(QD.inferColumn(['a', 'b']).type, 'text');
  assert.equal(QD.inferColumn(['', 'NA', 'null']).type, 'text');
  assert.equal(QD.inferColumn(['', 'NA', 'null']).count, 0);
});

test('inferColumn: codes with leading zeros stay text', () => {
  const zip = QD.inferColumn(['67202', '02134', '00501']);
  assert.equal(zip.type, 'text');
  assert.match(zip.note, /leading zeros/);
  assert.equal(QD.inferColumn(['0', '1', '10']).type, 'integer');
  assert.equal(QD.inferColumn(['0.5', '0', '1.25']).type, 'real');
  assert.equal(QD.inferColumn(['12345678901234567890']).type, 'text');
});

test('inferColumn: 0 and 1 flagged, money stripped, near miss reported', () => {
  assert.match(QD.inferColumn(['0', '1', '1', '0']).note, /yes or no/);
  const money = QD.inferColumn(['$1,234.50', '(45.00)', '-$3', '12%']);
  assert.equal(money.type, 'real'); assert.equal(money.money, true);
  const vals = []; for (let i = 0; i < 99; i++) vals.push(String(i)); vals.push('unknown');
  const nm = QD.inferColumn(vals);
  assert.equal(nm.type, 'text');
  assert.equal(nm.nearMiss.type, 'integer');
  assert.deepEqual(nm.nearMiss.misfits, ['unknown']);
  assert.equal(QD.inferColumn(vals, { tolerance: 0.02 }).type, 'integer');
});

test('inferColumn: slash dates and day month order', () => {
  const us = QD.inferColumn(['1/15/2026', '12/31/2025']);
  assert.equal(us.type, 'date'); assert.equal(us.dateOrder, 'mdy');
  const eu = QD.inferColumn(['15/1/2026', '31/12/2025']);
  assert.equal(eu.type, 'date'); assert.equal(eu.dateOrder, 'dmy');
  const amb = QD.inferColumn(['1/2/2026', '3/4/2026']);
  assert.equal(amb.dateOrder, 'mdy'); assert.match(amb.note, /ambiguous/);
  assert.equal(QD.inferColumn(['1/2/2026', '3/4/2026'], { dateOrder: 'dmy' }).dateOrder, 'dmy');
  assert.equal(QD.inferColumn(['2/30/2026']).type, 'text');
  assert.equal(QD.inferColumn(['13/13/2026']).type, 'text');
  assert.equal(QD.inferColumn(['1/5/26 2:30 PM']).type, 'datetime');
});

test('convertValue normalizes to SQLite friendly values', () => {
  assert.deepEqual(QD.convertValue('1/5/2026', { type: 'date', dateOrder: 'mdy' }), { v: '2026-01-05', bad: false });
  assert.deepEqual(QD.convertValue('1/5/2026', { type: 'date', dateOrder: 'dmy' }), { v: '2026-05-01', bad: false });
  assert.deepEqual(QD.convertValue('1/5/26 2:30 PM', { type: 'datetime', dateOrder: 'mdy' }), { v: '2026-01-05 14:30:00', bad: false });
  assert.deepEqual(QD.convertValue('12:00 AM'.replace('12:00 AM', '1/5/26 12:05 AM'), { type: 'datetime', dateOrder: 'mdy' }), { v: '2026-01-05 00:05:00', bad: false });
  assert.deepEqual(QD.convertValue('(45.00)', { type: 'real', money: true }), { v: -45, bad: false });
  assert.deepEqual(QD.convertValue('$1,234.50', { type: 'real', money: true }), { v: 1234.5, bad: false });
  assert.deepEqual(QD.convertValue('Yes', { type: 'boolean' }), { v: 1, bad: false });
  assert.deepEqual(QD.convertValue('unknown', { type: 'integer' }), { v: null, bad: true });
  assert.deepEqual(QD.convertValue('N/A', { type: 'integer' }), { v: null, bad: false });
  assert.deepEqual(QD.convertValue(' keep me ', { type: 'text' }), { v: ' keep me ', bad: false });
});

test('create, load CSV, schema, export, reopen', () => {
  const p = QD.create('Demo');
  const res = p.loadCSV('Student ID,Full Name,GPA,Enrolled On,ZIP,Active\n1,Ann Lee,3.5,8/20/2026,67202,yes\n2,"Roe, Bo",,8/21/2026,02134,no\n3,Cy,2.75,NA,67001,yes\n',
    { fileName: 'Students.csv' });
  assert.equal(res.table, 'students');
  assert.deepEqual(res.columns.map(c => c.name + ':' + c.type),
    ['student_id:integer', 'full_name:text', 'gpa:real', 'enrolled_on:date', 'zip:text', 'active:boolean']);
  assert.equal(res.rowCount, 3);
  assert.deepEqual(p.userTables(), ['students']);
  const sc = p.schema()[0];
  assert.equal(sc.rowCount, 3);
  assert.equal(sc.columns[3].inferredType, 'date');
  assert.equal(sc.columns[0].originalHeader, 'Student ID');
  const q = p.query('SELECT full_name, enrolled_on, zip, active, typeof(gpa) FROM students ORDER BY student_id');
  assert.deepEqual(q.rows[1], ['Roe, Bo', '2026-08-21', '02134', 0, 'null']);
  assert.equal(q.rows[2][1], null);
  const bytes = p.export('194');
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
  assert.equal(p.isDirty(), false);
  const p2 = QD.open(bytes);
  assert.equal(p2.name, 'Demo');
  assert.equal(p2.getMeta('last_app'), '194');
  assert.equal(p2.getMeta('format_version'), '1');
  assert.deepEqual(p2.userTables(), ['students']);
  assert.equal(p2.scalar('SELECT count(*) FROM students'), 3);
  p.close(); p2.close();
});

test('second load of the same file name gets a new table name, replace overwrites', () => {
  const p = QD.create();
  p.loadCSV('a\n1\n', { fileName: 'data.csv' });
  assert.equal(p.loadCSV('a\n1\n2\n', { fileName: 'data.csv' }).table, 'data_2');
  assert.equal(p.loadCSV('a\n1\n2\n3\n', { fileName: 'data.csv', replace: true }).table, 'data');
  assert.equal(p.scalar('SELECT count(*) FROM data'), 3);
  assert.equal(p.scalar("SELECT count(*) FROM _qd_sources WHERE table_name = 'data'"), 1);
  p.close();
});

test('ragged rows, duplicate and blank headers, forced types', () => {
  const p = QD.create();
  const r = p.loadCSV('id,,id,amount\n1,a,x,5\n2,b\n3,c,z,7,EXTRA,MORE\n4,d,q,oops\n', { fileName: 'r.csv', types: { amount: 'integer' } });
  assert.deepEqual(r.columns.map(c => c.name), ['id', 'col_2', 'id_2', 'amount']);
  assert.equal(r.badRows, 1);
  assert.equal(r.badCells, 1);
  assert.equal(r.columns[3].bad, 1);
  assert.deepEqual(p.query('SELECT * FROM r ORDER BY id').rows, [[1, 'a', 'x', 5], [2, 'b', null, null], [3, 'c', 'z', 7], [4, 'd', 'q', null]]);
  p.close();
});

test('opening a plain SQLite file adopts it without touching user tables', () => {
  const raw = new (require('sql.js/dist/sql-wasm.js')).constructor;
  void raw;
  const p0 = QD.create('x');
  p0.execute('CREATE TABLE plain (a INTEGER PRIMARY KEY, b TEXT); INSERT INTO plain VALUES (1, \'one\'), (2, \'two\');');
  QD.RESERVED_TABLES.forEach(t => p0.db.run('DROP TABLE ' + t));
  const bytes = p0.db.export();
  const p = QD.open(bytes, 'Adopted');
  assert.deepEqual(p.userTables(), ['plain']);
  assert.equal(p.getMeta('format_version'), '1');
  assert.equal(p.schema()[0].columns[0].pk, 1);
  assert.equal(p.name, 'Adopted');
  p.close(); p0.close();
});

test('open rejects non SQLite bytes and newer formats', () => {
  assert.throws(() => QD.open(new Uint8Array([1, 2, 3])), /not a SQLite database/);
  assert.throws(() => QD.open(new TextEncoder().encode('id,name\n1,a\n this is a csv file')), /not a SQLite database/);
  const p = QD.create(); p.setMeta('format_version', '99');
  assert.throws(() => QD.open(p.export()), /newer version/);
  p.close();
});

test('maskSql and splitStatements ignore quotes and comments', () => {
  assert.equal(QD.maskSql("SELECT 'a;b' -- c;d\n"), "SELECT '   '       \n");
  assert.deepEqual(QD.splitStatements("SELECT 'a;b'; SELECT \"x;y\" /* ; */ ; -- tail;\n"), ["SELECT 'a;b'", 'SELECT "x;y" /* ; */']);
  assert.deepEqual(QD.splitStatements("SELECT 'it''s; fine'"), ["SELECT 'it''s; fine'"]);
  assert.deepEqual(QD.splitStatements('  ;; '), []);
  const trig = 'CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = 1; DELETE FROM b; END; SELECT 1';
  assert.equal(QD.splitStatements(trig).length, 2);
});

test('checkReadOnly accepts reads and rejects everything else', () => {
  const ok = ['SELECT 1', '  select * from t;', 'WITH x AS (SELECT 1) SELECT * FROM x', 'VALUES (1),(2)', '(SELECT 1)',
    "SELECT 'DROP TABLE t'", 'SELECT "update" FROM t', 'SELECT 1 -- delete everything', 'EXPLAIN QUERY PLAN SELECT 1',
    'SELECT created_at, updated, deleted_flag FROM t'];
  ok.forEach(s => assert.equal(QD.checkReadOnly(s).ok, true, s));
  const bad = ['', 'DROP TABLE t', 'SELECT 1; DROP TABLE t', 'WITH x AS (SELECT 1) DELETE FROM t', 'PRAGMA query_only = 0',
    'INSERT INTO t VALUES (1)', 'UPDATE t SET a = 1', 'ATTACH DATABASE \'x\' AS y', 'SELECT 1; SELECT 2',
    'EXPLAIN DELETE FROM t', '/* hi */ DELETE FROM t', 'CREATE TABLE x AS SELECT 1', 'VACUUM', 'REPLACE INTO t VALUES (1)',
    'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', 'BEGIN'];
  bad.forEach(s => assert.equal(QD.checkReadOnly(s).ok, false, s));
});

test('query: engine guard, row cap, history, plain errors', () => {
  const p = QD.create();
  p.loadCSV('n\n' + Array.from({ length: 50 }, (_, i) => i).join('\n') + '\n', { fileName: 'nums.csv' });
  const r = p.query('SELECT n FROM nums ORDER BY n', { maxRows: 10 });
  assert.equal(r.rowCount, 10); assert.equal(r.truncated, true); assert.deepEqual(r.columns, ['n']);
  assert.equal(p.query('SELECT n FROM nums WHERE n < ?', { params: [5] }).rowCount, 5);
  assert.throws(() => p.query('DELETE FROM nums'), e => e.kind === 'guard');
  assert.equal(p.scalar('SELECT count(*) FROM nums'), 50);
  // the engine switch is off again after both success and failure, so trusted writes still work
  assert.throws(() => p.query('SELECT nope FROM nums'), e => e.kind === 'sql' && /no column named nope/.test(e.message));
  p.execute('INSERT INTO nums VALUES (999)');
  assert.equal(p.scalar('SELECT count(*) FROM nums'), 51);
  assert.throws(() => p.query('SELECT * FROM numz'), /Did you mean nums\?/);
  assert.throws(() => p.query('SELECT m FROM nums'), /Did you mean n\?/);
  assert.throws(() => p.query('SELECT n FROM nums WHERE'), /ends too soon|could not read/);
  assert.throws(() => p.query('SELECT GETDATE()'), /SQL Server functions/);
  assert.throws(() => p.query('SELECT n FROM nums WHERE count(*) > 1'), /HAVING/);
  const h = p.history(20);
  assert.ok(h.length >= 8);
  assert.equal(h[h.length - 1].ok, 1);
  assert.ok(h.some(x => x.ok === 0 && /nope/.test(x.error)));
  const before = p.history(500).length;
  p.query('SELECT 1', { history: false });
  assert.equal(p.history(500).length, before);
  p.close();
});

test('a write smuggled past the text check is still stopped by the engine', () => {
  const p = QD.create();
  p.execute('CREATE TABLE t (a)');
  const realCheck = QD.checkReadOnly;
  QD.checkReadOnly = s => ({ ok: true, reason: '', statement: s });
  try {
    assert.throws(() => p.query('INSERT INTO t VALUES (1)'), /only SELECT statements can run here/);
    assert.throws(() => p.query('DROP TABLE t'), e => e.kind === 'sql');
  } finally { QD.checkReadOnly = realCheck; }
  assert.equal(p.scalar('SELECT count(*) FROM t'), 0);
  p.execute('INSERT INTO t VALUES (1)');
  assert.equal(p.scalar('SELECT count(*) FROM t'), 1);
  p.close();
});

test('history is capped', () => {
  const p = QD.create();
  for (let i = 0; i < QD.HISTORY_KEEP + 30; i++) p.query('SELECT ' + i);
  assert.equal(p.scalar('SELECT count(*) FROM _qd_history'), QD.HISTORY_KEEP);
  p.close();
});

test('execute protects reserved tables and blocks ATTACH', () => {
  const p = QD.create();
  assert.throws(() => p.execute('DROP TABLE _qd_meta'), /belong to Query Desk/);
  assert.throws(() => p.execute('DELETE FROM "_qd_queries"'), /belong to Query Desk/);
  assert.throws(() => p.execute("ATTACH DATABASE 'x' AS y"), /not available/);
  assert.throws(() => p.dropTable('_qd_meta'), /Reserved/);
  const r = p.execute("CREATE TABLE a (x); INSERT INTO a VALUES (1), (2); SELECT sum(x) AS s FROM a;");
  assert.deepEqual(r.rows, [[3]]);
  assert.doesNotThrow(() => p.execute("SELECT '_qd_ is just text here'"));
  p.close();
});

test('saved queries, keys and relations round trip', () => {
  const p = QD.create('RT');
  p.execute('CREATE TABLE parent (id INTEGER, name TEXT); CREATE TABLE child (id INTEGER, parent_id INTEGER);');
  const id = p.saveQuery({ name: 'All parents', sql: 'SELECT * FROM parent', origin: 'ask', question: 'show parents' });
  p.saveQuery({ id, name: 'Parents', sql: 'SELECT * FROM parent', pinned: true });
  assert.equal(p.queries().length, 1);
  assert.equal(p.getQuery(id).name, 'Parents');
  assert.equal(p.getQuery(id).origin, 'ask');
  p.setKey('parent', ['id'], 'proposed', 0.9, { unique: true });
  p.setKey('parent', ['name'], 'confirmed', 0.4);
  p.setKey('parent', ['id'], 'confirmed');
  const keys = p.keys();
  assert.equal(keys.length, 2);
  assert.deepEqual(p.keys('confirmed').map(k => k.columns), [['id']]);
  assert.equal(p.keys('confirmed')[0].score, 0.9);
  assert.deepEqual(p.keys('confirmed')[0].evidence, { unique: true });
  const rid = p.setRelation({ fromTable: 'child', fromColumns: ['parent_id'], toTable: 'parent', toColumns: ['id'], score: 0.8, cardinality: 'many-to-one' });
  assert.equal(p.setRelation({ fromTable: 'child', fromColumns: ['parent_id'], toTable: 'parent', toColumns: ['id'], status: 'confirmed' }), rid);
  assert.equal(p.relations().length, 1);
  assert.equal(p.relations('confirmed')[0].score, 0.8);
  assert.match(p.schemaText(), /child\(parent_id\) -> parent\(id\)/);
  const p2 = QD.open(p.export());
  assert.equal(p2.relations('confirmed').length, 1);
  assert.equal(p2.queries()[0].pinned, 1);
  p2.dropTable('parent');
  assert.equal(p2.relations().length, 0);
  assert.equal(p2.keys().length, 0);
  p2.deleteQuery(id);
  assert.equal(p2.queries().length, 0);
  p.close(); p2.close();
});

test('schemaText sends at most sampleRows rows and clips long cells', () => {
  const p = QD.create();
  const rows = ['id,secret']; for (let i = 0; i < 40; i++) rows.push(i + ',S' + i + 'x'.repeat(80));
  p.loadCSV(rows.join('\n'), { fileName: 'vault.csv' });
  const txt = p.schemaText({ sampleRows: 2 });
  assert.match(txt, /TABLE "vault" \(40 rows\)/);
  assert.match(txt, /"id" INTEGER/);
  assert.equal((txt.match(/\[\d+,"S/g) || []).length, 2);
  assert.ok(!/S5x/.test(txt));
  assert.ok(!/x{50}/.test(txt));
  assert.ok(!/sample rows/.test(p.schemaText({ sampleRows: 0 })));
  assert.equal(p.scalar('SELECT count(*) FROM _qd_history'), 0);
  p.close();
});

test('compareResults', () => {
  const R = (columns, rows) => ({ columns, rows });
  const want = R(['a', 'b'], [[1, 'x'], [2, 'y']]);
  assert.equal(QD.compareResults(R(['q', 'r'], [[2, 'y'], [1, 'x']]), want).match, true);
  assert.equal(QD.compareResults(R(['q', 'r'], [[2, 'y'], [1, 'x']]), want, { ordered: true }).match, false);
  assert.match(QD.compareResults(R(['q', 'r'], [[2, 'y'], [1, 'x']]), want, { ordered: true }).reason, /ORDER BY/);
  assert.match(QD.compareResults(R(['a'], [[1], [2]]), want).reason, /Expected 2 columns and got 1/);
  assert.match(QD.compareResults(R(['a', 'b'], [[1, 'x']]), want).reason, /Expected 2 rows and got 1/);
  assert.equal(QD.compareResults(R(['a', 'b'], [[1, 'x'], [2, 'z']]), want).match, false);
  assert.equal(QD.compareResults(R(['v'], [[3.333]]), R(['v'], [[3.33]])).match, true);
  assert.equal(QD.compareResults(R(['v'], [[3.4]]), R(['v'], [[3.33]])).match, false);
  assert.equal(QD.compareResults(R(['v'], [[2]]), R(['v'], [[2.0]])).match, true);
  assert.equal(QD.compareResults(R(['v'], [['2']]), R(['v'], [[2]])).match, true);
  assert.equal(QD.compareResults(R(['v'], [['02']]), R(['v'], [[2]])).match, false);
  assert.equal(QD.compareResults(R(['v'], [[null]]), R(['v'], [['']])).match, false);
  assert.equal(QD.compareResults(R(['v'], [[null]]), R(['v'], [[0]])).match, false);
  assert.equal(QD.compareResults(R(['b', 'a'], [['x', 1], ['y', 2]]), want).match, false);
  assert.equal(QD.compareResults(R(['b', 'a'], [['x', 1], ['y', 2]]), want, { anyColumnOrder: true }).match, true);
  assert.equal(QD.compareResults(R(['a', 'b'], [[1, 'x'], [1, 'x']]), R(['a', 'b'], [[1, 'x'], [2, 'y']])).match, false);
  assert.equal(QD.compareResults({ columns: ['a'], rows: [[1]], truncated: true }, R(['a'], [[1]])).match, false);
});

test('toCSV quotes and neutralizes formulas', () => {
  const csv = QD.toCSV({ columns: ['a', 'b'], rows: [['x, y', 'say "hi"'], ['=SUM(A1)', null], [-5, 'ok']] });
  assert.equal(csv, 'a,b\r\n"x, y","say ""hi"""\r\n\'=SUM(A1),\r\n-5,ok\r\n');
});

test('store: save, list, load, remove; autosave debounces', async () => {
  const p = QD.create('Saved One');
  p.loadCSV('a\n1\n', { fileName: 't.csv' });
  assert.equal(await QD.store.save(p.name, p.export('194'), '194'), true);
  const list = await QD.store.list();
  assert.deepEqual(list.map(x => x.name), ['Saved One']);
  assert.equal(list[0].app, '194');
  assert.ok(!('bytes' in list[0]));
  const rec = await QD.store.load('Saved One');
  const p2 = QD.open(rec.bytes);
  assert.deepEqual(p2.userTables(), ['t']);
  assert.equal(await QD.store.load('missing'), null);

  let saves = 0;
  const auto = QD.autosave(p2, { delay: 20, app: '195', onSave: () => { saves += 1; } });
  p2.execute('INSERT INTO t VALUES (2)');
  p2.execute('INSERT INTO t VALUES (3)');
  p2.saveQuery({ name: 'q', sql: 'SELECT 1' });
  await new Promise(r => setTimeout(r, 250));
  assert.equal(saves, 1);
  const again = QD.open((await QD.store.load('Saved One')).bytes);
  assert.equal(again.scalar('SELECT count(*) FROM t'), 3);
  assert.equal(again.getMeta('last_app'), '195');
  auto.stop();
  p2.execute('INSERT INTO t VALUES (4)');
  await new Promise(r => setTimeout(r, 120));
  assert.equal(saves, 1);
  await QD.store.remove('Saved One');
  assert.deepEqual(await QD.store.list(), []);
  p.close(); p2.close(); again.close();
});

test('store degrades quietly without IndexedDB', async () => {
  const keep = globalThis.indexedDB;
  globalThis.indexedDB = undefined; QD.store._reset();
  try {
    assert.equal(await QD.store.save('x', new Uint8Array([1])), false);
    assert.equal(await QD.store.load('x'), null);
    assert.deepEqual(await QD.store.list(), []);
  } finally { globalThis.indexedDB = keep; QD.store._reset(); }
});

function fakeDeps(script) {
  const calls = [];
  return {
    calls,
    keys: { get: async () => 'sk-test' },
    models: { id: tier => 'model-for-' + tier },
    retryDelay: 0,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, headers: init.headers, body });
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      return { ok: step.status === 200, status: step.status, text: async () => JSON.stringify(step.body) };
    }
  };
}
const okBody = t => ({ status: 200, body: { content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: t }], stop_reason: 'end_turn' } });

test('claude: headers, tier lookup, text blocks only', async () => {
  QD.claude._resetThinking();
  const d = fakeDeps([okBody('hello')]);
  const r = await QD.claude(Object.assign({ prompt: 'hi', system: 'sys', tier: 'haiku' }, d));
  assert.equal(r.text, 'hello');
  const c = d.calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(c.headers['x-api-key'], 'sk-test');
  assert.equal(c.body.model, 'model-for-haiku');
  assert.deepEqual(c.body.thinking, { type: 'between_tools' });
  assert.equal(c.body.system, 'sys');
});

test('claude: thinking fallback walks the forms and remembers per model', async () => {
  QD.claude._resetThinking();
  const think400 = { status: 400, body: { error: { message: 'thinking.type: send {type: between_tools} instead' } } };
  const d = fakeDeps([think400, think400, okBody('third time')]);
  const r = await QD.claude(Object.assign({ prompt: 'x' }, d));
  assert.equal(r.text, 'third time');
  assert.deepEqual(d.calls.map(c => c.body.thinking), [{ type: 'between_tools' }, { type: 'disabled' }, undefined]);
  const d2 = fakeDeps([okBody('again')]);
  await QD.claude(Object.assign({ prompt: 'x' }, d2));
  assert.equal(d2.calls.length, 1);
  assert.equal(d2.calls[0].body.thinking, undefined);
  const d3 = fakeDeps([okBody('other model')]);
  await QD.claude(Object.assign({ prompt: 'x', tier: 'opus' }, d3));
  assert.deepEqual(d3.calls[0].body.thinking, { type: 'between_tools' });
});

test('claude: retry once on 429 and 5xx, plain errors, declined key', async () => {
  QD.claude._resetThinking();
  const d = fakeDeps([{ status: 529, body: { error: { message: 'overloaded' } } }, okBody('recovered')]);
  assert.equal((await QD.claude(Object.assign({ prompt: 'x' }, d))).text, 'recovered');
  const d2 = fakeDeps([{ status: 429, body: { error: { message: 'slow down' } } }]);
  await assert.rejects(QD.claude(Object.assign({ prompt: 'x' }, d2)), /rate limited/);
  assert.equal(d2.calls.length, 2);
  const d3 = fakeDeps([{ status: 401, body: { error: { message: 'bad key' } } }]);
  await assert.rejects(QD.claude(Object.assign({ prompt: 'x' }, d3)), /key was rejected/);
  const d4 = fakeDeps([{ status: 400, body: { error: { message: 'max_tokens too large' } } }]);
  await assert.rejects(QD.claude(Object.assign({ prompt: 'x' }, d4)), /max_tokens too large/);
  assert.equal(d4.calls.length, 1);
  const d5 = fakeDeps([{ status: 200, body: { content: [{ type: 'thinking', thinking: '...' }], stop_reason: 'max_tokens' } }]);
  await assert.rejects(QD.claude(Object.assign({ prompt: 'x' }, d5)), /empty reply/);
  const d6 = fakeDeps([okBody('never')]); d6.keys = { get: async () => null };
  assert.equal(await QD.claude(Object.assign({ prompt: 'x' }, d6)), null);
  assert.equal(d6.calls.length, 0);
  await assert.rejects(QD.claude({ prompt: 'x', keys: null, models: null }), /did not load/);
});

test('extractJSON', () => {
  assert.deepEqual(QD.extractJSON('Here you go:\n```json\n{"sql":"SELECT 1"}\n```\nDone.'), { sql: 'SELECT 1' });
  assert.deepEqual(QD.extractJSON('{"a":{"b":2}} trailing'), { a: { b: 2 } });
  assert.equal(QD.extractJSON('no json here'), null);
  assert.equal(QD.extractJSON('{broken'), null);
});

test('the core carries no model ID and is ASCII clean', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../core/qd-core.js'), 'utf8');
  assert.ok(!/claude-(sonnet|opus|haiku|fable)/i.test(src));
  for (let i = 0; i < src.length; i++) assert.ok(src.charCodeAt(i) < 128, 'non ASCII at ' + i);
  assert.ok(!/window\.confirm|\.roundRect|\.ellipse\(/.test(src));
  assert.ok(src.startsWith('/* QD:CORE BEGIN') && src.trim().endsWith('/* QD:CORE END */'));
});
