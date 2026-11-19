# End to end check of Key Finder (AppADay 196) in Chromium at 375px.
# Serve the parent folder that holds this repo, the 195 and 196 repos and the appaday portal clone side by side:
#   cd .. && python3 -m http.server 8196   then   python3 appaday-194-csv-intake/test/e2e_key_finder.py
# The sample is the Clinic college seeded with declareKeys: false, so every key and link has to be inferred.
import os, sys
from playwright.sync_api import sync_playwright

PORT = os.environ.get('KF_PORT', '8196')
BASE = 'http://127.0.0.1:' + PORT + '/'
URL = BASE + 'appaday-196-key-finder/'
SHOT = os.environ.get('KF_SHOTS', '/home/claude/shots196/')
os.makedirs(SHOT, exist_ok=True)
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
EXPECTED = sorted([
    'instructors.dept_id', 'instructors.mentor_id', 'courses.dept_id', 'rooms.campus_id',
    'sections.course_id', 'sections.term_id', 'sections.instructor_id', 'sections.room_id',
    'students.home_campus_id', 'students.major_dept_id', 'enrollments.student_id', 'enrollments.section_id',
    'work_orders.campus_id', 'work_orders.room_id'])
results = []

def ok(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + ('  ' + str(extra) if extra else ''))

def booted(page):
    page.wait_for_function("!['Loading engine', 'Starting'].includes(document.querySelector('#saveState .txt').textContent)", timeout=20000)

def saved(page):
    page.wait_for_function("document.querySelector('#saveState').classList.contains('saved')", timeout=10000)

def count(page, gid):
    return int(page.text_content('#' + gid + 'Count'))

def no_sideways(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

def tap_box(page, name):
    page.locator('#diag g.box[data-t="%s"]' % name).click()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, user_agent=UA, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'TUNNEL' not in m.text else None)

    # empty state
    page.goto(URL); booted(page)
    ok('empty state leads with Load sample', page.is_visible('#empty') and page.evaluate("document.querySelector('#empty .cta .btn').id") == 'btnSample')
    ok('no sideways scroll (empty)', no_sideways(page))
    page.screenshot(path=SHOT + '01-empty.png')

    # sample, not analyzed yet
    page.click('#btnSample')
    page.wait_for_function("KeyFinder.state.p && KeyFinder.state.p.userTables().length === 10", timeout=30000)
    ok('sample loads 10 tables', page.evaluate("KeyFinder.state.p.userTables().length") == 10)
    ok('loading does not analyze: empty state led by Analyze', page.is_visible('#ready') and page.evaluate("document.querySelector('#ready .cta .btn').id") == 'btnAnalyzeReady'
       and page.evaluate("KeyFinder.state.p.keys().length + KeyFinder.state.p.relations().length") == 0)
    page.screenshot(path=SHOT + '02-ready.png')

    # analyze
    page.click('#btnAnalyzeReady')
    page.wait_for_selector('#finder:not(.hidden)', timeout=20000)
    ok('after Analyze, Proposed 14 and Maybe 0', count(page, 'grpProposed') == 14 and count(page, 'grpMaybe') == 0, (count(page, 'grpProposed'), count(page, 'grpMaybe')))
    pairs = page.evaluate("KeyFinder.state.p.relations('proposed').map(r => r.fromTable + '.' + r.fromColumns.join('+')).sort()")
    ok('the 14 proposed pairs are exactly the expected list', pairs == EXPECTED, [x for x in pairs if x not in EXPECTED] + [x for x in EXPECTED if x not in pairs])
    best = page.evaluate("KeyFinder.state.p.keys().filter(k => k.evidence && k.evidence.best).map(k => k.table + '.' + k.columns.join('+')).sort()")
    want = sorted(['campuses.campus_id', 'courses.course_id', 'departments.dept_id', 'enrollments.enrollment_id', 'instructors.instructor_id',
                   'rooms.room_id', 'sections.section_id', 'students.student_id', 'terms.term_id', 'work_orders.work_order_id'])
    ok('the 10 best keys are the <table>_id columns', best == want, best)
    ok('keys list shows one row per table', page.locator('#keysList .krow').count() == 10)
    page.screenshot(path=SHOT + '03-keys.png', full_page=True)

    # reject mentor_id, analyze again
    page.click('.viewseg [data-view="links"]')
    rid = page.evaluate("KeyFinder.state.p.relations().find(r => r.fromTable === 'instructors' && r.fromColumns[0] === 'mentor_id').id")
    page.click('[data-decide="%d:rejected"]' % rid)
    page.click('#btnAnalyze')
    page.wait_for_function("!document.querySelector('#btnAnalyze').disabled", timeout=20000)
    page.wait_for_timeout(100)
    ok('rejected link stays rejected after Analyze: 13 proposed, 1 decided',
       count(page, 'grpProposed') == 13 and count(page, 'grpDecided') == 1 and page.evaluate("KeyFinder.state.p.relations('rejected').length") == 1,
       (count(page, 'grpProposed'), count(page, 'grpDecided')))
    page.screenshot(path=SHOT + '04-links.png', full_page=True)

    # confirm all strong
    page.click('#btnConfirmStrong')
    ok('Confirm all strong leaves 13 confirmed', page.evaluate("KeyFinder.state.p.relations('confirmed').length") == 13 and count(page, 'grpProposed') == 0)

    # diagram
    page.click('.viewseg [data-view="diagram"]')
    page.wait_for_timeout(200)
    ok('diagram: 10 boxes, 13 solid lines, 0 dashed', page.locator('#diag g.box').count() == 10 and page.locator('#diag path.edge.confirmed').count() == 13
       and page.locator('#diag path.edge.proposed').count() == 0,
       (page.locator('#diag g.box').count(), page.locator('#diag path.edge.confirmed').count(), page.locator('#diag path.edge.proposed').count()))
    ok('no sideways scroll (diagram)', no_sideways(page))
    page.screenshot(path=SHOT + '05-diagram.png')

    # drag a box, then reload
    page.locator('#diag g.box[data-t="terms"]').scroll_into_view_if_needed()
    bb = page.locator('#diag g.box[data-t="terms"]').bounding_box()
    before = page.evaluate("KeyFinder.state.pos.terms.slice()")
    cx, cy = bb['x'] + 40, bb['y'] + 14
    page.mouse.move(cx, cy); page.mouse.down()
    for i in range(1, 9):
        page.mouse.move(cx + i * 7, cy + i * 6)
    page.mouse.up()
    moved = page.evaluate("KeyFinder.state.pos.terms.slice()")
    ok('drag moves the box', abs(moved[0] - before[0] - 56) < 2 and abs(moved[1] - before[1] - 48) < 2, (before, moved))
    ok('drag did not select', page.evaluate("KeyFinder.state.sel") is None)
    saved(page)
    page.wait_for_timeout(300)
    page.reload(); booted(page)
    page.wait_for_selector('#finder:not(.hidden)', timeout=20000)
    after = page.evaluate("KeyFinder.state.pos.terms")
    ok('dragged box keeps its position after reload', [round(x) for x in after] == [round(x) for x in moved], (moved, after))

    # tap two tables
    page.click('.viewseg [data-view="diagram"]')
    page.wait_for_timeout(200)
    tap_box(page, 'enrollments')
    ok('first tap selects with a hint', page.evaluate("KeyFinder.state.sel") == 'enrollments' and 'second' in page.text_content('#selHint'))
    tap_box(page, 'enrollments')
    ok('tapping the selected table again clears it', page.evaluate("KeyFinder.state.sel") is None)
    tap_box(page, 'enrollments'); tap_box(page, 'campuses')
    page.wait_for_selector('body.join-open #joinSql')
    sql = page.text_content('#joinSql')
    ok('enrollments then campuses joins students and campuses', 'JOIN "students"' in sql and 'JOIN "campuses"' in sql and 'home_campus_id' in sql, sql)
    ok('path lines highlighted', page.locator('#diag path.edge.hl').count() == 2)
    ok('no sideways scroll (join)', no_sideways(page))
    page.screenshot(path=SHOT + '06-join.png')
    page.click('#swLeft')
    ok('Keep unmatched rows writes LEFT JOIN', 'LEFT JOIN' in page.text_content('#joinSql'))
    page.click('#swLeft')

    # save as query
    page.click('#btnSaveJoin')
    q = page.evaluate("KeyFinder.state.p.queries()")
    ok('Save as query stores it', len(q) == 1 and q[0]['name'] == 'enrollments to campuses' and q[0]['note'] == 'JOIN written by Key Finder' and q[0]['sql'] == sql)

    # Escape closes the join
    page.keyboard.press('Escape')
    ok('Escape closes the JOIN', not page.evaluate("document.body.classList.contains('join-open')") and page.locator('#diag path.edge.hl').count() == 0)

    # open in Query Bench
    tap_box(page, 'enrollments'); tap_box(page, 'campuses')
    page.wait_for_selector('body.join-open #btnBench')
    page.click('#btnBench')
    page.wait_for_url('**/appaday-195-query-bench/', timeout=15000)
    booted(page)
    page.wait_for_function("Bench.state.p && document.querySelector('#editor').value.length > 0", timeout=10000)
    ok('Query Bench opens with the SQL in the editor', page.input_value('#editor') == sql, page.input_value('#editor')[:80])
    page.click('#btnRun')
    page.wait_for_selector('#resultBody table.grid', timeout=15000)
    n = page.evaluate("Bench.state.result.res.rowCount")
    ok('Run returns 5,000 rows', n == 5000, n)
    page.screenshot(path=SHOT + '07-bench.png')

    # two unrelated tables built in the page
    page.goto(URL); booted(page)
    page.evaluate("""() => {
      const p = QD.create('Unrelated pair');
      let a = 'id,name,score\\n', b = 'id,label\\n';
      for (let i = 1; i <= 30; i++) a += i + ',Player ' + i + ',' + (i * 7 % 50) + '\\n';
      for (let i = 1; i <= 12; i++) b += i + ',Month ' + i + '\\n';
      p.loadCSV(a, { fileName: 'players.csv' }); p.loadCSV(b, { fileName: 'months.csv' });
      return QD.store.save(p.name, p.export('196'), '196').then(() => p.close());
    }""")
    page.click('#btnOpen')
    page.wait_for_selector('#openList [data-open="Unrelated pair"]')
    page.click('#openList [data-open="Unrelated pair"]')
    page.wait_for_function("document.querySelector('#projName').value === 'Unrelated pair'", timeout=10000)
    page.wait_for_selector('#ready:not(.hidden)')
    page.click('#btnAnalyzeReady')
    page.wait_for_selector('#finder:not(.hidden)', timeout=20000)
    keys2 = page.evaluate("KeyFinder.state.p.keys().filter(k => k.evidence && k.evidence.best).length")
    ok('two unrelated tables: 0 proposed, 0 maybe, 2 keys', count(page, 'grpProposed') == 0 and count(page, 'grpMaybe') == 0 and keys2 == 2,
       (count(page, 'grpProposed'), count(page, 'grpMaybe'), keys2))
    page.click('.viewseg [data-view="diagram"]'); page.wait_for_timeout(150)
    tap_box(page, 'players'); tap_box(page, 'months')
    page.wait_for_selector('body.join-open')
    ok('unconnected tables say so', 'not connected yet' in page.text_content('#joinBody'))
    page.keyboard.press('Escape')
    ok('no sideways scroll (final)', no_sideways(page))

    # wider layout
    page.set_viewport_size({'width': 1200, 'height': 820})
    page.wait_for_timeout(300)
    ok('two columns at 720px and wider', page.is_visible('#paneKeys') and page.is_visible('#paneLinks') and page.is_visible('#paneDiag') and not page.is_visible('.viewseg'))
    page.screenshot(path=SHOT + '08-desktop.png')

    small = page.evaluate("""() => [...document.querySelectorAll('button, input, select, summary')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44 && e.type !== 'file').map(e => e.id || e.className || e.textContent)""")
    ok('all visible targets at least 44px tall', not small, small[:8])
    ok('no console errors', not errs, errs[:5])
    b.close()

failed = [n for n, c in results if not c]
print('\n%d of %d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
