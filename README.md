# appaday-194-csv-intake
CSV Intake turns spreadsheets into a real database in your browser. Drop in several CSV files and it reads each column as a number, date, yes or no, or text, keeps ZIP codes intact, flags rows that do not fit, and hands back one SQLite file you can open anywhere. Nothing is uploaded.

## Workspace

This repository also carries the shared Query Desk modules used by AppADay 194 to 200. Start with `docs/QueryDesk_Build_Kit.md`.

```
npm install        # sql.js, jsdom and fake-indexeddb, for the tests only
npm test           # 99 tests
node tools/vendor.js index.html          # copy core/ into the app
node tools/vendor.js --check index.html  # confirm the app is current
```

Open `harness/index.html` in a browser to check the core on a real device. Edit modules only in `core/`.
