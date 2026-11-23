'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');
const realInit = require('sql.js');
const { indexedDB } = require('fake-indexeddb');

const root = path.join(__dirname, '..');
const harness = path.join(root, 'harness', 'index.html');

test('the modules load as classic scripts with no module system present', async () => {
  const ctx = { console, setTimeout, clearTimeout, performance, Uint8Array, TextEncoder };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.initSqlJs = () => realInit();
  ['qd-core.js', 'qd-keys.js', 'qd-clinic.js', 'qd-ask.js', 'qd-charts.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'core', f), 'utf8'), ctx, { filename: f }));
  assert.equal(typeof ctx.module, 'undefined');
  ['QD', 'QDKeys', 'QDClinic', 'QDAsk', 'QDCharts'].forEach(g => assert.equal(typeof ctx[g], 'object', g));
  await ctx.QD.boot();
  const p = ctx.QDClinic.createProject();
  assert.equal(p.scalar('SELECT count(*) FROM students'), 400);
  assert.equal(ctx.QDClinic.check(p, '4.1', 'SELECT count(*) FROM students').ok, true);
  p.close();
});

test('the harness carries current copies of every module', () => {
  const out = execFileSync('node', [path.join(root, 'tools', 'vendor.js'), '--check', harness], { encoding: 'utf8' });
  assert.match(out, /checked .*: CORE, KEYS, CLINIC, ASK, CHARTS/);
});

test('vendor --check catches a stale or edited copy', () => {
  const tmp = path.join(require('os').tmpdir(), 'qd-stale-' + process.pid + '.html');
  fs.writeFileSync(tmp, fs.readFileSync(harness, 'utf8').replace(/QD\.VERSION = '[0-9.]+'/, "QD.VERSION = '0.9.9'"));
  assert.throws(() => execFileSync('node', [path.join(root, 'tools', 'vendor.js'), '--check', tmp], { stdio: 'pipe' }));
  execFileSync('node', [path.join(root, 'tools', 'vendor.js'), tmp], { stdio: 'pipe' });
  execFileSync('node', [path.join(root, 'tools', 'vendor.js'), '--check', tmp], { stdio: 'pipe' });
  fs.unlinkSync(tmp);
});

test('the harness page runs every check to green in a browser like environment', async () => {
  const html = fs.readFileSync(harness, 'utf8');
  for (let i = 0; i < html.length; i++) assert.ok(html.charCodeAt(i) < 128, 'non ASCII in harness at ' + i);
  assert.ok(!/claude-(sonnet|opus|haiku|fable)/i.test(html));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/harness/',
    beforeParse(window) { window.initSqlJs = () => realInit(); window.indexedDB = indexedDB; }
  });
  const doc = dom.window.document;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const s = doc.getElementById('summary').textContent;
    if (/passed|failed/.test(s)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const rows = [...doc.querySelectorAll('#checks li')].map(li => li.className + ' | ' + li.children[1].textContent + ' | ' + li.children[2].textContent);
  const summary = doc.getElementById('summary').textContent;
  assert.match(summary, /^All checks passed, 1 skipped\.$/, summary + '\n' + rows.join('\n'));
  assert.equal(rows.length, 10);
  assert.equal(rows.filter(r => r.startsWith('ok')).length, 9, rows.join('\n'));
  assert.match(rows[9], /^skip \| The shared key and model scripts are present/);
  // the size test runs at a tiny size
  const btn = doc.querySelector('button[data-mb="5"]');
  btn.setAttribute('data-mb', '0.2'); btn.click();
  const d2 = Date.now() + 20000;
  while (Date.now() < d2 && !/RESULT/.test(doc.getElementById('sizeout').textContent)) await new Promise(r => setTimeout(r, 100));
  assert.match(doc.getElementById('sizeout').textContent, /RESULT: 0\.2 MB works here\./);
  assert.match(doc.getElementById('sizeout').textContent, /integer, text, date, real, text, text/);
  dom.window.close();
});
