'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const QD = require('../core/qd-core.js');
const K = require('../core/qd-keys.js');

test.before(async () => { await QD.boot(initSqlJs); });

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(v => v == null ? '' : (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(','))).join('\n') + '\n';
const rel = r => r.fromTable + '.' + r.fromColumns.join('+') + '>' + r.toTable + '.' + r.toColumns.join('+');
const proposals = a => a.relations.filter(r => r.score >= K.THRESHOLDS.likely).map(rel).sort();
const bestKey = (a, t) => { const k = a.keys.find(x => x.table === t && x.best); return k ? k.columns.join('+') : null; };
function shuffle(r, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

/* ---------------------------------------------------------------- A: college, row number keys everywhere */
function buildCollege() {
  const r = rng(11), p = QD.create('college');
  const seq = n => Array.from({ length: n }, (_, i) => i + 1);
  p.loadCSV(csv(['id', 'name', 'city'], seq(4).map(i => [i, 'Campus ' + i, 'City ' + i])), { fileName: 'campuses.csv' });
  p.loadCSV(csv(['id', 'name', 'campus_id'], seq(8).map(i => [i, 'Dept ' + i, int(r, 1, 4)])), { fileName: 'departments.csv' });
  p.loadCSV(csv(['id', 'full_name', 'department_id', 'hire_date'], seq(30).map(i => [i, 'Instructor ' + i, int(r, 1, 8), '20' + int(r, 10, 25) + '-08-' + int(r, 10, 28)])), { fileName: 'instructors.csv' });
  p.loadCSV(csv(['id', 'full_name', 'advisor_id', 'home_campus_id', 'gpa', 'credits', 'birth_year'],
    seq(300).map(i => [i, 'Student ' + i, i <= 30 ? i : int(r, 1, 30), int(r, 1, 4), (int(r, 150, 400) / 100).toFixed(2), int(r, 0, 120), int(r, 1998, 2007)])), { fileName: 'students.csv' });
  p.loadCSV(csv(['id', 'code', 'title', 'department_id', 'credit_hours'], seq(60).map(i => [i, 'CRS' + (100 + i), 'Course ' + i, int(r, 1, 8), int(r, 1, 4)])), { fileName: 'courses.csv' });
  p.loadCSV(csv(['id', 'course_id', 'instructor_id', 'campus_id', 'term', 'capacity', 'room_number'],
    seq(150).map(i => [i, int(r, 1, 60), int(r, 1, 30), int(r, 1, 4), ['2026FA', '2027SP'][i % 2], int(r, 10, 40), int(r, 100, 140)])), { fileName: 'sections.csv' });
  const seen = new Set(), rows = [];
  while (rows.length < 1500) {
    const s = int(r, 1, 300), c = int(r, 1, 150), k = s + ':' + c;
    if (seen.has(k)) continue; seen.add(k);
    rows.push([s, c, (int(r, 0, 40) / 10).toFixed(1), ['enrolled', 'dropped', 'completed'][int(r, 0, 2)], 1 + (rows.length % 30)]);
  }
  p.loadCSV(csv(['student_id', 'section_id', 'grade_points', 'status', 'seat_number'], rows), { fileName: 'enrollments.csv' });
  return p;
}

test('A: with row number keys in every table, names decide and traps stay out', () => {
  const p = buildCollege(), a = K.analyze(p);
  const want = [
    'courses.department_id>departments.id', 'departments.campus_id>campuses.id', 'enrollments.section_id>sections.id',
    'enrollments.student_id>students.id', 'instructors.department_id>departments.id', 'sections.campus_id>campuses.id',
    'sections.course_id>courses.id', 'sections.instructor_id>instructors.id', 'students.home_campus_id>campuses.id'
  ];
  const got = proposals(a);
  const roleGuess = 'students.advisor_id>instructors.id';
  assert.deepEqual(got.filter(x => x !== roleGuess), want);
  // the role named column is found, with instructors as its parent, at least as a maybe
  const adv = a.relations.find(r => r.fromTable === 'students' && r.fromColumns[0] === 'advisor_id');
  assert.ok(adv && adv.toTable === 'instructors', 'advisor_id should point at instructors');
  // every true relation that is named is strong
  a.relations.filter(r => want.includes(rel(r))).forEach(r => assert.equal(r.label, 'strong', rel(r)));
  // measure columns never appear, even as maybes pointing somewhere as a proposal
  ['credits', 'birth_year', 'capacity', 'room_number', 'seat_number', 'credit_hours', 'gpa', 'grade_points'].forEach(c => {
    assert.ok(!a.relations.some(r => r.fromColumns[0] === c && r.score >= K.THRESHOLDS.likely), c + ' must not be proposed');
  });
  ['campuses', 'departments', 'instructors', 'students', 'courses', 'sections'].forEach(t => assert.equal(bestKey(a, t), 'id', t));
  assert.equal(bestKey(a, 'enrollments'), 'student_id+section_id');
  assert.ok(a.keys.find(k => k.table === 'enrollments' && k.best).score >= K.THRESHOLDS.likely);
  assert.ok(a.stats.ms < 3000, 'analysis took ' + a.stats.ms);
  p.close();
});

/* ---------------------------------------------------------------- B: messy retail */
function buildRetail() {
  const r = rng(22), p = QD.create('retail');
  let num = 10000; const custNums = [];
  const cust = Array.from({ length: 120 }, (_, i) => { num += int(r, 1, 9); custNums.push(num); return [num, 'Customer ' + i, 'c' + i + '@example.com', String(int(r, 501, 99950)).padStart(5, '0')]; });
  p.loadCSV(csv(['Customer Number', 'Name', 'Email', 'ZIP'], cust), { fileName: 'customers.csv' });
  const cats = ['ELEC', 'HOME', 'TOYS', 'BOOK', 'FOOD', 'GARD'];
  p.loadCSV(csv(['code', 'label'], cats.map(c => [c, c + ' things'])), { fileName: 'categories.csv' });
  const skus = Array.from({ length: 80 }, (_, i) => 'SKU-' + String(i + 1).padStart(4, '0'));
  p.loadCSV(csv(['SKU', 'Description', 'Unit Price', 'Category Code'], skus.map((s, i) => [s, 'Product ' + i, '$' + (int(r, 199, 9999) / 100).toFixed(2), cats[int(r, 0, 5)]])), { fileName: 'products.csv' });
  const orders = Array.from({ length: 400 }, (_, i) => [500001 + i, custNums[int(r, 0, 119)] + (i % 3 === 0 ? ' ' : ''), (1 + (i % 12)) + '/' + (1 + (i % 27)) + '/2026', String(int(r, 501, 99950)).padStart(5, '0')]);
  // force the customer number column to be read as text, as a spreadsheet export with stray spaces would be
  const o = p.loadCSV(csv(['Order No', 'Cust No', 'Order Date', 'Ship ZIP'], orders), { fileName: 'orders.csv', types: { cust_no: 'text' } });
  assert.equal(o.columns[1].type, 'text');
  const lines = [];
  for (let i = 0; i < 400; i++) {
    const n = int(r, 1, 5);
    for (let l = 1; l <= n; l++) lines.push([500001 + i, l, r() < 0.02 ? 'SKU-9' + int(r, 100, 999) : skus[int(r, 0, 79)], int(r, 1, 10), int(r, 1, 5)]);
  }
  p.loadCSV(csv(['Order No', 'Line No', 'SKU', 'Qty', 'Rating'], lines), { fileName: 'order_lines.csv' });
  return p;
}

test('B: abbreviations, type mismatch, stray spaces and orphans', () => {
  const p = buildRetail(), a = K.analyze(p);
  assert.deepEqual(proposals(a), [
    'order_lines.order_no>orders.order_no', 'order_lines.sku>products.sku',
    'orders.cust_no>customers.customer_number', 'products.category_code>categories.code'
  ]);
  const c = a.relations.find(r => r.fromColumns[0] === 'cust_no');
  assert.notEqual(c.mode, 'exact');
  assert.ok(c.reasons.some(x => /short form|number/.test(x)));
  const s = a.relations.find(r => r.fromColumns[0] === 'sku');
  assert.ok(s.orphanRows > 0 && s.containment < 1 && s.containment >= 0.9);
  assert.ok(s.reasons.some(x => /missing from products/.test(x)));
  assert.equal(bestKey(a, 'customers'), 'customer_number');
  assert.equal(bestKey(a, 'products'), 'sku');
  assert.equal(bestKey(a, 'orders'), 'order_no');
  assert.equal(bestKey(a, 'categories'), 'code');
  assert.equal(bestKey(a, 'order_lines'), 'order_no+line_no');
  // the generated join honors the cast
  const path = K.joinPath(a.relations.filter(r => r.score >= 0.5), 'order_lines', 'customers');
  assert.equal(path.length, 2);
  const sql = K.joinSQL('order_lines', path);
  assert.match(sql, /CAST\(/);
  const n = p.query('SELECT count(*) FROM (' + sql + ')').rows[0][0];
  assert.equal(n, p.scalar('SELECT count(*) FROM order_lines'));
  p.close();
});

/* ---------------------------------------------------------------- C: traps */
function buildTraps() {
  const r = rng(33), p = QD.create('traps');
  const codes = new Set(); while (codes.size < 40) codes.add(String.fromCharCode(65 + int(r, 0, 25), 65 + int(r, 0, 25), 65 + int(r, 0, 25)));
  const ap = [...codes];
  p.loadCSV(csv(['code', 'city', 'elevation'], ap.map((c, i) => [c, 'City ' + i, int(r, 0, 5000)])), { fileName: 'airports.csv' });
  p.loadCSV(csv(['flight_id', 'origin', 'destination', 'distance', 'delay_minutes', 'day_of_week', 'cancelled'],
    Array.from({ length: 500 }, (_, i) => [i + 1, ap[int(r, 0, 39)], ap[int(r, 0, 39)], int(r, 100, 3000), int(r, -10, 180), int(r, 1, 7), r() < 0.05 ? 1 : 0])), { fileName: 'flights.csv' });
  const ranks = shuffle(r, Array.from({ length: 60 }, (_, i) => i + 1));
  const badges = new Set(); while (badges.size < 60) badges.add(int(r, 100000, 999999));
  const bl = [...badges];
  p.loadCSV(csv(['id', 'name', 'manager_id', 'badge', 'salary', 'rank', 'hired_at'],
    Array.from({ length: 60 }, (_, i) => [i + 1, 'Emp ' + i, i < 3 ? '' : int(r, 1, 12), bl[i], (int(r, 3000000, 9000000) / 100 + i / 1000).toFixed(3), ranks[i],
      '2020-01-' + String(1 + (i % 28)).padStart(2, '0') + ' 0' + (i % 10) + ':' + String(i).padStart(2, '0') + ':00'])), { fileName: 'employees.csv' });
  p.loadCSV(csv(['id', 'name'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => [i + 1, d])), { fileName: 'weekdays.csv' });
  p.loadCSV(csv(['id', 'label'], [[1, 'Poor'], [2, 'Fair'], [3, 'Good'], [4, 'Great'], [5, 'Best']]), { fileName: 'ratings.csv' });
  return p;
}

test('C: natural keys carry on values, self reference needs a role name, unique noise is not a key', () => {
  const p = buildTraps(), a = K.analyze(p);
  // day_of_week to weekdays is a fair proposal: the name half matches and the lookup table exists. It must not be strong.
  assert.deepEqual(proposals(a), ['employees.manager_id>employees.id', 'flights.day_of_week>weekdays.id', 'flights.destination>airports.code', 'flights.origin>airports.code']);
  const m = a.relations.find(r => r.fromColumns[0] === 'manager_id');
  assert.equal(m.optional, true);
  assert.equal(bestKey(a, 'employees'), 'id');
  assert.equal(bestKey(a, 'flights'), 'flight_id');
  assert.equal(bestKey(a, 'airports'), 'code');
  const empKeys = a.keys.filter(k => k.table === 'employees').map(k => k.columns[0]);
  assert.ok(!empKeys.includes('salary'), 'a unique decimal is not a key');
  assert.ok(!empKeys.includes('hired_at'), 'a unique timestamp is not a key');
  // nothing ties a row number key to another row number key
  assert.ok(!a.relations.some(r => r.fromColumns[0] === 'id' || r.fromColumns[0] === 'flight_id'));
  assert.ok(!a.relations.some(r => r.fromColumns[0] === 'rank' && r.score >= 0.5));
  assert.ok(!a.relations.some(r => r.fromColumns[0] === 'cancelled'));
  assert.ok(!a.relations.some(r => r.fromColumns[0] === 'day_of_week' && r.label === 'strong'));
  // two paths to the same parent both survive, and a self join writes distinct aliases
  const sql = K.joinSQL('employees', K.joinPath([m], 'employees', 'employees'));
  assert.equal(sql, 'SELECT *\nFROM "employees" AS e');
  const selfSql = K.joinSQL('employees', [{ relation: m, forward: true }]);
  assert.match(selfSql, /AS e\nJOIN "employees" AS e2 ON e\."manager_id" = e2\."id"/);
  assert.equal(p.query('SELECT count(*) FROM (' + selfSql.replace('SELECT *', 'SELECT e.id') + ')').rows[0][0], 57);
  p.close();
});

/* ---------------------------------------------------------------- D: unrelated tables */
test('D: unrelated tables produce no proposals at all', () => {
  const r = rng(44), p = QD.create('unrelated');
  p.loadCSV(csv(['id', 'reading', 'batch'], Array.from({ length: 50 }, (_, i) => [i + 1, (r() * 100).toFixed(3), int(r, 1, 50)])), { fileName: 'sensors.csv' });
  p.loadCSV(csv(['id', 'amount', 'items'], Array.from({ length: 80 }, (_, i) => [i + 1, (r() * 500).toFixed(2), int(r, 1, 12)])), { fileName: 'invoices.csv' });
  p.loadCSV(csv(['id', 'body', 'word_count'], Array.from({ length: 50 }, (_, i) => [i + 1, 'note text '.repeat(8) + i, int(r, 5, 50)])), { fileName: 'notes.csv' });
  const a = K.analyze(p);
  assert.deepEqual(proposals(a), []);
  assert.ok(!a.relations.some(x => x.label === 'strong' || x.label === 'likely'));
  ['sensors', 'invoices', 'notes'].forEach(t => assert.equal(bestKey(a, t), 'id'));
  p.close();
});

/* ---------------------------------------------------------------- E: declared keys in an adopted file */
test('E: declared primary and foreign keys in an adopted file are taken as given', () => {
  const p = QD.create('declared');
  p.execute(`CREATE TABLE artist (artist_pk INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE album (k INTEGER PRIMARY KEY, title TEXT, made_by INTEGER REFERENCES artist(artist_pk));
    CREATE TABLE credit (album INTEGER, artist INTEGER, role TEXT, PRIMARY KEY (album, artist), FOREIGN KEY (album) REFERENCES album(k));
    INSERT INTO artist VALUES (1,'A'),(2,'B'),(3,'C');
    INSERT INTO album VALUES (1,'X',2),(2,'Y',2),(3,'Z',3);
    INSERT INTO credit VALUES (1,1,'p'),(1,2,'w'),(2,2,'w');`);
  const a = K.analyze(p);
  const made = a.relations.find(r => r.fromColumns[0] === 'made_by');
  assert.equal(rel(made), 'album.made_by>artist.artist_pk'); assert.equal(made.score, 1);
  assert.ok(a.relations.some(r => rel(r) === 'credit.album>album.k' && r.score === 1));
  assert.equal(bestKey(a, 'credit'), 'album+artist');
  assert.equal(bestKey(a, 'album'), 'k');
  assert.equal(a.keys.find(k => k.table === 'album' && k.best).score, 1);
  p.close();
});

/* ---------------------------------------------------------------- F: edge shapes */
test('F: empty tables, single row tables and all null columns do not break analysis', () => {
  const p = QD.create('edges');
  p.execute(`CREATE TABLE empty_t (id INTEGER, x TEXT);
    CREATE TABLE one_row (id INTEGER, label TEXT); INSERT INTO one_row VALUES (1, 'only');
    CREATE TABLE holes (id INTEGER, one_row_id INTEGER, blank TEXT);
    INSERT INTO holes VALUES (1, 1, NULL), (2, 1, NULL), (3, NULL, NULL);`);
  const a = K.analyze(p);
  assert.equal(bestKey(a, 'empty_t'), null);
  assert.equal(bestKey(a, 'one_row'), 'id');
  assert.ok(a.relations.some(r => rel(r) === 'holes.one_row_id>one_row.id' && r.score >= 0.5 && r.optional));
  p.close();
});

test('name evidence and abbreviations', () => {
  const ne = (ct, cc, pt, pc) => K._nameEvidence(ct, cc, pt, pc).score;
  assert.equal(ne('enrollments', 'student_id', 'students', 'id'), 1);
  assert.equal(ne('sections', 'campus_id', 'campuses', 'id'), 1);
  assert.equal(ne('items', 'category_id', 'categories', 'id'), 1);
  assert.equal(ne('t', 'CourseID', 'Courses', 'ID'), 1);
  assert.equal(ne('students', 'home_campus_id', 'campuses', 'id'), 0.9);
  assert.equal(ne('orders', 'cust_no', 'customers', 'customer_number'), 0.8);
  assert.equal(ne('staff', 'dept_code', 'departments', 'code'), 0.8);
  assert.equal(ne('emp', 'emp_id', 'employees', 'id'), 0.8);
  assert.equal(ne('fact_sales', 'product_key', 'dim_product', 'product_key'), 1);
  assert.equal(ne('employees', 'manager_id', 'employees', 'id'), 0.75);
  assert.equal(ne('employees', 'reports_to', 'employees', 'id'), 0.75);
  assert.equal(ne('students', 'advisor_id', 'instructors', 'id'), 0);
  assert.equal(ne('a', 'id', 'b', 'id'), 0);
  assert.equal(ne('a', 'quantity', 'b', 'id'), 0);
  assert.equal(ne('flights', 'origin', 'airports', 'code'), 0);
  assert.equal(K._abbrev('cat', 'certificate'), false);
  assert.equal(K._abbrev('dept', 'department'), true);
  assert.equal(K._abbrev('qty', 'quality'), true); // known limit: resolved by values, never by name alone on natural keys
});

test('apply writes proposals and never overrides a human decision', () => {
  const p = buildCollege(), a = K.analyze(p);
  const n = K.apply(p, a);
  assert.ok(n.relations >= 9 && n.keys >= 7);
  p.setRelation({ fromTable: 'sections', fromColumns: ['course_id'], toTable: 'courses', toColumns: ['id'], status: 'confirmed' });
  p.setRelation({ fromTable: 'sections', fromColumns: ['campus_id'], toTable: 'campuses', toColumns: ['id'], status: 'rejected' });
  p.setKey('courses', ['code'], 'confirmed');
  K.apply(p, K.analyze(p));
  assert.equal(p.relations('confirmed').length, 1);
  assert.equal(p.relations('rejected').length, 1);
  assert.equal(p.relations().filter(r => r.fromTable === 'sections' && r.fromColumns[0] === 'campus_id').length, 1);
  assert.deepEqual(p.keys('confirmed').map(k => k.columns[0]), ['code']);
  assert.equal(p.relations().length, n.relations);
  const ev = p.relations('proposed')[0].evidence;
  assert.ok(Array.isArray(ev.reasons) && ev.reasons.length > 0 && ev.label);
  // survives a round trip through the file
  const p2 = QD.open(p.export());
  assert.equal(p2.relations().length, n.relations);
  p.close(); p2.close();
});

test('joinPath finds the shortest chain in either direction and reports disconnection', () => {
  const p = buildCollege(), a = K.analyze(p);
  const rels = a.relations.filter(r => r.score >= 0.75);
  const path = K.joinPath(rels, 'enrollments', 'campuses');
  assert.equal(path.length, 2);
  const sql = K.joinSQL('enrollments', path);
  assert.equal(p.query('SELECT count(*) FROM (SELECT e.student_id ' + sql.slice(sql.indexOf('\nFROM')) + ')').rows[0][0], 1500);
  const back = K.joinPath(rels, 'campuses', 'enrollments');
  assert.equal(back.length, 2); assert.equal(back[0].forward, false);
  assert.match(K.joinSQL('campuses', back, { left: true }), /LEFT JOIN/);
  assert.equal(K.joinPath(rels, 'campuses', 'nowhere'), null);
  assert.equal(K.joinSQL('campuses', null), null);
  assert.deepEqual(K.joinPath(rels, 'campuses', 'campuses'), []);
  p.close();
});

test('the engine is ASCII clean', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../core/qd-keys.js'), 'utf8');
  for (let i = 0; i < src.length; i++) assert.ok(src.charCodeAt(i) < 128);
});
