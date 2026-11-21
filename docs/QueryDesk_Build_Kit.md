# Query Desk Build Kit

Milestone 200, with daily builds 194 to 199. Written November 16, 2026. This document is the handoff into every planning and execution session for the week. Where it and an older plan differ, this one governs.

## 1. What already exists

Four modules were built and tested on November 16 so the daily sessions only have to build interfaces. All of them live in `core/` of the workspace and are vendored inline into each app's single `index.html`.

| Module | Global | What it does | Used by |
|---|---|---|---|
| `qd-core.js` | `QD` | Engine boot, project file open and save, reserved tables, CSV parsing and type inference, guarded queries, plain language errors, saved queries, keys and relationships storage, result comparison, CSV export, IndexedDB storage and autosave, the Claude call | every day |
| `qd-keys.js` | `QDKeys` | Primary key and foreign key inference with scores and reasons, composite keys, join path finder, JOIN writer | 196, 200, sample data check in 194 |
| `qd-clinic.js` | `QDClinic` | The practice database generator, 40 graded exercises in 10 units, the checker, progress tracking | 199, 200, and the sample data button everywhere |
| `qd-ask.js` | `QDAsk` | Question to SQL prompt, reply parsing, one repair pass, query explainer | 197, 200 |
| `qd-charts.js` | `QDCharts` | Added on Day 198. Profiles a result's columns as number, date or label, suggests the first chart spec and the allowed types, and turns a result and a spec into labels and datasets after pivot, sort and limit. Pure JavaScript with no Chart.js reference | 198, 200 |

The core is at version 1.2.0 as of Day 198, which added chart storage (`saveChart`, `charts`, `updateChart`, `moveChart`, `deleteChart` and `QD.validateChartSpec`) with no schema migration. The test suite has 116 tests and all pass (`npm test`), the original 102 plus 14 chart tests in `test/charts.test.js`. It covers the core, four trap datasets for key inference, every exercise three ways (the reference answer, a second correct route that must be accepted, and a common mistake that must be rejected), the Plain Ask flow against a mocked model, and the check page run end to end in a simulated browser.

## 2. What has not been verified

Three things could not be tested in the build sandbox. Two are now closed; the third stays open until the Plain Ask benchmarks run.

1. Closed on Day 194. The engine loads from the portal repository at `vendor/sql.js-1.16.0/`, not from the CDN. It was checked in Chromium at 375 px, and a CSV load passed on an iPhone. A project saved by CSV Intake also opens from the open sheet in Query Bench.
2. Real size limits on a phone. Settled on Day 194: `QD.LIMITS` warns at 10 MB and refuses at 15 MB on a phone, and warns at 40 MB and refuses at 80 MB on a desktop.
3. The Plain Ask prompt against the live model. The flow is tested with a mocked reply. The check page has a Live question box that sends a real question about the practice data. Section 8 lists five questions with known answers.

## 3. The contract

### The project file

A project is a standard SQLite file. Any outside SQLite tool can open it, and Query Desk can open any outside SQLite file, in which case the reserved tables are added and the user tables are left untouched. Everything Query Desk needs to remember lives in ten reserved tables whose names start with `_qd_`.

| Table | Holds | Written by |
|---|---|---|
| `_qd_meta` | key and value pairs: `format_version`, `project_name`, `created_at`, `updated_at`, `last_app`, `core_version`, `clinic_seed` | core |
| `_qd_sources` | one row per loaded file: table name, file name, row and column counts, bad rows, bad cells | 194 |
| `_qd_columns` | per column: original header, inferred type, null count, bad count, a plain language note | 194 |
| `_qd_keys` | primary key candidates: columns, status, score, evidence | 196 |
| `_qd_relations` | relationships: from table and columns, to table and columns, status, score, cardinality, evidence | 196 |
| `_qd_queries` | saved queries: name, sql, note, origin (`manual`, `ask`, `clinic`), the original question, pinned | 195, 197 |
| `_qd_history` | the last 200 runs with time, row count and any error | core |
| `_qd_charts` | chart specs tied to a saved query, with a board position | 198 |
| `_qd_notebook` | ordered report blocks of kind `text`, `query` or `chart` | 200 |
| `_qd_clinic` | exercise progress: status, attempts, last attempt, solved time | 199 |

Status values for keys and relationships are `proposed`, `confirmed` and `rejected`. Re running the analysis replaces proposals and never touches a decision a person made. `FORMAT_VERSION` is 1. Any later change must be additive and go in the migration slot inside `_ensureSchema`.

### Shared storage

`QD.store` keeps projects in an IndexedDB database named `querydesk`. Every AppADay app is served from the same origin, so a project saved in CSV Intake appears in the open list of Query Bench with no export step. Download and open by file remain the fallback and the way to move a project between devices. Storage calls never throw: without IndexedDB they resolve to false, null or an empty list.

### The two guards

Anything typed by a person or written by Claude runs through `project.query()`. It applies a text check (one statement, must begin with SELECT, WITH, VALUES or EXPLAIN, no write keywords outside quotes) and then switches the engine itself to read only with `PRAGMA query_only` for the duration of the statement. A test proves that a write still fails when the text check is deliberately disabled. `project.execute()` is the trusted path for writes, used only by loaders and by Query Bench when the person turns changes on, and it refuses to touch `_qd_` tables.

### What may leave the browser

Only Plain Ask sends anything. It sends table and column names, relationships, at most three sample rows per table (a setting can make that zero), and the question. `QDAsk.buildMessage()` returns the exact text so the interface can show it before sending.

### House rules the modules already follow

No model ID appears anywhere: the tier goes to `window.AppModels.id()`. The key comes from `window.AppKeys.get()`, and a null key resolves as declined, not as an error. Thinking is sent as `between_tools` first, then `disabled`, then omitted, only when a 400 mentions thinking, and the working form is remembered per model. Only text blocks are read. All source is ASCII. No forbidden APIs are used.

## 4. API quick reference

```js
await QD.boot();                                   // once, after the sql.js script tag
const p = QD.create('My project');                 // or QD.open(bytes)
const r = p.loadCSV(text, { fileName, types, dateOrder, tolerance, replace });
//   r = { table, rowCount, badRows, badCells, delimiter, columns: [{ name, originalHeader, type, nulls, bad, note, nearMiss }] }
p.schema();                                        // tables, columns, row counts, declared keys
p.query(sql, { params, maxRows });                 // guarded read: { columns, rows, rowCount, truncated, ms }
p.execute(sql);                                    // trusted write path
p.saveQuery({ name, sql, note, origin, question, pinned }); p.queries(); p.history(50);
p.setKey(table, columns, status, score, evidence); p.keys(status);
p.setRelation({ fromTable, fromColumns, toTable, toColumns, status }); p.relations(status);
const bytes = p.export('194');                     // Uint8Array of the .sqlite file
QD.download(bytes, QD.fileName(p));
const auto = QD.autosave(p, { app: '194', onSave }); auto.flush(); auto.stop();
await QD.store.list(); await QD.store.load(name); await QD.store.save(name, bytes, app);
QD.readFile(file, true); QD.sizeVerdict(bytes); QD.formatBytes(n); QD.toCSV(result);
QD.compareResults(got, want, { ordered });         // { match, reason }

const a = QDKeys.analyze(p);                       // { tables, keys, relations, stats }
QDKeys.apply(p, a);                                // store as proposals
const path = QDKeys.joinPath(p.relations('confirmed'), 'enrollments', 'campuses');
QDKeys.joinSQL('enrollments', path, { left: false });

const clinic = QDClinic.createProject();           // or QDClinic.seed(p, { declareKeys: false })
QDClinic.UNITS; QDClinic.EXERCISES;                // id, unit, title, prompt, ordered, solution, hint, concept, tsql
QDClinic.check(clinic, '5.3', sql);                // { ok, reason, result, expectedShape }
QDClinic.progress(clinic);                         // { byId, solved, total, units }

const ans = await QDAsk.ask(p, question, { sampleRows: 3 });
//   ans.status: ok | cannot | failed | declined; ok carries sql, explanation, assumptions, result, repaired
await QDAsk.explain(p, sql);                       // { summary, steps }

const g = QDCharts.suggest(result, { title });     // { spec, types, shape, reason, profile }; spec null when no chart fits
QDCharts.profile(result);                          // [{ name, index, kind: number|date|label, distinct, positive }]
QDCharts.data(result, spec);                       // { labels, datasets: [{ label, data }], type, truncated }
const id = p.saveChart({ queryId, spec, position }); // spec is checked by QD.validateChartSpec, anything else is refused
p.charts();                                        // [{ id, queryId, name, spec, position, createdAt }] in board order
p.updateChart(id, spec); p.moveChart(id, 0); p.deleteChart(id);
```

Inference results worth knowing when building interfaces. Column types are `integer`, `real`, `boolean`, `date`, `datetime` and `text`. Inference is strict: one value that does not fit keeps the column as text, and `nearMiss` then reports the type that almost fit and up to five offending values, so the interface can offer a one tap coercion by reloading with `types`. Digits with leading zeros stay text. Slash dates are read month first unless a day above 12 proves otherwise, and the note says when the order was a guess. Key and relationship scores run from 0 to 1 with labels `strong` (0.75 and up), `likely` (0.5 and up) and `weak` (0.3 and up). Show strong and likely as proposals and weak in a separate maybe list. Every proposal carries `reasons`, a list of plain sentences ready to display.

## 5. Workspace and workflow

```
core/       the five modules, the only place they are edited
test/       116 tests, run with npm test
tools/      vendor.js copies modules into an index.html, and --check verifies a copy
harness/    the check page, a working example of a vendored single file
docs/       this document
```

An app marks where each module goes with an empty marker pair inside one script block, for example `/* QD:CORE BEGIN */` followed by `/* QD:CORE END */`. Running `node tools/vendor.js path/to/index.html` fills them in, and only the modules whose markers are present are written. `QD:CORE` must come first. Never edit a vendored copy. To change shared behavior, edit `core/`, run `npm test`, vendor again into every shipped app, and run `--check` on each.

On Day 194 the workspace goes into the `appaday-194-csv-intake` repository alongside the app, and later sessions connect to that repository. Each later app's repository holds only its own `index.html` and README, vendored from 194.

Every app's head carries the standard icon and Save to Phone tags from the Shipping Standard, then this engine tag before the inline script. The engine lives in the portal repository (decided on Day 194), so the path is relative and every app boots with a matching `locateFile`:

```html
<script src="../appaday/vendor/sql.js-1.16.0/sql-wasm.js"></script>
```

```js
QD.boot(null, { locateFile: function (f) { return '../appaday/vendor/sql.js-1.16.0/' + f; } });
```

Day 194 also built the shared interface pieces (project bar, open sheet, empty state led by Load sample data, Settings sheet) in `index.html`. Copy them forward from there.

The AI apps (197 and 200) also carry the `models.js` tag and the `keys.js` tag with their own `data-app`. `AppKeys` must never be called at the top level of the inline script.

## 6. Decisions to make before Day 194

1. Engine hosting. Settled on Day 194: `sql-wasm.js` and `sql-wasm.wasm` are committed to the portal repository at `vendor/sql.js-1.16.0/` and loaded by relative path. The original plan loaded sql.js from jsdelivr, pinned to 1.16.0, which keeps each app a single file. It is a new CDN dependency beyond Chart.js, and the weekly health check may need to allow it. The alternative is to commit `sql-wasm.js` and `sql-wasm.wasm` to the portal repository and load them from there, which removes the outside dependency for all seven apps at once.
2. Whether the six daily apps publish as numbered portal entries. The plan assumes they do, since each one stands alone and the streak needs an app every day.
3. Categories. Milestone 200 must be Utility. The plan files 194 to 197 under Utility, 198 under Data and 199 under Educational for variety. Any of the six can move.
4. Names. Day 194 was first called Table Forge. It is renamed CSV Intake here because Forge already names the Saga series and QR Forge in the portal.

## 7. Execution manifests

Each manifest gives the repository name and portfolio description first, as the Shipping Standard asks. Descriptions are between 284 and 303 characters, ASCII, with no double quotes. All seven apps use a dark neutral background with the category accent, 44 px targets, and a gear button that opens Settings.

Every day's app shares three pieces of interface, built once on Day 194 and copied forward: the project bar (project name, saved state, Open, Download), the open sheet (saved projects from `QD.store.list()`, open a file, load the sample data), and the empty state that leads with Load sample data.

### Day 194, Tuesday November 17: CSV Intake

Repository `appaday-194-csv-intake`. Category U, accent #289664. No AI. Modules: CORE, CLINIC (for sample data).

Description: CSV Intake turns spreadsheets into a real database in your browser. Drop in several CSV files and it reads each column as a number, date, yes or no, or text, keeps ZIP codes intact, flags rows that do not fit, and hands back one SQLite file you can open anywhere. Nothing is uploaded.

Build: a drop zone and file picker that accept several files. One card per loaded table showing an editable table name, row count, and each column as a chip with its type. Tapping a chip changes the type and reloads that file with `types`. Notes from inference appear under the column they belong to, with a month first or day first switch when dates were ambiguous and a Coerce button when `nearMiss` is present. A preview grid of the first 20 rows. Bad row and bad cell counts when they are not zero. A size verdict before loading: warn asks to continue, refuse explains the limit. Remove table. Download the `.sqlite` file. Autosave.

First hour, before any interface work: open the check page on desktop and iPhone, record the size test results, and set `QD.LIMITS`. Decide the engine hosting question.

Done when: three CSV files load with correct types, including one exported from Excel with a byte order mark and one that uses semicolons. The file downloads and reopens. The project appears in the open sheet after a reload. A file over the limit is refused with a clear message. The sample data loads.

Out of scope: editing cell values, Excel files, merging tables.

### Day 195, Wednesday November 18: Query Bench

Repository `appaday-195-query-bench`. Category U. No AI. Modules: CORE, CLINIC.

Description: Query Bench is a SQL workbench that runs in a browser tab. Open any SQLite file, browse its tables, write a query and see the result grid at once. Errors come back in plain English with the name you probably meant, history is kept, and results export to CSV. Read only until you say otherwise.

Build: a schema panel listing tables with row counts, expandable to columns and types, where tapping a name inserts it at the cursor and tapping a table previews 100 rows. An editor with Run on the button and on Ctrl or Cmd plus Enter. A result grid that renders the first 200 rows and loads more on request, with row count, time, and a notice when the result was cut at `QD.LIMITS.resultRows`. Errors shown as the plain sentence from the core. A history drawer from `p.history()`. Saved queries with name and note. Export result as CSV. An Allow changes switch, off by default, that routes to `p.execute()` after a one time explanation.

Done when: a project made on Day 194 opens from the open sheet. A misspelled table name suggests the right one. DELETE is refused with changes off and works with them on. History and saved queries survive a reload. On a phone the schema panel is a drawer and the grid scrolls sideways inside its own container.

Out of scope: syntax highlighting beyond a monospace editor, autocomplete, multiple result tabs.

### Day 196, Thursday November 19: Key Finder

Repository `appaday-196-key-finder`. Category U. No AI. Modules: CORE, KEYS, CLINIC.

Description: Key Finder works out how the tables in a database fit together. It profiles every column, proposes primary keys and foreign keys with a confidence and its reasons, and avoids the classic trap of matching row numbers to row numbers. Confirm the links, see the diagram, and tap two tables to get the JOIN.

Build: Analyze runs `QDKeys.analyze()` then `QDKeys.apply()`. A keys list, one best key per table with its label and reasons, and other candidates behind a disclosure. A relationships list in three groups: Proposed (strong and likely), Maybe (weak), and Decided. Each row has Confirm and Reject, shows its reasons, orphan count and whether it is optional, and offers the alternates when `ambiguous` is true. Add a relationship by hand with four pickers. The diagram is the new work of the day: an SVG with one box per table listing its key columns, solid lines for confirmed relationships and dashed lines for proposals, boxes draggable, positions saved in `_qd_meta` under `diagram_positions`. Tapping two tables calls `joinPath` and `joinSQL`, shows the JOIN, and offers Copy and Save as query.

The sample data here must be seeded with `declareKeys: false`, so there is something to find.

Done when: the sample data yields 14 proposed relationships and 10 primary keys with none wrong. A rejected relationship stays rejected after Analyze runs again. The JOIN between enrollments and campuses runs in Query Bench. Two unrelated tables produce no proposals.

Out of scope: composite foreign keys entered by hand, automatic diagram layout beyond a sensible starting grid.

### Day 197, Friday November 20: Plain Ask

Repository `appaday-197-plain-ask`. Category U. AI, so `ai:true`, `models.js` and `keys.js` with `data-app="197"`, and a Console key named `appaday-197-plain-ask`. Modules: CORE, CLINIC, ASK.

Description: Plain Ask answers questions about your data in plain English. Type a question and Claude writes the SQL, lists the assumptions it made, and explains the query step by step before you trust the answer. Only table names and three sample rows are sent, and the query can read but never change your data.

Build: a question box with four starter questions generated locally from the schema. A What will be sent disclosure showing `QDAsk.buildMessage()` word for word, with a switch between three sample rows and none. The answer card shows the explanation, the assumptions as a list, the SQL in a collapsible editable block with Run again, the result grid, and a Repaired note when `repaired` is true. The four statuses each get their own state: `cannot` shows the reason, `failed` shows the query and the error, `declined` points at Settings. Save as query stores `origin: 'ask'` and the question. Explain this query calls `QDAsk.explain()`. Settings mounts the key manager.

First hour: run the five benchmark questions in section 8 against the live model through the check page and tune `QDAsk.SYSTEM` in `core/` if any fail.

Done when: all five benchmarks return the known answers. A request to delete data comes back cannot or failed and the data is intact. With no key the app explains what to do and nothing breaks.

Out of scope: follow up questions that remember the last answer, streaming.

### Day 198, Saturday November 21: Result Charts

Repository `appaday-198-result-charts`. Category D, accent #B8860B. No AI. Modules: CORE, CLINIC, CHARTS. Chart.js 4.4.1 from jsdelivr at `dist/chart.umd.js` (4.4.1 ships no `chart.umd.min.js`; its UMD file is already minified). Shipped November 21 with core 1.2.0.

Description: Result Charts turns any query result into the chart that fits it. It reads the shape of the result, picks a bar, line, scatter or pie, lets you pivot and restyle in a tap, and pins charts to a board that reruns each query whenever you open it. Works on any SQLite file, in the browser.

Build: pick a saved query or type one. Shape rules decide the first chart: one label column and one number gives a sorted bar chart; a date or period column and one or more numbers gives a line chart; two numbers give a scatter; one label and one positive number with six rows or fewer also offers a pie; two label columns and one number gives a grouped bar through a pivot; a single value gives a large number tile. The person can override the type, the columns, sorting and stacking. Pin stores the spec in `_qd_charts` and saves the query if it was not saved. The board reruns every pinned query on open. Export a chart as PNG.

The chart spec is fixed here so Day 200 reads the same rows:

```json
{ "type": "bar|line|scatter|pie|tile", "x": "column", "y": ["column"], "series": "column or null",
  "stacked": false, "sort": "none|asc|desc", "limit": 50, "title": "text" }
```

Done when: each of the six shapes produces the expected chart from the sample data. A pinned chart survives a reload and reflects changed data. Charts are readable at 375 px.

Out of scope: dashboards with filters, maps, dual axes.

### Day 199, Sunday November 22: Query Clinic

Repository `appaday-199-query-clinic`. Category E, accent #1F7A8C. No AI. Modules: CORE, CLINIC.

Description: Query Clinic is a hands on SQL course in your browser. Forty graded exercises on a built in college database take you from SELECT to window functions. Every answer is checked by its results, not its wording, each mistake gets a specific reason, and notes show where SQL Server differs.

Build: a unit list with progress per unit from `QDClinic.progress()`. The exercise screen shows the prompt, an editor, Run (shows the result without grading) and Check (calls `QDClinic.check()`). A failed check shows the reason and the expected number of columns and rows. A passed check shows the concept line and the next exercise. Hint reveals on request. Show answer unlocks after three failed attempts. A schema drawer lists the ten practice tables with columns and three sample rows. A setting, I am learning SQL Server, shows the `tsql` note where an exercise has one. Progress lives in its own project named Query Clinic, saved through `QD.store`, with Reset progress in Settings. A finish screen with totals.

The 40 exercises and their grading are already written and verified. The day is interface only.

Done when: an exercise can be failed, hinted, solved and revisited. Progress survives a reload. A DROP TABLE attempt is refused and the practice data is intact. All ten units are reachable on a phone.

Out of scope: new exercises, free form practice on the person's own data.

### Day 200, Monday November 23: Query Desk

Repository `appaday-200-query-desk`. Category U. AI, with `data-app="200"` and a Console key named `appaday-200-query-desk`. Portal entry carries `milestone:true`. Modules: all five, CORE, KEYS, CLINIC, ASK and CHARTS. Exempt from the two hour budget.

Description: Query Desk is a full data workstation in one browser tab. Load CSV files into a real SQLite database, let it find how the tables connect, ask questions in plain English or write SQL, chart the results, and export a finished report. A forty exercise SQL course is built in. Nothing is uploaded.

Build: one shell with seven tabs, Load, Relate, Ask, Query, Chart, Report and Learn, each taken from its daily app with the duplicated project bar and open sheet removed. One project is open at a time across the first six tabs. Learn opens the Query Clinic project beside it without disturbing the open one. The links between tabs are the point of the assembly: a confirmed relationship feeds Plain Ask through `schemaText()` with no extra code; a JOIN from Relate opens in Query; an answer from Ask can be saved, charted or sent to the report in one tap; a chart can be added to the report.

Report is the one new feature. It is an ordered list of blocks stored in `_qd_notebook`, each a text note, a saved query with its result table, or a pinned chart. Blocks can be reordered and removed. Export writes a single self contained HTML file with the title, date, notes, tables and chart images, and print styles so it saves cleanly as a PDF.

A first run screen offers the sample data and a five step tour: load, relate, ask, chart, report.

Done when: starting from three CSV files, a person can reach a finished exported report without leaving the tab. A project made by any of the six daily apps opens with its saved queries, relationships and charts intact. The full flow works on an iPhone within the measured size limit. `node tools/vendor.js --check` passes for all seven apps.

## 8. Live benchmarks for Plain Ask

Ask these against the sample data. The answers are fixed because the data is generated from a fixed seed.

| Question | Known answer |
|---|---|
| How many students are there? | 400 |
| Which campus has the most open work orders? | Riverbend with 21, then Main 18, Northgate 8, Cedar Hollow 0 |
| Who is the highest paid instructor? | Victor Eastman at 106,635 |
| Which courses have never been offered? | Field Camp, Internship in Business, Special Topics in Computing, Special Topics in Mathematics |
| Which department has the highest DFW rate, counting D, F and withdrawals among finished enrollments? | Mathematics at 34.9 percent, then Computer Science at 30.0 |

The last question is the hard one. It needs three joins, a rate with decimal division, and the judgment to leave out enrollments still in progress. A correct answer that states that assumption is the standard to hold the prompt to.

## 9. Opening prompt for each execution session

We are building [app name] for AppADay Day [number] according to the manifest for that day in the Query Desk Build Kit. The shared modules are already written and tested and are in the workspace under core. Do not rewrite them. Build the single index.html for this app, vendor the modules it needs with tools/vendor.js, run npm test and the vendor check, and deliver the shipping checklist.
