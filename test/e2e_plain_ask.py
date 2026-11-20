# End to end check of Plain Ask (AppADay 197) in Chromium at 375px, with the iPhone user agent.
# Serve the parent folder that holds this repo, the 195, 196 and 197 repos and the appaday portal clone side by side:
#   cd .. && python3 -m http.server 8197   then   python3 appaday-194-csv-intake/test/e2e_plain_ask.py
# No real key and no real model are used. models.js and keys.js are served from the local portal clone,
# the key is a fake one in localStorage, save.js is not loaded (its install banner is covered by the portal checks), and api.anthropic.com is intercepted with replies keyed to the question text.
import json, os, sys, time
from playwright.sync_api import sync_playwright

PORT = os.environ.get('PA_PORT', '8197')
BASE = 'http://127.0.0.1:' + PORT + '/'
URL = BASE + 'appaday-197-plain-ask/'
HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL = os.environ.get('PA_PORTAL', os.path.normpath(os.path.join(HERE, '..', '..', 'appaday')))
SHOT = os.environ.get('PA_SHOTS', '/home/claude/shots197/')
os.makedirs(SHOT, exist_ok=True)
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
PORTAL_FILES = {'models.js': 'text/javascript', 'keys.js': 'text/javascript'}
results = []
sideways = []

Q_OK = 'How many students are there?'
Q_REPAIR = 'Which students have the longest last names?'
Q_CANNOT = 'What will the weather be tomorrow?'
Q_DELETE = 'Delete every student record please'
Q_TOP = 'Who are the first three instructors?'
API_CALLS = []

def J(o):
    return json.dumps(o)

REPLIES = {
    Q_OK: [J({'sql': 'SELECT count(*) AS students FROM students', 'explanation': 'Counts every row in the students table.',
              'assumptions': ['Every row in students is one student.', 'Students with no enrollments are still counted.'], 'cannot': None})],
    Q_REPAIR: [J({'sql': 'SELECT last_name, length(surname) AS n FROM students ORDER BY n DESC LIMIT 5', 'explanation': 'Sorts by name length.', 'assumptions': [], 'cannot': None}),
               J({'sql': 'SELECT last_name, length(last_name) AS n FROM students ORDER BY n DESC, last_name LIMIT 5', 'explanation': 'Sorts students by how long their last name is and keeps five.',
                  'assumptions': ['Length is counted in characters.'], 'cannot': None})],
    Q_CANNOT: [J({'sql': None, 'explanation': '', 'assumptions': [], 'cannot': 'There is no weather data in these tables.'})],
    Q_DELETE: [J({'sql': 'DELETE FROM students', 'explanation': 'Removes every student.', 'assumptions': [], 'cannot': None}),
               J({'sql': 'DELETE FROM students WHERE 1 = 1', 'explanation': 'Removes every student.', 'assumptions': [], 'cannot': None})],
    Q_TOP: [J({'sql': 'SELECT instructor_id, first_name, last_name FROM instructors ORDER BY instructor_id LIMIT 3', 'explanation': 'Lists the first three instructors by id.',
               'assumptions': ['First means lowest id.'], 'cannot': None})],
}
EXPLAIN = J({'summary': 'This lists three instructors.', 'steps': ['Read the instructors table.', 'Sort by instructor_id.', 'Keep the first three rows.']})

def api_reply(body):
    system = body.get('system') or ''
    msgs = body.get('messages') or []
    if system.startswith('You explain SQLite queries'):
        return EXPLAIN
    first = msgs[0]['content'] if msgs else ''
    question = first.split('QUESTION\n', 1)[-1].strip()
    seq = REPLIES.get(question)
    if not seq:
        return J({'sql': None, 'explanation': '', 'assumptions': [], 'cannot': 'No canned reply for: ' + question})
    return seq[min((len(msgs) - 1) // 2, len(seq) - 1)]

def route_all(route):
    url = route.request.url
    if url.startswith(BASE):
        return route.continue_()
    for name, mime in PORTAL_FILES.items():
        if url.split('?')[0] == 'https://augustineiacopelli.github.io/appaday/' + name:
            with open(os.path.join(PORTAL, name), 'rb') as f:
                return route.fulfill(status=200, content_type=mime, body=f.read())
    if url.startswith('https://api.anthropic.com/v1/messages'):
        body = json.loads(route.request.post_data or '{}')
        API_CALLS.append(body)
        text = api_reply(body)
        first = (body.get('messages') or [{}])[0].get('content', '')
        if Q_OK in first and len(body.get('messages') or []) == 1 and not (body.get('system') or '').startswith('You explain'):
            route.request.frame.page.wait_for_timeout(1400)
        return route.fulfill(status=200, content_type='application/json',
                             body=json.dumps({'content': [{'type': 'text', 'text': text}], 'stop_reason': 'end_turn', 'model': 'test-model'}))
    return route.abort()

def ok(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + ('  ' + str(extra) if extra else ''))

def booted(page):
    page.wait_for_function("!['Loading engine', 'Starting'].includes(document.querySelector('#saveState .txt').textContent)", timeout=20000)

def no_sideways(page, label):
    good = page.evaluate("document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth")
    sideways.append((label, good))
    return good

def counts(page):
    return page.evaluate("(() => { const p = PlainAsk.state.project; const o = {}; p.userTables().forEach(t => { o[t] = p.scalar('SELECT count(*) FROM \"' + t + '\"'); }); return o; })()")

def ask(page, question):
    page.fill('[data-pa="q"]', question)
    page.click('[data-pa="ask"]')

def new_page(b, key):
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, user_agent=UA, device_scale_factor=2, is_mobile=True, has_touch=True)
    if key:
        ctx.add_init_script("try { localStorage.setItem('appaday.key.197', 'sk-ant-fake-key-for-the-test-0000000000MQAA'); } catch (e) {}")
    ctx.route('**/*', route_all)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'TUNNEL' not in m.text and 'ERR_FAILED' not in m.text and 'Failed to load resource' not in m.text else None)
    return ctx, page, errs

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, page, errs = new_page(b, True)

    # 1 empty state
    page.goto(URL); booted(page)
    ok('1 empty state leads with Load sample data', page.is_visible('#empty') and page.evaluate("document.querySelector('#empty .cta .btn').id") == 'btnSample'
       and page.text_content('#empty .cta .btn').strip() == 'Load sample data')
    no_sideways(page, 'empty')
    page.screenshot(path=SHOT + '01-empty.png')

    # 2 sample data gives four starter chips
    page.click('#btnSample')
    page.wait_for_selector('.chip', timeout=30000)
    chips = page.evaluate("[...document.querySelectorAll('[data-pa=\"starters\"] .chip')].map(c => c.textContent)")
    ok('2 sample data gives four distinct starter chips', len(chips) == 4 and len(set(chips)) == 4, chips)
    ok('2b the key line says a key is saved', 'key is saved' in page.text_content('[data-pa="key"]') and 'No Claude key' not in page.text_content('[data-pa="key"]'), page.text_content('[data-pa="key"]'))
    page.click('.chip >> nth=0')
    ok('2c tapping a chip fills the box and does not send', page.input_value('[data-pa="q"]') == chips[0] and len(API_CALLS) == 0 and page.locator('[data-pa="answer"] .pa-card').count() == 0)
    no_sideways(page, 'sample')
    page.screenshot(path=SHOT + '02-sample.png', full_page=True)

    # 3 disclosure equals buildMessage for both settings
    page.fill('[data-pa="q"]', Q_OK)
    ok('3a the disclosure is closed and the block is not built while closed', not page.evaluate("document.querySelector('[data-pa=\"send\"]').open") and page.evaluate("document.querySelector('[data-pa=\"sendbox\"]').textContent") == '')
    page.click('[data-pa="send"] summary')
    page.wait_for_timeout(450)
    want3 = page.evaluate("QDAsk.buildMessage(PlainAsk.state.project, %s, { sampleRows: 3 })" % json.dumps(Q_OK))
    got3 = page.evaluate("document.querySelector('[data-pa=\"sendbox\"]').textContent")
    rows3 = len([l for l in got3.split('\n') if l.startswith('    [')])
    ok('3b disclosure text equals buildMessage with three sample rows', got3 == want3 and rows3 == 30 and got3.endswith('QUESTION\n' + Q_OK), rows3)
    page.click('[data-pa-samples="0"]')
    page.wait_for_timeout(450)
    want0 = page.evaluate("QDAsk.buildMessage(PlainAsk.state.project, %s, { sampleRows: 0 })" % json.dumps(Q_OK))
    got0 = page.evaluate("document.querySelector('[data-pa=\"sendbox\"]').textContent")
    ok('3c disclosure text equals buildMessage with no sample rows', got0 == want0 and len([l for l in got0.split('\n') if l.startswith('    [')]) == 0 and got0 != got3)
    no_sideways(page, 'disclosure open')
    page.screenshot(path=SHOT + '03-disclosure.png', full_page=True)

    # 4 the switch survives a reload
    page.reload(); booted(page)
    page.wait_for_selector('.chip', timeout=30000)
    ok('4 the switch survives a reload', page.evaluate("localStorage.getItem('plainask-samples')") == '0'
       and page.get_attribute('[data-pa-samples="0"]', 'aria-pressed') == 'true' and page.evaluate("PlainAsk.state.sampleRows") == 0)
    page.click('[data-pa="send"] summary')
    page.click('[data-pa-samples="3"]')
    page.click('[data-pa="send"] summary')
    ok('4b switching back saves three', page.evaluate("localStorage.getItem('plainask-samples')") == '3')

    # 5 an ok answer
    start = len(API_CALLS)
    ask(page, Q_OK)
    page.wait_for_timeout(250)
    busy = page.evaluate("(() => { const b = document.querySelector('[data-pa=\"ask\"]'); return [b.disabled, b.textContent]; })()")
    ok('5a while asking the button is disabled and shows seconds', busy[0] and busy[1].startswith('Asking '), busy)
    page.wait_for_selector('.pa-card.ok', timeout=15000)
    page.wait_for_function("!document.querySelector('[data-pa=\"ask\"]').disabled")
    sent = API_CALLS[start]['messages'][0]['content']
    ok('5b the call carried the question and three sample rows', sent.endswith('QUESTION\n' + Q_OK) and len([l for l in sent.split('\n') if l.startswith('    [')]) == 30)
    ok('5c the card shows the explanation, the assumption list and the grid',
       'Counts every row' in page.text_content('.pa-expl') and page.locator('[data-pa="assume"] li').count() == 2
       and page.locator('table.grid').count() == 1 and page.text_content('table.grid tbody td.num') == '400', page.text_content('.pa-expl'))
    ok('5d the SQL block is collapsed and the action row is Save, Explain, Open in Query Bench',
       not page.evaluate("document.querySelector('[data-pa=\"sqlbox\"]').open")
       and page.evaluate("[...document.querySelectorAll('[data-pa=\"actions\"] button')].map(b => b.textContent)") == ['Save', 'Explain this query', 'Open in Query Bench'])
    ok('5e no Repaired note on a clean answer', page.locator('[data-pa="repaired"]').count() == 0)
    no_sideways(page, 'ok answer')
    page.screenshot(path=SHOT + '04-ok.png', full_page=True)

    # 10 save, 11 explain (on the ok card)
    page.click('[data-pa-action="save"]')
    page.wait_for_selector('#saveScrim:not(.hidden)')
    ok('10a the save sheet opens filled with the question and the explanation', page.input_value('#qName') == Q_OK and 'Counts every row' in page.input_value('#qNote'))
    no_sideways(page, 'save sheet')
    page.click('#btnSaveGo')
    saved = page.evaluate("(() => { const q = PlainAsk.state.project.queries(); return q.length ? q[0] : null; })()")
    ok('10b Save stores origin ask, the question and the explanation as the note',
       saved and saved['origin'] == 'ask' and saved['question'] == Q_OK and 'Counts every row' in (saved['note'] or '') and saved['sql'].startswith('SELECT count(*)'), saved)
    page.click('[data-pa-action="explain"]')
    page.wait_for_selector('[data-pa="panel"] li', timeout=15000)
    ok('11 Explain shows its steps inside the card', page.locator('[data-pa="panel"] li').count() == 3 and 'three instructors' in page.text_content('[data-pa="panel"] p'))
    no_sideways(page, 'explain')

    # 9 Run again on edited SQL, and a write is refused there too
    calls_before = len(API_CALLS)
    page.click('[data-pa="sqlbox"] summary')
    page.fill('[data-pa="sql"]', 'SELECT name AS campus FROM campuses ORDER BY name')
    page.click('[data-pa-run]')
    page.wait_for_function("document.querySelectorAll('table.grid tbody tr').length === 4")
    ok('9a Run again runs the edited SQL and never asks Claude again', len(API_CALLS) == calls_before and 'campus' in page.text_content('table.grid thead'), page.text_content('table.grid thead'))
    page.fill('[data-pa="sql"]', 'DELETE FROM campuses')
    page.click('[data-pa-run]')
    page.wait_for_selector('[data-pa="resultbox"] .errcard')
    ok('9b a write typed into the block is refused and the data is intact', counts(page)['campuses'] == 4 and 'Read only' in page.text_content('[data-pa="resultbox"] .errcard'))
    no_sideways(page, 'run again')

    # 6 repaired
    ask(page, Q_REPAIR)
    page.wait_for_selector('[data-pa="repaired"]', timeout=20000)
    ok('6 a repaired answer shows the Repaired note, the corrected query and the grid',
       'Repaired' in page.text_content('[data-pa="repaired"]') and page.locator('table.grid tbody tr').count() == 5 and 'length(last_name)' in page.input_value('[data-pa="sql"]'))
    no_sideways(page, 'repaired')

    # 7 cannot
    ask(page, Q_CANNOT)
    page.wait_for_selector('[data-pa="cannot"]', timeout=15000)
    ok('7 a cannot answer gives a calm reason', 'no weather data' in page.text_content('[data-pa="cannot"]') and page.locator('table.grid').count() == 0)
    no_sideways(page, 'cannot')

    # 8 a failed DELETE leaves the row counts unchanged
    before = counts(page)
    ask(page, Q_DELETE)
    page.wait_for_selector('[data-pa="failed"]', timeout=20000)
    after = counts(page)
    ok('8 a failed DELETE shows the reason and the SQL, and the row counts are unchanged',
       before == after and before['students'] == 400 and 'DELETE FROM students' in page.input_value('[data-pa="sql"]')
       and page.locator('[data-pa="failed"] [data-pa-run]').count() == 1, (before['students'], after['students']))
    no_sideways(page, 'failed')
    page.screenshot(path=SHOT + '05-failed.png', full_page=True)

    # saved queries sheet and Open in Query Bench from a saved Ask query
    page.click('#btnLib')
    page.wait_for_selector('#libScrim:not(.hidden) .qitem')
    no_sideways(page, 'saved sheet')
    page.click('[data-qbench]')
    page.wait_for_url('**/appaday-195-query-bench/', timeout=15000)
    booted(page)
    page.wait_for_function("Bench.state.p && document.querySelector('#editor').value.length > 0", timeout=15000)
    ok('12a a saved Ask query opens in Query Bench with its SQL', page.input_value('#editor').startswith('SELECT count(*) AS students FROM students'), page.input_value('#editor')[:60])
    page.goto(URL); booted(page)
    page.wait_for_selector('[data-pa="q"]', timeout=20000)
    ask(page, Q_TOP)
    page.wait_for_selector('.pa-card.ok', timeout=15000)
    page.click('[data-pa-action="bench"]')
    page.wait_for_url('**/appaday-195-query-bench/', timeout=15000)
    booted(page)
    page.wait_for_function("Bench.state.p && document.querySelector('#editor').value.length > 0", timeout=15000)
    ok('12b Open in Query Bench from an answer carries the SQL', 'FROM instructors' in page.input_value('#editor'))

    # settings sheet
    page.goto(URL); booted(page)
    page.wait_for_selector('[data-pa="q"]')
    page.click('#btnGear')
    page.wait_for_selector('#setScrim:not(.hidden)')
    page.wait_for_timeout(300)
    ok('13a Settings holds the key manager, the sample switch and the paragraph',
       page.locator('#keyMount [class*="ak-"]').count() > 0 and page.locator('#setSeg button').count() == 2 and 'never uploaded' in page.text_content('#setScrim'))
    no_sideways(page, 'settings')
    page.screenshot(path=SHOT + '06-settings.png')
    page.keyboard.press('Escape')

    ctx.close()

    # 12 no key and the sheet dismissed
    ctx2, page2, errs2 = new_page(b, False)
    page2.goto(URL); booted(page2)
    page2.click('#btnSample')
    page2.wait_for_selector('.chip', timeout=30000)
    ok('12 the key line says no key is saved yet', 'No Claude key' in page2.text_content('[data-pa="key"]'))
    calls = len(API_CALLS)
    ask(page2, Q_OK)
    page2.wait_for_selector('.ak-sheet', timeout=10000)
    no_sideways(page2, 'key sheet')
    page2.screenshot(path=SHOT + '07-key-sheet.png')
    page2.keyboard.press('Escape')
    page2.wait_for_selector('[data-pa="declined"]', timeout=10000)
    ok('12c with no key and the sheet dismissed the answer is declined, with a Settings button and no call sent',
       'needs a Claude API key' in page2.text_content('[data-pa="declined"]') and len(API_CALLS) == calls and page2.locator('[data-pa="declined"] [data-pa-settings]').count() == 1)
    no_sideways(page2, 'declined')
    page2.screenshot(path=SHOT + '08-declined.png', full_page=True)
    page2.click('[data-pa-settings]')
    page2.wait_for_selector('#setScrim:not(.hidden)')
    ok('12d the Settings button opens Settings', page2.is_visible('#setScrim'))
    page2.keyboard.press('Escape')
    ok('12e the app still works after a decline: the sample data is intact', counts(page2)['students'] == 400)

    # 13 nothing scrolls sideways, and targets, errors and the desktop layout
    bad = [l for l, g in sideways if not g]
    ok('13 nothing scrolled sideways at any stage (%d checks)' % len(sideways), not bad, bad)
    page2.set_viewport_size({'width': 1200, 'height': 820}); page2.wait_for_timeout(300)
    no_sideways(page2, 'desktop')
    page2.screenshot(path=SHOT + '09-desktop.png')
    page2.set_viewport_size({'width': 375, 'height': 812}); page2.wait_for_timeout(200)
    small = page2.evaluate("""() => [...document.querySelectorAll('button, input, select, summary, textarea')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44 && e.type !== 'file').map(e => e.id || e.className || e.textContent)""")
    ok('all visible targets at least 44px tall', not small, small[:8])
    ok('no console errors', not errs and not errs2, (errs + errs2)[:5])
    b.close()

failed = [n for n, c in results if not c]
print('\n%d of %d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
