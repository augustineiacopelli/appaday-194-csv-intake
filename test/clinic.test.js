'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const QD = require('../core/qd-core.js');
const K = require('../core/qd-keys.js');
const C = require('../core/qd-clinic.js');

let P;
test.before(async () => { await QD.boot(initSqlJs); P = C.createProject(); });

function fingerprint(p) {
  const h = crypto.createHash('sha256');
  C.TABLES.forEach(t => h.update(JSON.stringify(p.rows('SELECT * FROM ' + t + ' ORDER BY 1'))));
  return h.digest('hex');
}
const run = (sql) => P.query(sql, { history: false, maxRows: 20000 });
const one = (sql) => P.scalar(sql);

test('the database is identical every time it is generated', () => {
  const a = C.createProject(), b = C.createProject();
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(fingerprint(a), fingerprint(P));
  // pinned: any change to the generator must be deliberate, because saved learner progress depends on the data
  assert.equal(fingerprint(P), require('./clinic.fingerprint.json').sha256);
  a.close(); b.close();
});

test('table sizes and referential integrity', () => {
  const n = t => one('SELECT count(*) FROM ' + t);
  assert.equal(n('campuses'), 4); assert.equal(n('departments'), 8); assert.equal(n('instructors'), 36);
  assert.equal(n('courses'), 48); assert.equal(n('terms'), 6); assert.equal(n('rooms'), 24);
  assert.equal(n('sections'), 332); assert.equal(n('students'), 400); assert.equal(n('work_orders'), 240);
  assert.ok(n('enrollments') > 5000 && n('enrollments') < 9000, 'enrollments ' + n('enrollments'));
  const orphan = (child, col, parent, pcol) => one(`SELECT count(*) FROM ${child} WHERE ${col} IS NOT NULL AND ${col} NOT IN (SELECT ${pcol} FROM ${parent})`);
  [['departments', 'dept_id', 'instructors'], ['departments', 'dept_id', 'courses'], ['courses', 'course_id', 'sections'], ['terms', 'term_id', 'sections'],
    ['instructors', 'instructor_id', 'sections'], ['rooms', 'room_id', 'sections'], ['students', 'student_id', 'enrollments'], ['sections', 'section_id', 'enrollments'],
    ['campuses', 'campus_id', 'rooms'], ['campuses', 'campus_id', 'work_orders'], ['rooms', 'room_id', 'work_orders']
  ].forEach(([parent, col, child]) => assert.equal(orphan(child, col, parent, col), 0, child + '.' + col));
  assert.equal(orphan('students', 'home_campus_id', 'campuses', 'campus_id'), 0);
  assert.equal(orphan('students', 'major_dept_id', 'departments', 'dept_id'), 0);
  assert.equal(orphan('instructors', 'mentor_id', 'instructors', 'instructor_id'), 0);
  assert.equal(one('SELECT count(*) FROM (SELECT student_id, section_id FROM enrollments GROUP BY 1, 2 HAVING count(*) > 1)'), 0);
  assert.equal(one('SELECT count(*) FROM work_orders w JOIN rooms r ON r.room_id = w.room_id WHERE r.campus_id <> w.campus_id'), 0);
  assert.equal(P.db.export().length < 1500000, true);
});

test('the data has every feature the exercises rely on', () => {
  // boundaries
  assert.ok(one('SELECT count(*) FROM rooms WHERE campus_id = 2 AND capacity = 30') >= 1);
  assert.ok(one('SELECT count(*) FROM rooms WHERE capacity = 20') >= 1 && one('SELECT count(*) FROM rooms WHERE capacity = 40') >= 1);
  assert.ok(one("SELECT count(*) FROM courses WHERE title LIKE '%Intro%' AND title NOT LIKE 'Intro%'") >= 1);
  // no ties where a tie would make an answer arbitrary
  assert.equal(one('SELECT count(DISTINCT salary) FROM instructors'), 36);
  // nulls and gaps
  assert.ok(one('SELECT count(*) FROM sections WHERE instructor_id IS NULL') >= 2);
  assert.ok(one('SELECT count(*) FROM sections WHERE room_id IS NULL AND term_id = 6') >= 3);
  assert.ok(one('SELECT count(*) FROM students WHERE major_dept_id IS NULL') >= 10);
  assert.equal(one('SELECT count(*) FROM courses WHERE course_id NOT IN (SELECT course_id FROM sections)'), 4);
  assert.equal(one('SELECT count(*) FROM instructors WHERE instructor_id NOT IN (SELECT instructor_id FROM sections WHERE instructor_id IS NOT NULL)'), 4);
  assert.equal(one('SELECT count(*) FROM students WHERE student_id NOT IN (SELECT student_id FROM enrollments)'), 10);
  assert.ok(one('SELECT count(*) FROM instructors WHERE mentor_id IS NULL') >= 8 && one('SELECT count(*) FROM instructors WHERE mentor_id IS NOT NULL') >= 12);
  // work orders: campus 4 has none open, some closed ones lack a cost, open ones never have a cost
  assert.equal(one('SELECT count(*) FROM work_orders WHERE campus_id = 4 AND closed_on IS NULL'), 0);
  assert.ok(one('SELECT count(*) FROM work_orders WHERE campus_id = 4') >= 5);
  assert.ok(one('SELECT count(*) FROM work_orders WHERE closed_on IS NULL') >= 15);
  assert.ok(one('SELECT count(*) FROM work_orders WHERE closed_on IS NOT NULL AND cost IS NULL') >= 5);
  assert.equal(one('SELECT count(*) FROM work_orders WHERE closed_on IS NULL AND cost IS NOT NULL'), 0);
  assert.equal(one('SELECT count(*) FROM work_orders WHERE closed_on < opened_on'), 0);
  // statuses line up with grades and terms
  assert.equal(one("SELECT count(*) FROM enrollments WHERE (status = 'Completed') <> (grade IS NOT NULL)"), 0);
  assert.equal(one("SELECT count(*) FROM enrollments e JOIN sections s USING (section_id) WHERE (e.status = 'Enrolled') AND s.term_id <> 6"), 0);
  assert.equal(one("SELECT count(*) FROM enrollments e JOIN sections s USING (section_id) WHERE e.status = 'Completed' AND s.term_id = 6"), 0);
  assert.equal(one("SELECT count(*) FROM enrollments WHERE grade_points <> CASE grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 WHEN 'D' THEN 1 ELSE 0 END"), 0);
  // an instructor with two online sections in term 6, so the DISTINCT exercise bites
  assert.ok(one("SELECT max(n) FROM (SELECT count(*) n FROM sections WHERE term_id = 6 AND modality = 'Online' AND instructor_id IS NOT NULL GROUP BY instructor_id)") >= 2);
  // student 17 has both graded and ungraded enrollments
  assert.ok(one('SELECT count(*) FROM enrollments WHERE student_id = 17 AND grade IS NULL') >= 1);
  assert.ok(one('SELECT count(*) FROM enrollments WHERE student_id = 17 AND grade IS NOT NULL') >= 2);
});

test('the course is well formed', () => {
  assert.equal(C.EXERCISES.length, 40);
  const ids = C.EXERCISES.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  C.UNITS.forEach(u => assert.ok(C.EXERCISES.filter(e => e.unit === u.id).length >= 2, 'unit ' + u.id));
  C.EXERCISES.forEach(e => {
    ['id', 'title', 'prompt', 'solution', 'alt', 'wrong', 'hint', 'concept'].forEach(f => assert.ok(typeof e[f] === 'string' && e[f].length > 5 || f === 'id', e.id + ' ' + f));
    assert.equal(typeof e.ordered, 'boolean', e.id);
    assert.ok(C.UNITS.some(u => u.id === e.unit), e.id);
    assert.equal(e.id.split('.')[0], String(e.unit), e.id);
    assert.ok(!/[–—]/.test(e.prompt + e.hint + e.concept + (e.tsql || '')), e.id + ' has a dash');
    ['solution', 'alt', 'wrong'].forEach(f => assert.equal(QD.checkReadOnly(e[f]).ok, true, e.id + ' ' + f + ' must pass the read only guard'));
    // an ordered exercise must say so in words, and its reference must sort
    if (e.ordered) assert.match(e.solution, /ORDER BY/i, e.id);
  });
});

for (const e of C.EXERCISES) {
  test('exercise ' + e.id + ' ' + e.title, () => {
    const want = run(e.solution);
    assert.ok(want.rows.length >= 1, 'reference returns no rows');
    assert.equal(want.truncated, false);
    // the reference passes against itself, the alternate route is accepted, the common mistake is rejected
    assert.equal(QD.compareResults(run(e.solution), want, { ordered: e.ordered }).match, true);
    const alt = QD.compareResults(run(e.alt), want, { ordered: e.ordered });
    assert.equal(alt.match, true, 'alternate rejected: ' + alt.reason);
    const wrong = QD.compareResults(run(e.wrong), want, { ordered: e.ordered });
    assert.equal(wrong.match, false, 'the common mistake was accepted');
    assert.ok(wrong.reason.length > 10);
  });
}

test('answers that depend on a sort have no ties at the cut', () => {
  // 2.1 fifth and sixth salaries differ (all salaries are distinct, checked above)
  // 5.4 category totals are all different
  assert.equal(one('SELECT count(*) - count(DISTINCT t) FROM (SELECT round(sum(cost), 2) t FROM work_orders WHERE cost IS NOT NULL AND closed_on IS NOT NULL GROUP BY category)'), 0);
  // 8.4 one top earner per department
  assert.equal(run(C.exercise('8.4').solution).rows.length, 8);
  // 9.3 three per campus
  const g = run(C.exercise('9.3').solution).rows;
  assert.equal(g.length, 12);
  // 10.1 four campuses with four different percents
  const f = run(C.exercise('10.1').solution).rows;
  assert.equal(f.length, 4); assert.equal(new Set(f.map(r => r[3])).size, 4);
  f.forEach(r => assert.ok(r[3] > 30 && r[3] < 110, 'fill ' + r[3]));
  // 10.2 at least 11 courses qualify, so the LIMIT matters, and rank 10 and 11 are separable
  const all = run(C.exercise('10.2').solution.replace(/LIMIT 10$/, '')).rows;
  assert.ok(all.length >= 11, 'only ' + all.length + ' courses qualify');
  assert.ok(all[9][3] !== all[10][3] || all[9][0] < all[10][0]);
  assert.ok(all[0][3] - all[all.length - 1][3] > 10, 'DFW rates should vary');
  // 8.3 over capacity sections exist, and counting withdrawals changes the list
  assert.ok(run(C.exercise('8.3').solution).rows.length >= 3);
});

test('check records attempts, keeps a solve, and explains failures', () => {
  const p = C.createProject();
  let r = C.check(p, '1.3', 'SELECT title FROM courses WHERE credits = 4');
  assert.equal(r.ok, false); assert.match(r.reason, /Expected 2 columns and got 1/);
  assert.deepEqual(r.expectedShape.columns, 2);
  r = C.check(p, '1.3', 'SELECT title, credits FROM coursez');
  assert.equal(r.ok, false); assert.match(r.reason, /Did you mean courses\?/); assert.equal(r.result, null);
  r = C.check(p, '1.3', 'DROP TABLE courses');
  assert.equal(r.ok, false); assert.match(r.reason, /Only SELECT/);
  assert.equal(p.hasTable('courses'), true);
  r = C.check(p, '1.3', 'select title, credits from courses where credits = 4;');
  assert.equal(r.ok, true); assert.ok(r.result.rows.length > 0);
  r = C.check(p, '1.3', 'SELECT 1, 2');
  assert.equal(r.ok, false);
  let pr = C.progress(p);
  assert.equal(pr.byId['1.3'].status, 'solved');
  assert.equal(pr.byId['1.3'].attempts, 5);
  assert.equal(pr.solved, 1); assert.equal(pr.total, 40);
  assert.equal(pr.units[0].solved, 1); assert.equal(pr.units[0].total, 5);
  r = C.check(p, '2.1', 'SELECT last_name, salary FROM instructors ORDER BY salary LIMIT 5');
  assert.equal(r.ok, false);
  r = C.check(p, '2.2', 'SELECT DISTINCT modality FROM sections ORDER BY modality DESC');
  assert.match(r.reason, /ORDER BY/);
  // progress survives a save and reopen
  const p2 = QD.open(p.export());
  assert.equal(C.progress(p2).solved, 1);
  assert.equal(p2.getMeta('clinic_seed'), String(C.SEED));
  C.resetProgress(p2);
  assert.equal(C.progress(p2).solved, 0);
  assert.throws(() => C.seed(p2), /already exists/);
  p.close(); p2.close();
});

test('Key Finder recovers the whole schema from the bare tables', () => {
  const p = QD.create('bare');
  C.seed(p, { declareKeys: false });
  assert.equal(p.schema().every(t => t.columns.every(c => !c.pk) && t.foreignKeys.length === 0), true);
  const a = K.analyze(p);
  const got = a.relations.filter(r => r.score >= K.THRESHOLDS.likely).map(r => r.fromTable + '.' + r.fromColumns[0] + '>' + r.toTable + '.' + r.toColumns[0]).sort();
  assert.deepEqual(got, [
    'courses.dept_id>departments.dept_id', 'enrollments.section_id>sections.section_id', 'enrollments.student_id>students.student_id',
    'instructors.dept_id>departments.dept_id', 'instructors.mentor_id>instructors.instructor_id', 'rooms.campus_id>campuses.campus_id',
    'sections.course_id>courses.course_id', 'sections.instructor_id>instructors.instructor_id', 'sections.room_id>rooms.room_id',
    'sections.term_id>terms.term_id', 'students.home_campus_id>campuses.campus_id', 'students.major_dept_id>departments.dept_id',
    'work_orders.campus_id>campuses.campus_id', 'work_orders.room_id>rooms.room_id'
  ]);
  const pk = { campuses: 'campus_id', departments: 'dept_id', instructors: 'instructor_id', courses: 'course_id', terms: 'term_id', rooms: 'room_id',
    sections: 'section_id', students: 'student_id', enrollments: 'enrollment_id', work_orders: 'work_order_id' };
  Object.keys(pk).forEach(t => assert.equal(a.keys.find(k => k.table === t && k.best).columns.join('+'), pk[t], t));
  assert.ok(a.stats.ms < 5000, 'took ' + a.stats.ms);
  // and with declared keys, everything comes back at full confidence
  const d = K.analyze(P);
  assert.equal(d.relations.filter(r => r.score === 1).length, 14);
  p.close();
});

test('the clinic module is ASCII clean', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../core/qd-clinic.js'), 'utf8');
  for (let i = 0; i < src.length; i++) assert.ok(src.charCodeAt(i) < 128, 'non ASCII at ' + i);
});
