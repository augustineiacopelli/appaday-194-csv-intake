# End to end check of CSV Intake in Chromium at 375px. Serve the folder that holds this repo and the appaday portal clone side by side:
#   cd .. && python3 -m http.server 8194   then   python3 appaday-194-csv-intake/test/e2e_csv_intake.py
# Paths below assume both clones sit in /home/claude; edit FX and SHOT to match your layout.
import json, sqlite3, sys, os
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:' + os.environ.get('CI_PORT', '8194') + '/appaday-194-csv-intake/'
FX = '/home/claude/appaday-194-csv-intake/fixtures/'
SHOT = '/home/claude/shots/'
os.makedirs(SHOT, exist_ok=True)
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
results = []
def ok(name, cond, extra=''):
    results.append((name, bool(cond), extra)); print(('PASS ' if cond else 'FAIL ') + name + ('  ' + str(extra) if extra else ''))

def types(page):
    return page.evaluate("""() => { const o = {}; document.querySelectorAll('.card').forEach(c => {
      const t = c.getAttribute('data-table'); o[t] = {}; c.querySelectorAll('select.chip').forEach(s => o[t][s.getAttribute('data-col')] = s.value); }); return o; }""")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, user_agent=UA, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'TUNNEL' not in m.text else None)
    page.goto(URL)
    page.wait_for_function("document.querySelector('#saveState .txt').textContent !== 'Loading engine' && document.querySelector('#saveState .txt').textContent !== 'Starting'", timeout=20000)
    ok('engine boots from portal vendor folder', page.is_visible('#empty'))
    ok('empty state leads with Load sample data', page.evaluate("document.querySelector('#empty .cta .btn').id") == 'btnSample')
    page.screenshot(path=SHOT + '01-empty.png', full_page=True)
    nowrap = page.evaluate("document.documentElement.scrollWidth <= 375")
    ok('no sideways scroll at 375px (empty)', nowrap)

    # sample data
    page.click('#btnSample')
    page.wait_for_function("document.querySelectorAll('.card').length === 10", timeout=30000)
    ok('sample data loads 10 tables', True)
    page.wait_for_function("document.querySelector('#saveState').classList.contains('saved')", timeout=10000)
    page.screenshot(path=SHOT + '02-sample.png')
    t = types(page)
    ok('sample students types', t.get('students', {}).get('student_id') == 'integer', t.get('students'))

    # new project with three CSVs
    page.click('#btnOpen'); page.click('#btnNew')
    page.wait_for_selector('#empty:not(.hidden)')
    page.set_input_files('#fileCsv', [FX + 'excel_bom_customers.csv', FX + 'semicolon_orders_dayfirst.csv', FX + 'plain_mixed_types.csv'])
    page.wait_for_function("document.querySelectorAll('.card').length === 3", timeout=20000)
    t = types(page)
    print(json.dumps(t, indent=1))
    c = t['excel_bom_customers']; o = t['semicolon_orders_dayfirst']; m = t['plain_mixed_types']
    ok('BOM file: header clean, id integer', c.get('customer_id') == 'integer')
    ok('BOM file: ZIP kept as text', c.get('zip') == 'text')
    ok('BOM file: dates, money, booleans', c.get('signup_date') == 'date' and c.get('balance') == 'real' and c.get('active') == 'boolean')
    ok('semicolon file: day first dates', o.get('order_date') == 'date' and o.get('qty') == 'integer' and o.get('unit_price') == 'real')
    ok('plain file: int, real, bool, datetime', m.get('id') == 'integer' and m.get('score') == 'real' and m.get('passed') == 'boolean' and m.get('recorded_at') == 'datetime')
    ok('plain file: rating near miss stays text', m.get('rating') == 'text')
    zipcell = page.evaluate("[...document.querySelectorAll('[data-table=excel_bom_customers] tbody tr')][0].children[3].textContent")
    ok('ZIP preview keeps leading zero', zipcell.startswith('0'), zipcell)
    meta = page.text_content('[data-table=excel_bom_customers] .card-meta')
    ok('BOM reported', 'byte order mark' in meta, meta)
    od = page.evaluate("[...document.querySelectorAll('[data-table=semicolon_orders_dayfirst] tbody tr')][0].children[2].textContent")
    ok('23/10/2026 read as 2026-10-23', od == '2026-10-23', od)
    flags = page.text_content('[data-table=semicolon_orders_dayfirst] .flags')
    ok('bad row flagged', '1 bad row' in flags, flags)
    page.screenshot(path=SHOT + '03-three.png')
    page.locator('[data-table=semicolon_orders_dayfirst]').screenshot(path=SHOT + '04-semicolon-card.png')

    # day first switch on the ambiguous delivery date
    dd_before = page.evaluate("[...document.querySelectorAll('[data-table=semicolon_orders_dayfirst] tbody tr')][0].children[3].textContent")
    sw = page.locator('[data-table=semicolon_orders_dayfirst] [data-order-t=dmy]')
    ok('day first switch offered for ambiguous column', sw.count() == 1)
    if sw.count():
        sw.click()
        dd_after = page.evaluate("[...document.querySelectorAll('[data-table=semicolon_orders_dayfirst] tbody tr')][0].children[3].textContent")
        ok('day first switch rereads dates', dd_before != dd_after and dd_after == '2026-11-05', (dd_before, dd_after))

    # coerce
    btn = page.locator('[data-table=plain_mixed_types] [data-coerce=rating]')
    ok('Coerce offered for rating', btn.count() == 1, btn.first.text_content() if btn.count() else '')
    if btn.count():
        btn.click()
        ok('rating coerced to integer', types(page)['plain_mixed_types']['rating'] == 'integer')
        ok('coerced misfits flagged as bad cells', '2 bad cells' in page.text_content('[data-table=plain_mixed_types] .flags'))
    page.locator('[data-table=plain_mixed_types]').screenshot(path=SHOT + '05-plain-card.png')

    # change a chip by hand
    page.select_option('[data-table=excel_bom_customers] select[data-col=customer_id]', 'text')
    ok('chip change reloads with types', types(page)['excel_bom_customers']['customer_id'] == 'text')
    page.select_option('[data-table=excel_bom_customers] select[data-col=customer_id]', 'integer')

    # rename table
    page.fill('[data-rename=excel_bom_customers]', 'customers')
    page.press('[data-rename=excel_bom_customers]', 'Enter')
    page.wait_for_selector('[data-table=customers]')
    ok('table rename', 'customers' in types(page))

    # project name
    page.fill('#projName', 'Day 194 check')
    page.press('#projName', 'Enter')
    page.wait_for_function("document.querySelector('#saveState').classList.contains('saved')", timeout=10000)
    page.wait_for_timeout(2500)

    # download
    with page.expect_download() as dl:
        page.click('#btnDownload')
    path = SHOT + 'download.sqlite'
    dl.value.save_as(path)
    con = sqlite3.connect(path)
    tabs = [r[0] for r in con.execute("select name from sqlite_master where type='table' order by name")]
    ok('download reopens in sqlite3', set(['customers', 'semicolon_orders_dayfirst', 'plain_mixed_types']) <= set(tabs), tabs)
    zs = con.execute('select zip, typeof(zip) from customers limit 1').fetchone()
    ok('ZIP stored as text', zs[1] == 'text' and zs[0].startswith('0'), zs)
    ok('meta last_app 194', con.execute("select value from _qd_meta where key='last_app'").fetchone()[0] == '194')
    ok('_qd_columns rows', con.execute("select count(*) from _qd_columns").fetchone()[0] >= 17)
    ok('dl filename', dl.value.suggested_filename == 'day-194-check.sqlite', dl.value.suggested_filename)
    con.close()

    # reload: project in open sheet and reopened
    page.reload()
    page.wait_for_selector('.card', timeout=20000)
    ok('last project reopens after reload', page.input_value('#projName') == 'Day 194 check' and page.locator('.card').count() == 3)
    page.click('#btnOpen')
    page.wait_for_selector('#openList .open')
    names = page.evaluate("[...document.querySelectorAll('#openList .open b')].map(b => b.textContent)")
    ok('project listed in open sheet', 'Day 194 check' in names and any(n.startswith('Prairie Ridge sample') for n in names), names)
    page.screenshot(path=SHOT + '06-open-sheet.png')
    page.click('[data-close=openScrim]')

    # oversize refused
    page.set_input_files('#fileCsv', FX + 'oversize_phone.csv')
    page.wait_for_selector('.notice.refuse')
    msg = page.text_content('.notice.refuse')
    ok('oversize refused with clear message', 'limit on this phone is 15.0 MB' in msg, msg)
    page.screenshot(path=SHOT + '07-refused.png')

    # settings
    page.click('#btnGear')
    page.wait_for_selector('#setScrim:not(.hidden)')
    lim = page.text_content('#limitsTable')
    ok('settings shows limits', '10.0 MB' in lim and '15.0 MB' in lim and '40.0 MB' in lim and '80.0 MB' in lim, lim)
    page.click('[data-order=dmy]')
    ok('default date order saved', page.evaluate("localStorage.getItem('csvintake-dateorder')") == 'dmy')
    page.screenshot(path=SHOT + '08-settings.png')
    page.click('[data-order=mdy]')
    page.click('[data-close=setScrim]')

    # open the downloaded file
    page.click('#btnOpen')
    page.set_input_files('#fileDb', path)
    page.wait_for_function("document.querySelector('#projName').value.startsWith('download')", timeout=10000)
    ok('downloaded .sqlite opens by file', page.locator('.card').count() == 3)

    ok('no sideways page scroll at 375px', page.evaluate("document.documentElement.scrollWidth <= 375"), page.evaluate("document.documentElement.scrollWidth"))
    small = page.evaluate("""() => [...document.querySelectorAll('button, select, input.tname, input.proj-name')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.outerHTML.slice(0, 80))""")
    ok('touch targets at least 44px', not small, small[:5])
    ok('no page errors', not errs, errs[:5])

    # desktop pass: warn tier for the big file
    d = b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    dp = d.new_page()
    dp.goto(URL)
    dp.wait_for_selector('#btnSample:visible, .card', timeout=20000)
    dp.screenshot(path=SHOT + '09-desktop.png')
    dp.set_input_files('#fileCsv', FX + 'oversize_phone.csv')
    dp.wait_for_selector('.card[data-table=oversize_phone]', timeout=60000)
    ok('desktop loads the 15 MB file under its 40 MB warning', True, dp.text_content('[data-table=oversize_phone] .card-meta'))
    b.close()

fails = [r for r in results if not r[1]]
print('\n%d checks, %d failed' % (len(results), len(fails)))
sys.exit(1 if fails else 0)
