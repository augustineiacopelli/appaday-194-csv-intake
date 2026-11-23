'use strict';
/* Day 200: older project files open under the current core, and the qd200 fixtures carry their known facts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
require('fake-indexeddb/auto');
const initSqlJs = require('sql.js');
const QD = require('../core/qd-core.js');
global.QD = QD;
const QDKeys = require('../core/qd-keys.js');
const QDClinic = require('../core/qd-clinic.js');

const FIX = path.join(__dirname, '..', 'fixtures');
const EXP = JSON.parse(fs.readFileSync(path.join(FIX, 'compat', 'expected.json'), 'utf8'));
const open = app => QD.open(fs.readFileSync(path.join(FIX, 'compat', EXP.apps[app].file)));
const relKey = r => r.fromTable + '(' + r.fromColumns.join(',') + ')->' + r.toTable + '(' + r.toColumns.join(',') + ')';

test.before(async () => { await QD.boot(initSqlJs); });

test('every compatibility file was written by the 1.2.0 core', () => {
  assert.equal(EXP.core, '1.2.0');
  Object.keys(EXP.apps).forEach(app => {
    const p = open(app);
    assert.equal(p.getMeta('core_version'), '1.2.0', app);
    assert.equal(p.getMeta('last_app'), app);
    assert.equal(p.name, EXP.apps[app].name);
    p.close();
  });
});

test('194: loaded tables keep their row counts', () => {
  const p = open('194');
  EXP.apps['194'].tables.forEach(t => assert.equal(p.scalar('SELECT count(*) FROM "' + t.table + '"'), t.rows));
  p.close();
});

test('195: saved queries, the pinned one and history read back', () => {
  const p = open('195');
  assert.deepEqual(p.queries().map(q => q.name).sort(), EXP.apps['195'].queries.slice().sort());
  assert.equal(p.queries()[0].name, EXP.apps['195'].pinned);
  assert.equal(p.queries()[0].pinned, 1);
  assert.ok(p.history(50).length >= EXP.apps['195'].historyAtLeast);
  p.close();
});

test('196: decisions and diagram positions read back, and Analyze keeps the rejection', () => {
  const p = open('196');
  const e = EXP.apps['196'];
  assert.deepEqual(p.relations('confirmed').map(relKey).sort(), e.confirmed);
  assert.deepEqual(p.relations('rejected').map(relKey), e.rejected);
  assert.deepEqual(JSON.parse(p.getMeta('diagram_positions')), e.positions);
  QDKeys.apply(p, QDKeys.analyze(p));
  assert.deepEqual(p.relations('rejected').map(relKey), e.rejected);
  assert.deepEqual(p.relations('confirmed').map(relKey).sort(), e.confirmed);
  p.close();
});

test('197: ask queries keep their origin and question', () => {
  const p = open('197');
  const ask = p.queries().filter(q => q.origin === 'ask').map(q => q.question).sort();
  assert.deepEqual(ask, EXP.apps['197'].ask.slice().sort());
  p.close();
});

test('198: pinned charts keep board order and type', () => {
  const p = open('198');
  const ch = p.charts();
  assert.deepEqual(ch.map(c => c.spec.title), EXP.apps['198'].board);
  assert.deepEqual(ch.map(c => c.spec.type), EXP.apps['198'].types);
  assert.deepEqual(ch.map(c => c.position), [0, 1]);
  p.close();
});

test('199: clinic progress reads back', () => {
  const p = open('199');
  const pr = QDClinic.progress(p);
  assert.equal(pr.solved, EXP.apps['199'].solved.length);
  EXP.apps['199'].solved.forEach(id => assert.equal(pr.byId[id].status, 'solved', id));
  p.close();
});

test('a 1.2.0 file gains report blocks under 1.3.0 and keeps everything else', () => {
  const p = open('198');
  const before = p.charts().map(c => c.id);
  p.addBlock({ kind: 'text', body: 'Added in 200' });
  p.addBlock({ kind: 'chart', refId: before[0] });
  const p2 = QD.open(p.export('200'));
  assert.deepEqual(p2.charts().map(c => c.id), before);
  assert.deepEqual(p2.blocks().map(b => b.kind), ['text', 'chart']);
  p2.close(); p.close();
});

test('qd200 fixtures: counts, delimiters and exactly three relationships', () => {
  const p = QD.create('qd200');
  const want = { campuses: [4, ','], rooms: [24, ';'], work_orders: [240, ','] };
  Object.keys(want).forEach(t => {
    const buf = fs.readFileSync(path.join(FIX, 'qd200_' + t + '.csv'));
    if (t === 'campuses') {
      assert.deepEqual([...buf.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
      assert.ok(buf.includes('\r\n'));
    }
    const r = p.loadCSV(buf.toString('utf8').replace(/^﻿/, ''), { fileName: 'qd200_' + t + '.csv' });
    assert.equal(r.rowCount, want[t][0], t);
    assert.equal(r.delimiter, want[t][1], t);
    assert.equal(r.badRows, 0, t);
  });
  const a = QDKeys.analyze(p);
  const drawn = a.relations.filter(r => r.label === 'strong' || r.label === 'likely').map(relKey).sort();
  assert.deepEqual(drawn, [
    'qd200_rooms(campus_id)->qd200_campuses(campus_id)',
    'qd200_work_orders(campus_id)->qd200_campuses(campus_id)',
    'qd200_work_orders(room_id)->qd200_rooms(room_id)'
  ]);
  assert.equal(a.relations.length, 3);
  p.close();
});
