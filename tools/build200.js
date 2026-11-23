#!/usr/bin/env node
/*
 * Build Query Desk (AppADay 200) from apps/200/src into apps/200/index.html.
 *
 *   node tools/build200.js           write apps/200/index.html with empty QD marker pairs
 *   node tools/build200.js --check   exit 1 if apps/200/index.html is older than a source, or a tab
 *                                    stylesheet rule reaches outside its tab
 *
 * After building, run  node tools/vendor.js apps/200/index.html  to fill the five modules, then copy the
 * file into the appaday-200-query-desk repository. The single file rule holds for the shipped app: the
 * parts live here only so they can be edited one at a time.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'apps', '200');
const src = path.join(dir, 'src');
const out = path.join(dir, 'index.html');
const TABS = ['load', 'relate', 'ask', 'query', 'chart', 'report', 'learn'];
const SCRIPTS = ['tab-chart.js', 'tab-load.js', 'tab-relate.js', 'tab-ask.js', 'tab-query.js', 'tab-report.js', 'tab-learn.js', 'shell.js'];
const PARTS = ['head.html', 'base.css', 'tabs.css', 'body.html'].concat(SCRIPTS);
const MODULES = ['CORE', 'KEYS', 'CLINIC', 'ASK', 'CHARTS'];

function read(f) { return fs.readFileSync(path.join(src, f), 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, ''); }

/* Every selector in tabs.css must start with a tab class, so a tab's rules never style anything outside it. */
function strayTabSelectors(css) {
  const bad = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
  const re = /([^{}@]+)\{/g;
  let m;
  while ((m = re.exec(body))) {
    const sel = m[1].trim();
    if (!sel || /^(from|to|\d+%)$/.test(sel)) continue;
    sel.split(',').map(s => s.trim()).forEach(s => {
      if (!/^\.t-(load|relate|ask|query|chart|report|learn)\b/.test(s)) bad.push(s);
    });
  }
  return bad;
}

function nonAscii(name, text) {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 126 || (text.charCodeAt(i) < 32 && !/[\n\t]/.test(text[i]))) {
      const line = text.slice(0, i).split('\n').length;
      return name + ':' + line + ' has a character outside printable ASCII';
    }
  }
  return null;
}

function check() {
  const problems = [];
  if (!fs.existsSync(out)) problems.push('apps/200/index.html has not been built');
  else {
    const built = fs.statSync(out).mtimeMs;
    PARTS.concat(['../../../tools/build200.js']).forEach(f => {
      const p = path.join(src, f);
      if (fs.statSync(p).mtimeMs > built) problems.push(path.relative(root, p) + ' is newer than apps/200/index.html');
    });
  }
  strayTabSelectors(read('tabs.css')).forEach(s => problems.push('tabs.css selector outside a tab: ' + s));
  PARTS.forEach(f => { const e = nonAscii(f, read(f)); if (e) problems.push(e); });
  return problems;
}

if (process.argv.includes('--check')) {
  const problems = check();
  problems.forEach(p => console.error(p));
  if (problems.length) process.exit(1);
  console.log('checked apps/200/index.html: built from current sources');
  process.exit(0);
}

const stray = strayTabSelectors(read('tabs.css'));
if (stray.length) { stray.forEach(s => console.error('tabs.css selector outside a tab: ' + s)); process.exit(1); }
const bad = PARTS.map(f => nonAscii(f, read(f))).filter(Boolean);
if (bad.length) { bad.forEach(b => console.error(b)); process.exit(1); }

const markers = MODULES.map(m => '/* QD:' + m + ' BEGIN */\n/* QD:' + m + ' END */').join('\n');
const html = [
  read('head.html'),
  '<style>',
  read('base.css'),
  read('tabs.css'),
  '</style>',
  '</head>',
  '<body>',
  read('body.html'),
  '<script>',
  markers,
  '</script>',
  '<script>',
  'var QDeskTabs = {};',
  SCRIPTS.map(read).join('\n\n'),
  '</script>',
  '</body>',
  '</html>',
  ''
].join('\n');
if (/<\/script/i.test(SCRIPTS.map(read).join('\n').replace(/<\\\/script/gi, ''))) { console.error('a script part contains a closing script tag'); process.exit(1); }
fs.writeFileSync(out, html);
console.log('built apps/200/index.html (' + Math.round(html.length / 1024) + ' KB before vendoring)');
void TABS;
