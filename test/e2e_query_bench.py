# End to end check of Query Bench (AppADay 195) in Chromium at 375px.
# Serve the parent folder that holds this repo, the 195 repo and the appaday portal clone side by side:
#   cd .. && python3 -m http.server 8195   then   python3 appaday-194-csv-intake/test/e2e_query_bench.py
# The work_orders sample table has no status column, so "open" orders are the ones with closed_on IS NULL.
import os, sys
from playwright.sync_api import sync_playwright

PORT = os.environ.get('QB_PORT', '8195')
BASE = 'http://127.0.0.1:' + PORT + '/'
URL = BASE + 'appaday-195-query-bench/'
URL194 = BASE + 'appaday-194-csv-intake/'
FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures') + os.sep
SHOT = os.environ.get('QB_SHOTS', '/home/claude/shots195/')
os.makedirs(SHOT, exist_ok=True)
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
OPEN_SQL = 'SELECT count(*) FROM work_orders WHERE closed_on IS NULL'
DELETE_SQL = 'DELETE FROM work_orders WHERE closed_on IS NULL'
results = []

def ok(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + ('  ' + str(extra) if extra else ''))

def booted(page):
    page.wait_for_function("!['Loading engine', 'Starting'].includes(document.querySelector('#saveState .txt').textContent)", timeout=20000)

def run(page, sql):
    page.fill('#editor', sql)
    page.click('#btnRun')

def no_sideways(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, user_agent=UA, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'TUNNEL' not in m.text else None)

    # a project built in the 194 page, saved to the shared store
    page.goto(URL194); booted(page)
    page.set_input_files('#fileCsv', [FX + 'excel_bom_customers.csv', FX + 'semicolon_orders_dayfirst.csv', FX + 'plain_mixed_types.csv'])
    page.wait_for_function("document.querySelectorAll('.card').length === 3", timeout=20000)
    page.fill('#projName', 'Handoff from 194'); page.press('#projName', 'Enter')
    page.wait_for_function("document.querySelector('#saveState').classList.contains('saved')", timeout=10000)
    page.wait_for_timeout(600)

    # 195 boots to the empty state led by Load sample data
    page.goto(URL); booted(page)
    ok('engine boots, empty state leads with Load sample data', page.is_visible('#empty') and page.evaluate("document.querySelector('#empty .cta .btn').id") == 'btnSample')
    ok('no sideways scroll (empty)', no_sideways(page))
    page.screenshot(path=SHOT + '01-empty.png')

    # sample data
    page.click('#btnSample')
    page.wait_for_function("document.querySelectorAll('#schemaBody .trow').length === 10", timeout=30000)
    ok('sample loads with 10 tables', page.locator('#schemaBody .trow').count() == 10)
    page.wait_for_function("document.querySelector('#saveState').classList.contains('saved')", timeout=10000)
    ok('sample autosaves', True)
    ok('schema panel is hidden as a drawer at 375px', not page.is_visible('#schema'))

    # drawer
    page.click('#btnTables')
    page.wait_for_timeout(300)
    ok('drawer opens', page.is_visible('#schema') and page.evaluate("document.body.classList.contains('drawer-open')"))
    page.screenshot(path=SHOT + '02-drawer.png')
    page.mouse.click(360, 400)
    page.wait_for_timeout(300)
    ok('drawer closes on scrim', not page.evaluate("document.body.classList.contains('drawer-open')"))
    page.click('#btnTables'); page.wait_for_timeout(250); page.keyboard.press('Escape'); page.wait_for_timeout(300)
    ok('drawer closes on Escape', not page.evaluate("document.body.classList.contains('drawer-open')"))

    # chevron and insert
    page.click('#btnTables'); page.wait_for_timeout(250)
    page.click('[data-chev="students"]')
    chips = page.locator('[data-t="students"] .tchip').count()
    ok('chevron shows columns with type chips', chips >= 5, chips)
    page.fill('#editor', '')
    page.click('[data-t="students"] .tins')
    ok('name button inserts the quoted identifier', page.input_value('#editor') == '"students"', page.input_value('#editor'))

    # peek
    hist0 = page.evaluate("Bench.state.p.history(500).length")
    page.click('[data-peek="students"]')
    page.wait_for_selector('#resultBody table.grid')
    rows = page.locator('#resultBody tbody tr').count()
    ok('100 row peek works', rows == 100 and '100 rows' in page.text_content('#status'), (rows, page.text_content('#status')))
    ok('peek closes the drawer and skips history', not page.evaluate("document.body.classList.contains('drawer-open')") and page.evaluate("Bench.state.p.history(500).length") == hist0)
    ok('no sideways page scroll with a wide grid', no_sideways(page))
    ok('grid scrolls sideways inside its own container', page.evaluate("(() => { const s = document.querySelector('.result-scroll'); return s.scrollWidth > s.clientWidth; })()"))
    page.screenshot(path=SHOT + '03-peek.png')

    # show more
    run(page, 'SELECT * FROM enrollments')
    page.wait_for_selector('#btnMore')
    ok('first 200 rows, then Show 200 more', page.locator('#resultBody tbody tr').count() == 200)
    page.click('#btnMore')
    ok('Show more adds 200', page.locator('#resultBody tbody tr').count() == 400)

    # misspelled table
    run(page, 'SELECT * FROM studnets')
    page.wait_for_selector('.errcard')
    err = page.text_content('.errcard')
    ok('studnets suggests students', 'Did you mean students' in err, err)
    page.screenshot(path=SHOT + '04-error.png')

    # delete refused, then allowed
    before = page.evaluate("Bench.state.p.scalar(%r)" % OPEN_SQL)
    run(page, DELETE_SQL)
    page.wait_for_selector('.errcard.guard')
    ok('DELETE refused with changes off', 'Only SELECT' in page.text_content('.errcard') and page.evaluate("Bench.state.p.scalar(%r)" % OPEN_SQL) == before, page.text_content('.errcard'))
    page.screenshot(path=SHOT + '05-refused.png')
    page.click('[data-allow]')
    ok('one time explanation sheet', page.is_visible('#chgScrim'))
    page.click('#btnChangesOk')
    ok('Changes allowed bar and switch', page.is_visible('#changesBar') and page.get_attribute('#swChanges', 'aria-checked') == 'true')
    page.click('#btnRun')
    page.wait_for_selector('.donecard')
    after = page.evaluate("Bench.state.p.scalar(%r)" % OPEN_SQL)
    done = page.text_content('.donecard')
    ok('DELETE succeeds with changes on and lowers the count', before > 0 and after == 0 and ('Done. %d rows changed.' % before) == done.strip(), (before, after, done))
    page.screenshot(path=SHOT + '06-done.png')
    run(page, 'DROP TABLE _qd_queries')
    page.wait_for_selector('.errcard')
    ok('reserved tables stay protected with changes on', '_qd_' in page.text_content('.errcard'))
    page.click('#btnChangesOff')
    ok('Turn off returns to read only', page.get_attribute('#swChanges', 'aria-checked') == 'false')

    # saved query
    run(page, 'SELECT name, city FROM campuses ORDER BY name')
    page.wait_for_selector('#resultBody table.grid')
    page.click('#btnSave')
    page.fill('#qName', 'Campus list'); page.fill('#qNote', 'For the reload check')
    page.click('#btnSaveGo')
    page.wait_for_timeout(200)
    page.fill('#editor', 'SELECT name, city, opened_year FROM campuses ORDER BY name')
    page.click('#btnSave'); page.click('#btnSaveGo')
    ok('same name updates by id', page.evaluate("Bench.state.p.queries().length") == 1 and 'opened_year' in page.evaluate("Bench.state.p.queries()[0].sql"))

    # csv export
    with page.expect_download() as dl:
        page.click('#btnCsv')
    fn = dl.value.suggested_filename
    ok('CSV export file name', fn.startswith('prairie-ridge-sample') and fn.endswith('.csv'), fn)

    page.wait_for_function("document.querySelector('#saveState').classList.contains('saved')", timeout=10000)
    page.evaluate("Bench.state.auto && Bench.state.auto.flush()")
    page.wait_for_timeout(600)
    page.reload(); booted(page)
    ok('project reopens after reload', page.input_value('#projName').startswith('Prairie Ridge sample'))
    ok('changes reset to off on open', page.get_attribute('#swChanges', 'aria-checked') == 'false')
    ok('deleted rows stay deleted after reload', page.evaluate("Bench.state.p.scalar(%r)" % OPEN_SQL) == 0)
    ok('draft editor text survives reload', 'opened_year' in page.input_value('#editor'))
    page.click('#btnLib')
    hist = page.locator('#histList .qitem').count()
    ok('history rows survive a reload', hist >= 4, hist)
    page.screenshot(path=SHOT + '07-history.png')
    page.click('[data-tab="saved"]')
    saved = page.text_content('#savedList')
    ok('saved query survives a reload', 'Campus list' in saved and 'For the reload check' in saved)
    page.click('[data-pin]')
    ok('pin toggle', page.get_attribute('[data-pin]', 'aria-pressed') == 'true')
    page.screenshot(path=SHOT + '08-saved.png')
    page.click('[data-qload]')
    ok('load fills the editor', 'opened_year' in page.input_value('#editor') and not page.is_visible('#libScrim'))
    page.click('#btnLib'); page.click('[data-tab="saved"]')
    page.click('[data-qdel]'); page.click('[data-qdel]')
    ok('two tap Delete', page.evaluate("Bench.state.p.queries().length") == 0)
    page.keyboard.press('Escape')

    # clear history
    page.click('#btnGear')
    page.click('#btnClearHist'); page.click('#btnClearHist')
    ok('Clear history for this project', page.evaluate("Bench.state.p.history(50).length") == 0)
    page.keyboard.press('Escape')

    # keyboard shortcut
    page.fill('#editor', 'SELECT 1 AS one')
    page.focus('#editor'); page.keyboard.press('Control+Enter')
    page.wait_for_selector('#resultBody table.grid')
    ok('Ctrl+Enter runs', page.text_content('#resultBody tbody td.num') == '1')

    # 194 project opens from the 195 open sheet
    page.click('#btnOpen')
    page.wait_for_selector('#openList .open')
    page.click('[data-open="Handoff from 194"]')
    page.wait_for_function("document.querySelector('#projName').value === 'Handoff from 194'", timeout=10000)
    page.wait_for_function("document.querySelectorAll('#schemaBody .trow').length === 3", timeout=10000)
    run(page, 'SELECT zip FROM excel_bom_customers LIMIT 1')
    page.wait_for_selector('#resultBody table.grid')
    z = page.text_content('#resultBody tbody td:nth-child(2)')
    ok('a project built in the 194 page opens from the 195 open sheet', z.startswith('0'), z)

    # wider layout
    page.set_viewport_size({'width': 1100, 'height': 800})
    page.wait_for_timeout(300)
    ok('two columns at 720px and wider', page.is_visible('#schema') and not page.is_visible('#btnTables'))
    page.screenshot(path=SHOT + '09-desktop.png')

    small = [x for x in page.evaluate("""() => [...document.querySelectorAll('button, input, textarea')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44 && e.type !== 'file').map(e => e.id || e.className || e.textContent)""")]
    ok('all visible targets at least 44px tall', not small, small[:8])
    ok('no page errors', not errs, errs[:5])
    b.close()

failed = [n for n, c in results if not c]
print('\n%d of %d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
