# End to end check of Query Desk (AppADay 200). Chromium with the iPhone user agent at 375 by 812, a wide pass at
# 1280 by 800, and the size check at iPhone 13 dimensions. Serve the parent folder that holds this repo, the
# appaday-200-query-desk repo and the appaday portal clone side by side:
#   cd .. && python3 -m http.server 8199   then   python3 appaday-194-csv-intake/test/e2e_query_desk.py
# Only same origin requests are served. Chart.js comes from node_modules, keys.js and models.js from the portal
# clone, a fake key sits in localStorage, and api.anthropic.com answers with canned replies keyed to the question.
# Fonts and save.js are blocked, so the run is offline. Console errors fail the run, and the page must never
# scroll sideways. Set QD_BROWSER=webkit to run the same script in WebKit where it is installed.
import json, os, random, re, sqlite3, sys, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
FIX = os.path.join(ROOT, 'fixtures')
PORT = os.environ.get('QD_PORT', '8199')
BASE = 'http://127.0.0.1:' + PORT + '/'
URL = BASE + os.environ.get('QD_PATH', 'appaday-200-query-desk/')
PORTAL = os.environ.get('QD_PORTAL', os.path.normpath(os.path.join(ROOT, '..', 'appaday')))
SHOT = os.environ.get('QD_SHOTS', '/tmp/shots200/')
CHARTJS = os.path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')
CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js'
BROWSER = os.environ.get('QD_BROWSER', 'chromium')
os.makedirs(SHOT, exist_ok=True)
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
DESK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
QD200 = [os.path.join(FIX, 'qd200_' + t + '.csv') for t in ('campuses', 'rooms', 'work_orders')]
EXPECT_REL = sorted(['qd200_rooms(campus_id)->qd200_campuses(campus_id)', 'qd200_work_orders(campus_id)->qd200_campuses(campus_id)',
                     'qd200_work_orders(room_id)->qd200_rooms(room_id)'])
PER_CAMPUS = ('SELECT c.name AS campus, count(*) AS work_orders FROM qd200_work_orders w '
              'JOIN qd200_campuses c ON c.campus_id = w.campus_id GROUP BY c.name')
Q_ASK = 'How many work orders does each campus have?'
ASK_SQL = PER_CAMPUS + ' ORDER BY work_orders DESC'
REPLIES = {Q_ASK: json.dumps({'sql': ASK_SQL, 'explanation': 'Counts work orders for each campus through the campus id on each work order.',
                              'assumptions': ['Every work order counts, open or closed.'], 'cannot': None})}
results, errors, api_calls = [], [], []


def ok(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + ('  ' + str(extra) if extra and not cond else ''))
    return bool(cond)


def route_all(route):
    url = route.request.url
    if url.startswith(BASE):
        return route.continue_()
    if url.split('?')[0] == CDN:
        with open(CHARTJS, 'rb') as f:
            return route.fulfill(status=200, content_type='text/javascript', body=f.read())
    for name in ('models.js', 'keys.js'):
        if url.split('?')[0] == 'https://augustineiacopelli.github.io/appaday/' + name:
            with open(os.path.join(PORTAL, name), 'rb') as f:
                return route.fulfill(status=200, content_type='text/javascript', body=f.read())
    if url.startswith('https://api.anthropic.com/v1/messages'):
        body = json.loads(route.request.post_data or '{}')
        api_calls.append(body)
        first = (body.get('messages') or [{}])[0].get('content', '')
        question = first.split('QUESTION\n', 1)[-1].strip()
        text = REPLIES.get(question) or json.dumps({'sql': None, 'explanation': '', 'assumptions': [], 'cannot': 'No canned reply.'})
        return route.fulfill(status=200, content_type='application/json',
                             body=json.dumps({'content': [{'type': 'text', 'text': text}], 'stop_reason': 'end_turn', 'model': 'test-model'}))
    return route.abort()


def watch(page):
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'net::ERR_FAILED' not in m.text and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))


def new_page(b, width=375, height=812, ua=UA, mobile=True, key=True):
    ctx = b.new_context(viewport={'width': width, 'height': height}, user_agent=ua, device_scale_factor=2,
                        is_mobile=mobile if BROWSER != 'firefox' else False, has_touch=mobile, accept_downloads=True)
    if key:
        ctx.add_init_script("try { localStorage.setItem('appaday.key.200', 'sk-ant-fake-key-for-the-test-0000000000MQAA'); } catch (e) {}")
    ctx.route('**/*', route_all)
    page = ctx.new_page()
    watch(page)
    return ctx, page


def booted(page):
    page.wait_for_function('window.QDesk && QDesk.state.booted', timeout=30000)


def sideways_ok(page):
    return page.evaluate('document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth')


side = []
def step(page, label):
    good = sideways_ok(page)
    side.append((label, good))
    if not good:
        print('SIDEWAYS after ' + label)


def tab(page, name):
    page.click('#tabbar [data-go="' + name + '"]')
    page.wait_for_function('t => QDesk.state.tab === t', arg=name, timeout=10000)
    page.wait_for_timeout(150)


def ev(page, js, arg=None):
    return page.evaluate(js, arg) if arg is not None else page.evaluate(js)


def rel_keys(page, status):
    return sorted(ev(page, "s => QDesk.state.p.relations(s).map(r => r.fromTable + '(' + r.fromColumns.join(',') + ')->' + r.toTable + '(' + r.toColumns.join(',') + ')')", status))


def end_tour(page):
    if page.is_visible('#tourCard'):
        page.click('#tourSkip')


def choose_csvs(page, files, via='#fCsv'):
    with page.expect_file_chooser() as fc:
        page.click(via)
    fc.value.set_files(files)


def export_report(page):
    with page.expect_download() as d:
        page.click('.t-report [data-t="btnExport"]')
    path = d.value.path()
    with open(path, 'r', encoding='utf-8') as f:
        return d.value.suggested_filename, f.read()


def full_flow(b):
    """Starting from the three qd200 CSV files, reach an exported report without leaving the tab."""
    ctx, page = new_page(b)
    page.goto(URL)
    booted(page)
    ok('flow: first run screen appears', page.is_visible('#first'))
    step(page, 'first run')
    page.screenshot(path=SHOT + '01-first.png')

    choose_csvs(page, QD200)
    page.wait_for_function('QDesk.state.p && QDesk.state.p.userTables().length === 3', timeout=20000)
    page.wait_for_function("document.querySelectorAll('.t-load .card').length === 3", timeout=10000)
    ok('flow: first run is dismissed and remembered', not page.is_visible('#first') and ev(page, "localStorage.getItem('querydesk-welcomed')") == '1')
    counts = ev(page, "(() => { const p = QDesk.state.p, o = {}; p.userTables().forEach(t => o[t] = p.scalar('SELECT count(*) FROM \"' + t + '\"')); return o; })()")
    ok('flow: three cards with 4, 24 and 240 rows', counts == {'qd200_campuses': 4, 'qd200_rooms': 24, 'qd200_work_orders': 240}, counts)
    types = ev(page, "(() => { const o = {}; QDesk.state.p.schema().forEach(t => t.columns.forEach(c => o[t.name + '.' + c.name] = c.inferredType || c.type)); return o; })()")
    ok('flow: dates typed as date, ids as integer, cost as real',
       types.get('qd200_work_orders.opened_on') == 'date' and types.get('qd200_work_orders.closed_on') == 'date' and
       types.get('qd200_campuses.campus_id') == 'integer' and types.get('qd200_work_orders.cost') == 'real', types)
    ok('flow: delimiters read as comma, semicolon and comma', ev(page, "(() => { const s = QDesk.state.tabs.load.state.sources; return [s.qd200_campuses.delimiter, s.qd200_rooms.delimiter, s.qd200_work_orders.delimiter, s.qd200_campuses.bom]; })()") == [',', ';', ',', True])
    ok('flow: the project is named after the first file', ev(page, 'QDesk.state.p.name').lower().startswith('qd200 campuses'))
    ok('flow: the Relate banner appears', page.is_visible('.t-load [data-t="relateBanner"]'))
    step(page, 'load')
    page.screenshot(path=SHOT + '02-load.png')

    page.click('.t-load [data-t="btnRelate"]')
    page.wait_for_function("QDesk.state.tab === 'relate' && QDesk.state.p.relations().length > 0", timeout=20000)
    page.wait_for_function("!document.querySelector('.t-relate [data-t=\"finder\"]').classList.contains('hidden')", timeout=10000)
    drawn = sorted(ev(page, "QDesk.state.p.relations('proposed').filter(r => r.evidence && ['strong', 'likely'].includes(r.evidence.label)).map(r => r.fromTable + '(' + r.fromColumns.join(',') + ')->' + r.toTable + '(' + r.toColumns.join(',') + ')')"))
    ok('flow: Analyze proposes the three known relationships', drawn == EXPECT_REL, drawn)
    ok('flow: and no others', ev(page, 'QDesk.state.p.relations().length') == 3)
    step(page, 'relate')
    page.click('.t-relate [data-t="btnConfirmStrong"]')
    page.wait_for_timeout(200)
    ok('flow: Confirm all strong confirms the strong one', len(rel_keys(page, 'confirmed')) >= 1)
    for _ in range(4):
        btn = page.query_selector('.t-relate [data-decide$=":confirmed"]')
        if not btn:
            break
        btn.click()
        page.wait_for_timeout(150)
    ok('flow: all three relationships confirmed', rel_keys(page, 'confirmed') == EXPECT_REL, rel_keys(page, 'confirmed'))
    page.click('.t-relate .viewseg [data-view="diagram"]')
    page.wait_for_timeout(200)
    solid = ev(page, "document.querySelectorAll('.t-relate svg path.edge.confirmed').length")
    dashed = ev(page, "document.querySelectorAll('.t-relate svg path.edge.proposed').length")
    ok('flow: the diagram draws three solid lines', solid == 3 and dashed == 0, (solid, dashed))
    page.screenshot(path=SHOT + '03-diagram.png')
    step(page, 'diagram')
    page.click('.t-relate g.box[data-tbl="qd200_work_orders"] rect.bx')
    page.wait_for_timeout(120)
    page.click('.t-relate g.box[data-tbl="qd200_campuses"] rect.bx')
    page.wait_for_selector('.t-relate.join-open [data-t="btnOpenQuery"]', timeout=5000)
    ok('flow: tapping two tables gives a JOIN', 'JOIN' in (page.text_content('.t-relate [data-t="joinSql"]') or ''))
    step(page, 'join')
    page.click('.t-relate [data-t="btnOpenQuery"]')
    page.wait_for_function("QDesk.state.tab === 'query' && QDesk.state.tabs.query.state.result", timeout=10000)
    n = ev(page, 'QDesk.state.tabs.query.state.result.res && QDesk.state.tabs.query.state.result.res.rowCount')
    ok('flow: the JOIN opens in Query and returns 240 rows', n == 240, n)
    ok('flow: the hash follows the tab', page.url.endswith('#query'))
    step(page, 'query')

    page.fill('.t-query [data-t="editor"]', PER_CAMPUS)
    page.click('.t-query [data-t="btnRun"]')
    page.wait_for_function("QDesk.state.tabs.query.state.result.res && QDesk.state.tabs.query.state.result.res.rowCount === 4", timeout=5000)
    page.click('.t-query [data-t="btnChart"]')
    page.wait_for_function("QDesk.state.tab === 'chart' && QDesk.state.tabs.chart.chart.spec", timeout=10000)
    page.wait_for_selector('.t-chart [data-t="chartArea"] canvas', timeout=10000)
    ok('flow: Chart this on a per campus count gives a bar chart', ev(page, 'QDesk.state.tabs.chart.chart.spec.type') == 'bar')
    page.screenshot(path=SHOT + '04-chart.png')
    step(page, 'chart')
    page.click('.t-chart [data-t="btnPin"]')
    page.wait_for_selector('.t-chart [data-t="saveScrim"]:not(.hidden)', timeout=5000)
    page.fill('.t-chart [data-t="qName"]', 'Work orders per campus')
    page.click('.t-chart [data-t="btnSaveGo"]')
    page.wait_for_function('QDesk.state.p.charts().length === 1', timeout=5000)
    ok('flow: Pin saves the query and pins the chart', ev(page, "QDesk.state.p.queries().some(q => q.name === 'Work orders per campus')"))
    page.click('.t-chart [data-t="btnReport"]')
    page.wait_for_function('QDesk.state.p.blocks().length === 1', timeout=5000)
    ok('flow: Add to report from the chart adds a chart block', ev(page, 'QDesk.state.p.blocks()[0].kind') == 'chart')

    tab(page, 'report')
    page.wait_for_selector('.t-report .rchart canvas', timeout=10000)
    ok('flow: the report draws the chart live', True)
    page.click('.t-report [data-t="btnNote"]')
    page.fill('.t-report textarea[data-note="draft"]', 'Riverbend carries the most work.\n\nCheck again after the spring term.')
    page.click('.t-report [data-t="dateLine"]')
    page.wait_for_function('QDesk.state.p.blocks().length === 2', timeout=5000)
    ok('flow: Add note saves a text block', ev(page, 'QDesk.state.p.blocks()[1].kind') == 'text')
    page.click('.t-report [data-t="btnAddQuery"]')
    page.wait_for_selector('.t-report [data-t="pickScrim"]:not(.hidden) [data-pickid]', timeout=5000)
    page.click('.t-report [data-t="pickScrim"] [data-pickid]')
    page.wait_for_function('QDesk.state.p.blocks().length === 3', timeout=5000)
    ok('flow: Add saved query adds a query block with its rows', ev(page, 'QDesk.state.p.blocks()[2].kind') == 'query' and page.is_visible('.t-report .rblock.k-query table.grid'))
    page.click('.t-report [data-up="2"]')
    page.wait_for_timeout(200)
    order = ev(page, 'QDesk.state.p.blocks().map(b => b.kind)')
    ok('flow: Move up reorders the blocks', order == ['chart', 'query', 'text'], order)
    page.fill('.t-report [data-t="title"]', 'Campus work order review')
    page.press('.t-report [data-t="title"]', 'Enter')
    page.wait_for_timeout(100)
    page.screenshot(path=SHOT + '05-report.png', full_page=False)
    step(page, 'report')
    name, html = export_report(page)
    ok('flow: Export downloads one HTML file named for the project', re.match(r'^qd200-campuses.*-report-\d{4}-\d{2}-\d{2}\.html$', name) is not None, name)
    ok('flow: the export holds the title', '<h1>Campus work order review</h1>' in html)
    ok('flow: the export holds the note text', 'Riverbend carries the most work.' in html and 'Check again after the spring term.' in html)
    ok('flow: the export holds a table', '<table>' in html and '<th>campus</th>' in html)
    ok('flow: the export holds one PNG chart', html.count('data:image/png') == 1)
    ok('flow: the export holds no script', '<script' not in html.lower())
    ok('flow: the only http reference is the footer link', html.count('http') == 1 and 'href="https://augustineiacopelli.github.io/appaday-200-query-desk/"' in html, html.count('http'))
    ok('flow: the export prints cleanly', '@page{margin:16mm}' in html and 'break-inside:avoid' in html and 'thead{display:table-header-group}' in html)
    with open(SHOT + 'report.html', 'w', encoding='utf-8') as f:
        f.write(html)
    page.click('.t-report [data-t="btnPreview"]')
    page.wait_for_selector('.t-report [data-t="prevScrim"]:not(.hidden)', timeout=5000)
    srcdoc = page.get_attribute('.t-report [data-t="prevFrame"]', 'srcdoc') or ''
    ok('flow: Preview shows the same file in a sandboxed frame', page.get_attribute('.t-report [data-t="prevFrame"]', 'sandbox') == '' and '<h1>Campus work order review</h1>' in srcdoc)
    page.keyboard.press('Escape')
    return ctx, page


def ask_links(page):
    tab(page, 'ask')
    page.wait_for_selector('.t-ask [data-pa="q"]', timeout=10000)
    ok('links: the Ask line counts the confirmed relationships', '3 confirmed relationships' in (page.text_content('.t-ask [data-t="links"]') or ''))
    page.fill('.t-ask [data-pa="q"]', Q_ASK)
    page.click('.t-ask [data-pa="send"] > summary')
    page.wait_for_timeout(500)
    sent = page.text_content('.t-ask [data-pa="sendbox"]') or ''
    ok('links: What will be sent includes the three confirmed relationships', 'RELATIONSHIPS' in sent and all(r.replace('->', ' -> ') in sent for r in EXPECT_REL), sent[-300:])
    ok('links: and three sample rows per table', sent.count('sample rows:') == 3)
    step(page, 'ask')
    before = ev(page, 'QDesk.state.p.queries().length')
    page.click('.t-ask [data-pa="ask"]')
    page.wait_for_selector('.t-ask [data-pa-action="save"]', timeout=10000)
    ok('links: the mocked Claude returns SQL that runs', ev(page, "PlainAsk.state.answer && PlainAsk.state.answer.a && PlainAsk.state.answer.a.status") == 'ok')
    ok('links: the request carried the confirmed relationships', api_calls and 'RELATIONSHIPS' in api_calls[-1]['messages'][0]['content'])
    page.screenshot(path=SHOT + '06-ask.png')
    page.click('.t-ask [data-pa-action="save"]')
    page.wait_for_timeout(150)
    saved = ev(page, "QDesk.state.p.queries().filter(q => q.origin === 'ask' && q.question === '" + Q_ASK + "').length")
    ok('links: Save stores the answer with origin ask and the question', saved == 1 and ev(page, 'QDesk.state.p.queries().length') == before + 1)
    page.click('.t-ask [data-pa-action="chart"]')
    page.wait_for_function("QDesk.state.tab === 'chart'", timeout=5000)
    ok('links: Chart this lands in Chart with the SQL intact', page.input_value('.t-chart [data-t="srcSql"]') == ASK_SQL)
    ok('links: and keeps the saved query', ev(page, 'QDesk.state.tabs.chart.chart.queryId') is not None)
    tab(page, 'ask')
    page.click('.t-ask [data-pa-action="bench"]')
    page.wait_for_function("QDesk.state.tab === 'query'", timeout=5000)
    ok('links: Open in Query lands in Query with the SQL intact and run', page.input_value('.t-query [data-t="editor"]') == ASK_SQL and ev(page, 'QDesk.state.tabs.query.state.result.res.rowCount') == 4)
    tab(page, 'ask')
    nb = ev(page, 'QDesk.state.p.blocks().length')
    page.click('.t-ask [data-pa-action="report"]')
    page.wait_for_function('n => QDesk.state.p.blocks().length === n + 1', arg=nb, timeout=5000)
    last = ev(page, 'QDesk.state.p.blocks().slice(-1)[0]')
    q = ev(page, 'id => QDesk.state.p.getQuery(id)', last['refId'])
    ok('links: Add to report adds the saved answer without saving it twice', last['kind'] == 'query' and q['question'] == Q_ASK and ev(page, 'QDesk.state.p.queries().length') == before + 1)
    page.click('#btnGear')
    page.click('#segSamples [data-samples="0"]')
    page.click('#setScrim [data-close="setScrim"]')
    tab(page, 'load')
    tab(page, 'ask')
    page.wait_for_timeout(500)
    sent0 = page.text_content('.t-ask [data-pa="sendbox"]') or ''
    ok('links: with sample rows set to none nothing but names is sent', 'sample rows:' not in sent0 and 'RELATIONSHIPS' in sent0 and '"Riverbend"' not in sent0)
    page.click('#btnGear')
    page.click('#segSamples [data-samples="3"]')
    page.click('#setScrim [data-close="setScrim"]')


def guards(page):
    tab(page, 'query')
    tables = ev(page, 'QDesk.state.p.userTables().slice().sort()')
    page.fill('.t-query [data-t="editor"]', 'DROP TABLE qd200_rooms')
    page.click('.t-query [data-t="btnRun"]')
    page.wait_for_timeout(150)
    ok('guards: DROP TABLE with changes off is refused', ev(page, 'QDesk.state.tabs.query.state.result.kind') == 'guard')
    ok('guards: every table survives', ev(page, 'QDesk.state.p.userTables().slice().sort()') == tables)
    page.click('.t-query [data-allow]')
    page.wait_for_selector('#chgScrim:not(.hidden)', timeout=5000)
    page.click('#btnChangesOk')
    page.wait_for_function('QDesk.state.changes === true', timeout=5000)
    ok('guards: the changes bar shows in Query', page.is_visible('.t-query [data-t="changesBar"]'))
    page.fill('.t-query [data-t="editor"]', 'DELETE FROM qd200_work_orders WHERE work_order_id = 240')
    page.click('.t-query [data-t="btnRun"]')
    page.wait_for_timeout(150)
    ok('guards: Allow changes then DELETE works', ev(page, 'QDesk.state.tabs.query.state.result.kind') == 'done' and ev(page, "QDesk.state.p.scalar('SELECT count(*) FROM qd200_work_orders')") == 239)
    nb = ev(page, "QDesk.state.p.scalar('SELECT count(*) FROM _qd_notebook')")
    page.fill('.t-query [data-t="editor"]', "INSERT INTO _qd_notebook (position, kind, body) VALUES (9, 'text', 'sneaky')")
    page.click('.t-query [data-t="btnRun"]')
    page.wait_for_timeout(150)
    ok('guards: writing _qd_notebook through Query with changes on is refused',
       ev(page, 'QDesk.state.tabs.query.state.result.kind') in ('guard', 'error') and ev(page, "QDesk.state.p.scalar('SELECT count(*) FROM _qd_notebook')") == nb)
    page.click('.t-query [data-t="btnChangesOff"]')
    ok('guards: Turn off returns Query to read only', ev(page, 'QDesk.state.changes') is False)
    step(page, 'guards')


def learn(page):
    shell_name = ev(page, 'QDesk.state.p.name')
    tab(page, 'learn')
    page.wait_for_function('window.QueryClinic && QueryClinic.app && QueryClinic.app.state.p', timeout=20000)
    ev(page, 'QueryClinic.app.ready.then(() => true)')
    ok('learn: entering Learn mounts the course', page.is_visible('.t-learn .qc [data-qc="units"]'))
    ok('learn: the bar says progress saves on its own', page.input_value('#projName') == 'Course progress saves on its own' and page.is_disabled('#btnDownload'))
    step(page, 'learn')
    page.screenshot(path=SHOT + '07-learn.png')
    ev(page, "QueryClinic.app.open('1.1')")
    sol = ev(page, "QDClinic.EXERCISES.filter(e => e.id === '1.1')[0].solution")
    page.fill('.t-learn [data-qc="editor"]', sol)
    page.click('.t-learn [data-qc="btnCheck"]')
    page.wait_for_function("(QDClinic.progress(QueryClinic.app.project()).byId['1.1'] || {}).status === 'solved'", timeout=5000)
    ok('learn: solving exercise 1.1 records progress', True)
    ok('learn: the shell project is untouched', ev(page, 'QDesk.state.p.name') == shell_name)
    tab(page, 'load')
    page.wait_for_function('!QueryClinic.app', timeout=5000)
    ok('learn: leaving Learn unmounts the course', ev(page, "document.querySelector('.t-learn [data-t=\"host\"]').children.length") == 0)
    ok('learn: the bar returns to the shell project', page.input_value('#projName') == shell_name)
    page.click('#btnOpen')
    page.wait_for_selector('#openScrim:not(.hidden)')
    page.keyboard.press('Escape')
    page.wait_for_timeout(100)
    ok('learn: Escape after leaving Learn closes only the shell sheet', not page.is_visible('#openScrim') and ev(page, 'QDesk.state.tab') == 'load')
    tab(page, 'learn')
    page.wait_for_function('window.QueryClinic && QueryClinic.app && QueryClinic.app.state.p', timeout=20000)
    ev(page, 'QueryClinic.app.ready.then(() => true)')
    ok('learn: coming back shows 1.1 solved', ev(page, "QDClinic.progress(QueryClinic.app.project()).byId['1.1'].status") == 'solved')
    tab(page, 'load')
    page.wait_for_timeout(400)
    page.click('#btnOpen')
    page.wait_for_selector('#openList [data-open="Query Clinic"]', timeout=5000)
    ok('learn: the open sheet marks Query Clinic with a Learn badge', 'Learn' in (page.text_content('#openList [data-open="Query Clinic"]') or ''))
    page.click('#openList [data-open="Query Clinic"]')
    page.wait_for_function("QDesk.state.tab === 'learn' && window.QueryClinic.app", timeout=10000)
    ok('learn: the Query Clinic entry goes to Learn, not the shell', ev(page, 'QDesk.state.p.name') == shell_name)
    tab(page, 'report')


def persistence(page):
    tab(page, 'query')
    page.fill('.t-query [data-t="editor"]', 'SELECT name FROM qd200_campuses ORDER BY name')
    page.dispatch_event('.t-query [data-t="editor"]', 'input')
    tab(page, 'report')
    before = ev(page, "({ name: QDesk.state.p.name, blocks: QDesk.state.p.blocks().map(b => b.kind), charts: QDesk.state.p.charts().length, rel: QDesk.state.p.relations('confirmed').length })")
    ev(page, 'QDesk.ctx.saveNow().then(() => true)')
    page.reload()
    booted(page)
    page.wait_for_function('QDesk.state.p', timeout=10000)
    after = ev(page, "({ name: QDesk.state.p.name, blocks: QDesk.state.p.blocks().map(b => b.kind), charts: QDesk.state.p.charts().length, rel: QDesk.state.p.relations('confirmed').length })")
    ok('persistence: reload reopens the project with its report, charts and relationships', after == before, (before, after))
    ok('persistence: reload returns to the last tab', ev(page, 'QDesk.state.tab') == 'report')
    tab(page, 'query')
    ok('persistence: the query draft survives', page.input_value('.t-query [data-t="editor"]') == 'SELECT name FROM qd200_campuses ORDER BY name')
    page.go_back()
    page.wait_for_function("QDesk.state.tab === 'report'", timeout=5000)
    ok('persistence: the back button returns to the previous tab', True)


def compat(b):
    exp = json.load(open(os.path.join(FIX, 'compat', 'expected.json')))['apps']
    ctx, page = new_page(b)
    page.goto(URL)
    booted(page)
    page.click('#fOpen')
    page.wait_for_selector('#openScrim:not(.hidden)')

    def open_file(app):
        if not page.is_visible('#openScrim'):
            page.click('#btnOpen')
            page.wait_for_selector('#openScrim:not(.hidden)')
        with page.expect_file_chooser() as fc:
            page.click('#btnOpenFile')
        fc.value.set_files(os.path.join(FIX, 'compat', exp[app]['file']))
        page.wait_for_function('f => QDesk.state.p && QDesk.state.p.name.indexOf(f) === 0', arg=exp[app]['file'].replace('.sqlite', ''), timeout=10000)
        page.wait_for_timeout(200)

    open_file('194')
    got = ev(page, "(() => { const p = QDesk.state.p; return p.userTables().map(t => [t, p.scalar('SELECT count(*) FROM \"' + t + '\"')]); })()")
    ok('compat 194: tables and row counts read back', sorted(map(tuple, got)) == sorted((t['table'], t['rows']) for t in exp['194']['tables']), got)
    open_file('195')
    qs = ev(page, '({ names: QDesk.state.p.queries().map(q => q.name), pinned: QDesk.state.p.queries()[0].pinned, first: QDesk.state.p.queries()[0].name, hist: QDesk.state.p.history(50).length })')
    ok('compat 195: saved queries, the pinned one and history read back',
       sorted(qs['names']) == sorted(exp['195']['queries']) and qs['first'] == exp['195']['pinned'] and qs['pinned'] == 1 and qs['hist'] >= 3, qs)
    tab(page, 'query')
    page.click('.t-query [data-t="btnLib"]')
    page.click('.t-query [data-lib="saved"]')
    ok('compat 195: Query lists the saved queries', page.locator('.t-query [data-qload]').count() == 3)
    page.keyboard.press('Escape')
    open_file('196')
    ok('compat 196: confirmed and rejected relationships read back',
       rel_keys(page, 'confirmed') == exp['196']['confirmed'] and rel_keys(page, 'rejected') == exp['196']['rejected'])
    ok('compat 196: diagram positions read back', json.loads(ev(page, "QDesk.state.p.getMeta('diagram_positions')")) == exp['196']['positions'])
    tab(page, 'relate')
    page.wait_for_function("!document.querySelector('.t-relate [data-t=\"finder\"]').classList.contains('hidden')", timeout=10000)
    page.click('.t-relate .viewseg [data-view="diagram"]')
    page.wait_for_timeout(150)
    ok('compat 196: the diagram uses the saved positions', page.get_attribute('.t-relate g.box[data-tbl="campuses"]', 'transform') == 'translate(24 24)')
    page.click('.t-relate .viewseg [data-view="list"]')
    page.click('.t-relate [data-t="btnAnalyze"]')
    page.wait_for_timeout(1500)
    ok('compat 196: Analyze keeps the rejected relationship rejected', rel_keys(page, 'rejected') == exp['196']['rejected'] and rel_keys(page, 'confirmed') == exp['196']['confirmed'])
    open_file('197')
    asks = sorted(ev(page, "QDesk.state.p.queries().filter(q => q.origin === 'ask').map(q => q.question)"))
    ok('compat 197: ask queries keep origin and question', asks == sorted(exp['197']['ask']), asks)
    open_file('198')
    ok('compat 198: pinned charts keep board order', ev(page, 'QDesk.state.p.charts().map(c => c.spec.title)') == exp['198']['board'])
    tab(page, 'chart')
    page.click('.t-chart [data-t="tabBoard"]')
    page.wait_for_timeout(500)
    titles = ev(page, "[...document.querySelectorAll('.t-chart .bcard h3')].map(h => h.textContent)")
    ok('compat 198: the board draws them in order', titles == exp['198']['board'], titles)
    open_file('199')
    ok('compat 199: clinic progress reads back', ev(page, 'QDClinic.progress(QDesk.state.p).solved') == len(exp['199']['solved']))
    step(page, 'compat')
    ctx.close()


def load_types(b):
    ctx, page = new_page(b)
    page.goto(URL)
    booted(page)
    choose_csvs(page, [os.path.join(FIX, 'excel_bom_customers.csv')])
    page.wait_for_function('QDesk.state.p && QDesk.state.p.userTables().length === 1', timeout=15000)
    types = ev(page, "(() => { const o = {}; QDesk.state.p.schema().forEach(t => t.columns.forEach(c => o[c.name] = c.inferredType || c.type)); return o; })()")
    zips = ev(page, "QDesk.state.p.query('SELECT zip FROM excel_bom_customers WHERE zip LIKE \\'0%\\' LIMIT 1').rows")
    ok('types: ZIP codes stay text with their leading zeros', types.get('zip') == 'text' and zips and str(zips[0][0]).startswith('0'), (types.get('zip'), zips))
    ok('types: the signup date reads as a date', types.get('signup_date') == 'date', types)
    ctx.close()


def size_check(b):
    tmp = tempfile.mkdtemp()
    big = os.path.join(tmp, 'sensor_readings.csv')
    rnd = random.Random(200)
    with open(big, 'w') as f:
        f.write('reading_id,station,region,reading,taken_on\n')
        i = 0
        while f.tell() < 9 * 1024 * 1024:
            i += 1
            f.write('%d,S%03d,%s,%.3f,2026-%02d-%02d\n' % (i, i % 400, ('North', 'South', 'East', 'West', 'Central')[i % 5], rnd.random() * 1000, 1 + i % 12, 1 + i % 28))
    huge = os.path.join(tmp, 'too_big.csv')
    with open(huge, 'w') as f:
        f.write('a,b\n')
        line = '1234567890,abcdefghijklmnopqrstuvwxyz\n'
        f.write(line * ((16 * 1024 * 1024) // len(line) + 1))
    ctx, page = new_page(b, 390, 844)
    page.goto(URL)
    booted(page)
    ok('size: the phone limits apply', ev(page, 'QD.isPhone()') is True)
    choose_csvs(page, [big])
    page.wait_for_function('QDesk.state.p && QDesk.state.p.userTables().length === 1', timeout=120000)
    rows = ev(page, "QDesk.state.p.scalar('SELECT count(*) FROM sensor_readings')")
    ok('size: a 9 MB CSV loads on a phone', rows > 150000, rows)
    tab(page, 'query')
    page.fill('.t-query [data-t="editor"]', 'SELECT region, count(*) AS readings FROM sensor_readings GROUP BY region')
    page.click('.t-query [data-t="btnRun"]')
    page.wait_for_function('QDesk.state.tabs.query.state.result && QDesk.state.tabs.query.state.result.res && QDesk.state.tabs.query.state.result.res.rowCount === 5', timeout=30000)
    page.click('.t-query [data-t="btnChart"]')
    page.wait_for_function("QDesk.state.tab === 'chart'", timeout=10000)
    page.wait_for_selector('.t-chart [data-t="chartArea"] canvas', timeout=10000)
    page.click('.t-chart [data-t="btnReport"]')
    page.wait_for_selector('.t-chart [data-t="saveScrim"]:not(.hidden)', timeout=5000)
    page.fill('.t-chart [data-t="qName"]', 'Readings by region')
    page.click('.t-chart [data-t="btnSaveGo"]')
    page.wait_for_function('QDesk.state.p.blocks().length === 1', timeout=10000)
    tab(page, 'report')
    name, html = export_report(page)
    ok('size: the grouped query charts and exports', html.count('data:image/png') == 1 and 'Readings by region' in html)
    tab(page, 'load')
    page.set_input_files('.t-load [data-t="fileCsv"]', huge)
    page.wait_for_selector('.t-load .notice.refuse', timeout=10000)
    msg = page.text_content('.t-load .notice.refuse') or ''
    ok('size: a 16 MB file is refused with the plain message', 'The limit on this phone is' in msg and 'was not loaded' in msg, msg)
    step(page, 'size')
    ctx.close()


def wide(b):
    ctx, page = new_page(b, 1280, 800, DESK_UA, mobile=False)
    page.goto(URL)
    booted(page)
    ok('wide: first run screen appears', page.is_visible('#first'))
    choose_csvs(page, QD200)
    page.wait_for_function('QDesk.state.p && QDesk.state.p.userTables().length === 3', timeout=20000)
    bar = ev(page, "(() => { const t = document.getElementById('tabbar').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(), b = document.getElementById('bar').getBoundingClientRect(); return { tabTop: t.top, stageTop: s.top, barBottom: b.bottom, height: t.height }; })()")
    ok('wide: the tab row sits under the project bar instead of the bottom', bar['tabTop'] >= bar['barBottom'] - 1 and bar['tabTop'] < bar['stageTop'], bar)
    page.click('.t-load [data-t="btnRelate"]')
    page.wait_for_function("QDesk.state.tab === 'relate' && QDesk.state.p.relations().length === 3", timeout=20000)
    page.wait_for_function("!document.querySelector('.t-relate [data-t=\"finder\"]').classList.contains('hidden')", timeout=10000)
    page.click('.t-relate [data-t="btnConfirmStrong"]')
    for _ in range(4):
        btn = page.query_selector('.t-relate [data-decide$=":confirmed"]')
        if not btn:
            break
        btn.click()
        page.wait_for_timeout(150)
    ok('wide: three relationships confirmed', len(rel_keys(page, 'confirmed')) == 3)
    ok('wide: list and diagram show side by side', page.is_visible('.t-relate [data-t="paneDiag"]') and page.is_visible('.t-relate [data-t="paneLinks"]'))
    ok('wide: the diagram draws three solid lines', ev(page, "document.querySelectorAll('.t-relate svg path.edge.confirmed').length") == 3)
    page.click('.t-relate g.box[data-tbl="qd200_work_orders"] rect.bx')
    page.wait_for_timeout(120)
    page.click('.t-relate g.box[data-tbl="qd200_campuses"] rect.bx')
    page.wait_for_selector('.t-relate.join-open [data-t="btnOpenQuery"]', timeout=5000)
    page.click('.t-relate [data-t="btnOpenQuery"]')
    page.wait_for_function("QDesk.state.tab === 'query' && QDesk.state.tabs.query.state.result && QDesk.state.tabs.query.state.result.res", timeout=10000)
    ok('wide: the JOIN returns 240 rows', ev(page, 'QDesk.state.tabs.query.state.result.res.rowCount') == 240)
    page.screenshot(path=SHOT + '08-wide.png')
    step(page, 'wide')
    ctx.close()


def static_checks():
    path = os.path.join(ROOT, '..', 'appaday-200-query-desk', 'index.html')
    if not os.path.exists(path):
        path = os.path.join(ROOT, 'apps', '200', 'index.html')
    html = open(path, encoding='utf-8').read()
    head = html[:html.index('<style>')]
    ok('static: five icon tags and two Save to Phone tags, each once', all(head.count(t) == 1 for t in [
        'rel="apple-touch-icon" href="https://augustineiacopelli.github.io/appaday/icons/200.png"', 'name="apple-mobile-web-app-title" content="Query Desk"',
        'name="apple-mobile-web-app-capable"', 'name="mobile-web-app-capable"', 'name="apple-mobile-web-app-status-bar-style"',
        'rel="manifest" href="https://augustineiacopelli.github.io/appaday/manifests/200.webmanifest"', 'appaday/save.js" defer']))
    ok('static: one models.js tag and one keys.js tag for app 200', head.count('appaday/models.js') == 1 and head.count('keys.js" data-app="200" data-accent="#289664" defer') == 1)
    ok('static: no model ID anywhere', re.search(r'claude-(sonnet|opus|haiku|fable)-', html) is None)
    ok('static: ASCII only', all(ord(c) < 128 for c in html))


ONLY = os.environ.get('QD_ONLY', '')
with sync_playwright() as p:
    b = getattr(p, BROWSER).launch()
    static_checks()
    if not ONLY or ONLY == 'flow':
        ctx, page = full_flow(b)
        ask_links(page)
        guards(page)
        learn(page)
        persistence(page)
        ctx.close()
    if not ONLY or ONLY == 'compat':
        compat(b)
    if not ONLY or ONLY == 'types':
        load_types(b)
    if not ONLY or ONLY == 'size':
        size_check(b)
    if not ONLY or ONLY == 'wide':
        wide(b)
    b.close()

bad_side = [l for l, g in side if not g]
ok('no sideways scroll after any step (' + str(len(side)) + ' checked)', not bad_side, bad_side)
ok('no console errors', not errors, errors[:8])
failed = [n for n, c in results if not c]
print('\n%d of %d passed in %s' % (len(results) - len(failed), len(results), BROWSER))
sys.exit(1 if failed else 0)
