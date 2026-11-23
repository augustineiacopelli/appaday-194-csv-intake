#!/usr/bin/env node
/*
 * Build one project file per daily app's flow with the 1.2.0 core (test/legacy/qd-core-1.2.0.js, the core
 * at commit 20086ec), so Day 200 can prove it opens real older files. Writes fixtures/compat/*.sqlite and
 * fixtures/compat/expected.json, which the Day 200 e2e reads for its assertions.
 *   node tools/make-compat.js
 * The files carry timestamps, so they change on every run; commit them once and rebuild only on purpose.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const root = path.join(__dirname, '..');
const out = path.join(root, 'fixtures', 'compat');
fs.mkdirSync(out, { recursive: true });

const QD = require(path.join(root, 'test', 'legacy', 'qd-core-1.2.0.js'));
global.QD = QD;
const QDKeys = require(path.join(root, 'core', 'qd-keys.js'));
const QDClinic = require(path.join(root, 'core', 'qd-clinic.js'));
const QDCharts = require(path.join(root, 'core', 'qd-charts.js'));

const expected = {};
function write(app, p) {
  const file = 'compat_' + app + '.sqlite';
  fs.writeFileSync(path.join(out, file), p.export(app));
  p.close();
  return file;
}
function sample(name) {
  const p = QD.create(name);
  QDClinic.seed(p, { declareKeys: false });
  return p;
}

(async function () {
  await QD.boot(initSqlJs);
  if (QD.VERSION !== '1.2.0') throw new Error('expected the 1.2.0 core, got ' + QD.VERSION);

  /* 194: the three Day 194 fixtures loaded */
  {
    const p = QD.create('Compat 194');
    const tables = [];
    ['excel_bom_customers.csv', 'semicolon_orders_dayfirst.csv', 'plain_mixed_types.csv'].forEach(f => {
      const r = p.loadCSV(fs.readFileSync(path.join(root, 'fixtures', f), 'utf8').replace(/^﻿/, ''), { fileName: f });
      tables.push({ table: r.table, rows: r.rowCount });
    });
    expected['194'] = { file: write('194', p), name: 'Compat 194', tables };
  }

  /* 195: three saved queries, one pinned, and history */
  {
    const p = sample('Compat 195');
    const sqls = ['SELECT count(*) AS n FROM students', 'SELECT name, city FROM campuses ORDER BY name', 'SELECT dept_id, count(*) AS courses FROM courses GROUP BY dept_id'];
    sqls.forEach(s => p.query(s));
    p.saveQuery({ name: 'Student count', sql: sqls[0], note: 'The headline number', pinned: true });
    p.saveQuery({ name: 'Campuses', sql: sqls[1] });
    p.saveQuery({ name: 'Courses per department', sql: sqls[2] });
    expected['195'] = { file: write('195', p), name: 'Compat 195', queries: ['Student count', 'Campuses', 'Courses per department'], pinned: 'Student count', historyAtLeast: 3 };
  }

  /* 196: analysis applied, two relationships confirmed, one rejected, diagram positions set */
  {
    const p = sample('Compat 196');
    QDKeys.apply(p, QDKeys.analyze(p));
    p.setMeta('keyfinder_analyzed_at', QD.now());
    const proposed = p.relations('proposed');
    const pick = (from, to) => proposed.find(r => r.fromTable === from && r.toTable === to);
    const c1 = pick('enrollments', 'students'), c2 = pick('sections', 'courses'), rj = pick('work_orders', 'rooms');
    if (!c1 || !c2 || !rj) throw new Error('the sample did not propose the expected relationships');
    [c1, c2].forEach(r => p.setRelation(Object.assign({}, r, { status: 'confirmed' })));
    p.setRelation(Object.assign({}, rj, { status: 'rejected' }));
    const positions = { campuses: [24, 24], students: [232, 24], enrollments: [440, 96] };
    p.setMeta('diagram_positions', JSON.stringify(positions));
    const key = r => r.fromTable + '(' + r.fromColumns.join(',') + ')->' + r.toTable + '(' + r.toColumns.join(',') + ')';
    expected['196'] = {
      file: write('196', p), name: 'Compat 196', confirmed: [key(c1), key(c2)].sort(), rejected: [key(rj)], positions
    };
  }

  /* 197: two saved queries with origin ask and their questions */
  {
    const p = sample('Compat 197');
    p.saveQuery({ name: 'How many students are there?', sql: 'SELECT count(*) AS students FROM students', origin: 'ask', question: 'How many students are there?' });
    p.saveQuery({ name: 'Highest paid instructor', sql: 'SELECT first_name, last_name, salary FROM instructors ORDER BY salary DESC LIMIT 1', origin: 'ask', question: 'Who is the highest paid instructor?' });
    expected['197'] = { file: write('197', p), name: 'Compat 197', ask: ['How many students are there?', 'Who is the highest paid instructor?'] };
  }

  /* 198: two pinned charts, moved so board order differs from creation order */
  {
    const p = sample('Compat 198');
    const s1 = 'SELECT c.name AS campus, count(*) AS students FROM students s JOIN campuses c ON c.campus_id = s.home_campus_id GROUP BY c.name';
    const s2 = "SELECT CASE WHEN closed_on IS NULL THEN 'Open' ELSE 'Closed' END AS status, count(*) AS work_orders FROM work_orders GROUP BY 1";
    const q1 = p.saveQuery({ name: 'Students per campus', sql: s1 });
    const q2 = p.saveQuery({ name: 'Work order status', sql: s2 });
    const c1 = p.saveChart({ queryId: q1, spec: QDCharts.suggest(p.query(s1), { title: 'Students per campus' }).spec });
    const g2 = QDCharts.suggest(p.query(s2), { title: 'Work order status' });
    const c2 = p.saveChart({ queryId: q2, spec: Object.assign({}, g2.spec, { type: 'pie' }) });
    p.moveChart(c2, 0);
    expected['198'] = { file: write('198', p), name: 'Compat 198', board: ['Work order status', 'Students per campus'], types: ['pie', 'bar'] };
    void c1;
  }

  /* 199: the Query Clinic project with five exercises solved */
  {
    const p = QDClinic.createProject();
    const solved = QDClinic.EXERCISES.slice(0, 5).map(ex => {
      const r = QDClinic.check(p, ex.id, ex.solution);
      if (!r.ok) throw new Error('reference answer failed for ' + ex.id);
      return ex.id;
    });
    expected['199'] = { file: write('199', p), name: QDClinic.PROJECT_NAME, solved };
  }

  fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify({ core: '1.2.0', apps: expected }, null, 2) + '\n');
  fs.readdirSync(out).sort().forEach(f => console.log(f.padEnd(24) + fs.statSync(path.join(out, f)).size));
})().catch(e => { console.error(e); process.exit(1); });
