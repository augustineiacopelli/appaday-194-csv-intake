#!/usr/bin/env node
/*
 * Copy the Query Desk modules from core/ into an app's index.html.
 *
 *   node tools/vendor.js path/to/index.html            write the current modules into the file
 *   node tools/vendor.js --check path/to/index.html    exit 1 if the file's copies differ from core/
 *
 * The target marks where each module goes with an empty pair of markers inside a script block:
 *   /* QD:CORE BEGIN * /
 *   /* QD:CORE END * /
 * Only the modules whose markers appear in the target are written, so an app carries just what it uses.
 * Never edit a vendored copy. Edit core/, run npm test, then run this for every app.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const MODULES = { CORE: 'qd-core.js', KEYS: 'qd-keys.js', CLINIC: 'qd-clinic.js', ASK: 'qd-ask.js', CHARTS: 'qd-charts.js' };
const args = process.argv.slice(2);
const check = args.includes('--check');
const targets = args.filter(a => a !== '--check');
if (!targets.length) { console.error('usage: node tools/vendor.js [--check] index.html [more.html]'); process.exit(2); }
const coreDir = path.join(__dirname, '..', 'core');
let bad = 0;
for (const target of targets) {
  let html = fs.readFileSync(target, 'utf8');
  const found = [];
  for (const [tag, file] of Object.entries(MODULES)) {
    const re = new RegExp('/\\* QD:' + tag + ' BEGIN[^*]*\\*/[\\s\\S]*?/\\* QD:' + tag + ' END \\*/', 'g');
    const hits = html.match(re);
    if (!hits) continue;
    if (hits.length > 1) { console.error(target + ': QD:' + tag + ' markers appear ' + hits.length + ' times'); bad += 1; continue; }
    const src = fs.readFileSync(path.join(coreDir, file), 'utf8').trim();
    if (/<\/script/i.test(src)) { console.error(file + ' contains a closing script tag and cannot be inlined'); bad += 1; continue; }
    found.push(tag);
    if (check) { if (hits[0] !== src) { console.error(target + ': QD:' + tag + ' is out of date'); bad += 1; } }
    else html = html.replace(re, () => src);
  }
  if (!found.length) { console.error(target + ': no QD markers found'); bad += 1; continue; }
  if (found.some(t => t !== 'CORE')) {
    if (!found.includes('CORE')) { console.error(target + ': a module is present without QD:CORE'); bad += 1; }
    else if (html.indexOf('QD:CORE BEGIN') > Math.min(...found.filter(t => t !== 'CORE').map(t => html.indexOf('QD:' + t + ' BEGIN')))) {
      console.error(target + ': QD:CORE must come before the other modules'); bad += 1;
    }
  }
  if (!check && !bad) fs.writeFileSync(target, html);
  console.log((check ? 'checked ' : 'vendored ') + target + ': ' + found.join(', '));
}
process.exit(bad ? 1 : 0);
