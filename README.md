# CSV Intake | AppADay 194

CSV Intake turns spreadsheets into a real database in your browser. Drop in several CSV files and it reads each column as a number, date, yes or no, or text, keeps ZIP codes intact, flags rows that do not fit, and hands back one SQLite file you can open anywhere. Nothing is uploaded.

Live at https://augustineiacopelli.github.io/appaday-194-csv-intake/ and part of the [AppADay portfolio](https://augustineiacopelli.github.io/appaday/). Day 194 is the first of six daily builds that assemble into the Query Desk milestone on Day 200.

## Using it

Open the app and tap **Load sample data** to see ten tables from a made up college go through the same intake as your own files, or choose one or more CSV files. Each file becomes a table with a card that shows its row count, separator, encoding, and every column as a type chip. Tap a chip to change the type and the table reloads. When a column almost fits a type, a Coerce button shows how many values would be left empty. When dates could be read either way, a Month first or Day first switch rereads them. The first 20 rows are previewed with cells that did not fit crossed out and bad rows marked. Rename or remove any table. **Download** gives you one `.sqlite` file, and the project also saves itself on this device, where the other Query Desk apps can open it.

Settings, behind the gear, holds the default date order, the saved projects, and the file size limits: a phone warns above 10 MB and refuses above 15 MB, a computer warns above 40 MB and refuses above 80 MB.

## How it is built

One `index.html`. The head carries the shell CSS (accent `#289664` on a dark neutral ground) and the SQLite engine, sql.js 1.16.0, loaded by relative path from the portal repository at `../appaday/vendor/sql.js-1.16.0/`. The first script block holds the shared Query Desk core and clinic modules, vendored by `tools/vendor.js`. The second holds the intake pipeline: `decodeBytes` (UTF-8, UTF-16 LE and BE with or without a byte order mark, Windows-1252 fallback), `sniffDelimiter`, `parseCsv`, `normalizeHeaders`, `inferColumn` (leading zeros stay text, day first or month first dates), `scoreCoercion` (offers a coercion only when at least 95 percent of values fit), `buildTables` (bad row and short row flags, trailing empty Excel columns dropped), `sizeVerdict` against `QD.LIMITS`, `loadIntoSqlite` (one transaction, one prepared insert), `exportBytes`, and autosave into `QD.store`. Where the core already had a tested piece, the pipeline calls it rather than repeating it.

Not included by design: editing cell values, Excel files, and merging tables.

## Workspace

This repository also carries the shared Query Desk modules used by AppADay 194 to 200. Start with `docs/QueryDesk_Build_Kit.md`.

```
npm install                 # sql.js, jsdom and fake-indexeddb, for the tests only
npm test                    # 116 tests of the shared core
npm run check               # vendored copies in index.html and the harness match core/
node tools/vendor.js index.html   # copy core/ into the app after any core change
npm run fixtures            # regenerate fixtures/
```

`fixtures/` holds four test files: an Excel style CSV with a byte order mark and leading zero ZIP codes, a semicolon file with day first dates and one bad row, a plain comma file with every type and a near miss column, and a file just over the 15 MB phone limit. `test/e2e_csv_intake.py` drives the app in Chromium at 375 px through the done list. `test/e2e_query_bench.py` does the same for Query Bench (AppADay 195), serving this repo, `appaday-195-query-bench` and the portal clone side by side. `test/e2e_result_charts.py` does the same for Result Charts (AppADay 198); it serves Chart.js from `node_modules`, so run `npm install` first. Open `harness/index.html` in a browser to check the core on a real device. Edit modules only in `core/`.
