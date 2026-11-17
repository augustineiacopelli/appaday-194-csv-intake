#!/usr/bin/env node
/*
 * Generate the Day 194 test fixtures into fixtures/. Deterministic: the same files every run.
 *   node tools/make-fixtures.js
 *
 *   excel_bom_customers.csv      UTF-8 byte order mark, CRLF, a ZIP column with leading zeros,
 *                                month first dates, currency, TRUE and FALSE
 *   semicolon_orders_dayfirst.csv semicolons, day first dates, one ambiguous date column, one bad row
 *   plain_mixed_types.csv        commas: integers, reals, booleans, ISO datetimes, text, and a near miss
 *                                integer column that the Coerce action can fix
 *   oversize_phone.csv           just above the phone refusal limit of 15 MB
 */
'use strict';
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'fixtures');
fs.mkdirSync(out, { recursive: true });

let seed = 194;
function r() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function ri(lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function pick(a) { return a[Math.floor(r() * a.length)]; }
function pad(n, w) { return String(n).padStart(w, '0'); }

const first = ['Ana', 'Ben', 'Carla', 'Dev', 'Elena', 'Frank', 'Grace', 'Hugo', 'Ines', 'Jack', 'Kira', 'Luis', 'Maya', 'Nate'];
const last = ['Smith', 'Garcia', 'Nguyen', 'Okafor', 'Rossi', 'Kim', 'Patel', 'Brown', 'Iacono', 'Lopez'];
const zips = ['02134', '07030', '01810', '06103', '67202', '67037', '08540', '00501', '03801', '67226'];

/* 1. Excel style: BOM, CRLF, leading zero ZIPs, slash dates month first (some days above 12) */
{
  const lines = ['Customer ID,Customer Name,ZIP,Signup Date,Balance,Active'];
  for (let i = 1; i <= 48; i++) {
    let name = pick(first) + ' ' + pick(last);
    if (i % 9 === 0) name = '"' + pick(last) + ', ' + pick(first) + '"';
    const date = ri(1, 12) + '/' + ri(1, 28) + '/' + ri(2019, 2026);
    const bal = ri(0, 1) ? '"$' + ri(1, 9) + ',' + pad(ri(0, 999), 3) + '.' + pad(ri(0, 99), 2) + '"' : '$' + ri(5, 999) + '.' + pad(ri(0, 99), 2);
    lines.push([1000 + i, name, zips[i % zips.length], date, bal, ri(0, 3) ? 'TRUE' : 'FALSE'].join(','));
  }
  lines[3] = lines[3].replace(/,(\d+)\/(\d+)\/(\d{4}),/, ',$1/23/$3,');
  fs.writeFileSync(path.join(out, 'excel_bom_customers.csv'), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]));
}

/* 2. Semicolons, day first order dates, an ambiguous delivery date column, one row with an extra cell */
{
  const lines = ['Order No;Order Date;Delivery Date;Region;Qty;Unit Price'];
  for (let i = 1; i <= 40; i++) {
    const od = pad(ri(13, 28), 2) + '/' + pad(ri(1, 12), 2) + '/2026';
    const dd = pad(ri(1, 12), 2) + '/' + pad(ri(1, 12), 2) + '/2026';
    lines.push(['SO-' + pad(i, 4), od, dd, pick(['Nord', 'Sud', 'Est', 'Ovest']), ri(1, 40), ri(1, 300) + '.' + pad(ri(0, 99), 2)].join(';'));
  }
  lines[17] += ';stray note';
  fs.writeFileSync(path.join(out, 'semicolon_orders_dayfirst.csv'), lines.join('\n') + '\n');
}

/* 3. Plain commas: every type, plus a rating column where 2 of 60 values are words */
{
  const lines = ['id,score,passed,recorded_at,rating,comment'];
  for (let i = 1; i <= 60; i++) {
    const ts = '2026-' + pad(ri(1, 11), 2) + '-' + pad(ri(1, 28), 2) + 'T' + pad(ri(0, 23), 2) + ':' + pad(ri(0, 59), 2) + ':' + pad(ri(0, 59), 2);
    const rating = (i === 14 || i === 41) ? 'unknown' : String(ri(1, 5));
    const comment = pick(['on time', 'late start', 'needs review', '"said ""great"" twice"', 'n/a', '']);
    lines.push([i, (r() * 100).toFixed(2), pick(['true', 'false']), ts, rating, comment].join(','));
  }
  fs.writeFileSync(path.join(out, 'plain_mixed_types.csv'), lines.join('\n') + '\n');
}

/* 4. Just above the phone refusal limit (15 MB) */
{
  const target = 15 * 1048576 + 65536;
  const parts = ['row_id,sensor,reading,taken_at,label\n'];
  let size = parts[0].length, i = 0;
  while (size < target) {
    i += 1;
    const line = i + ',S' + pad(i % 500, 3) + ',' + (r() * 1000).toFixed(3) + ',2026-11-' + pad(1 + (i % 28), 2) + ' ' + pad(i % 24, 2) + ':' + pad(i % 60, 2) + ':00,' + pick(['ok', 'check', 'fault', 'calibrate']) + '\n';
    parts.push(line); size += line.length;
  }
  fs.writeFileSync(path.join(out, 'oversize_phone.csv'), parts.join(''));
}

fs.readdirSync(out).sort().forEach(f => console.log(f.padEnd(32) + fs.statSync(path.join(out, f)).size));
