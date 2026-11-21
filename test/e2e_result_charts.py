# End to end check of Result Charts (AppADay 198) in Chromium at 375px, with the iPhone user agent.
# Serve the parent folder that holds this repo, the 198 repo and the appaday portal clone side by side:
#   cd .. && python3 -m http.server 8198   then   python3 appaday-194-csv-intake/test/e2e_result_charts.py
# save.js is not loaded. Chart.js is served from node_modules (npm install), at the jsdelivr URL the app names.
import os, struct, zlib
from playwright.sync_api import sync_playwright

PORT = os.environ.get('RC_PORT', '8198')
BASE = 'http://127.0.0.1:' + PORT + '/'
URL = BASE + 'appaday-198-result-charts/'
HERE = os.path.dirname(os.path.abspath(__file__))
CHARTJS = os.path.join(HERE, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js')
CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js'
SHOT = os.environ.get('RC_SHOTS', '/home/claude/shots198/')
os.makedirs(SHOT, exist_ok=True)
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
EXPECT = {'tile': 'tile', 'bar': 'bar', 'pie': 'pie', 'line': 'line', 'scatter': 'scatter', 'pivot': 'bar'}
results = []

def ok(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + ('  ' + str(extra) if extra else ''))

def route_all(route):
    url = route.request.url
    if url.startswith(BASE):
        return route.continue_()
    if url.split('?')[0] == CDN:
        with open(CHARTJS, 'rb') as f:
            return route.fulfill(status=200, content_type='text/javascript', body=f.read())
    return route.abort()

def booted(page):
    page.wait_for_function("!['Loading engine', 'Starting'].includes(document.querySelector('#saveState .txt').textContent)", timeout=20000)

def sideways(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth")

def png_corners(path):
    """Decode an RGBA or RGB PNG with no dependencies and return the four corner pixels."""
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    i, idat, w = 8, b'', 0
    while i < len(data):
        n = struct.unpack('>I', data[i:i + 4])[0]; t = data[i + 4:i + 8]; body = data[i + 8:i + 8 + n]
        if t == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', body[:10])
        elif t == b'IDAT':
            idat += body
        i += 12 + n
    bpp = 4 if ctype == 6 else 3
    raw = zlib.decompress(idat); stride = w * bpp
    rows, prev, pos = [], bytearray(stride), 0
    for y in range(h):
        f = raw[pos]; line = bytearray(raw[pos + 1:pos + 1 + stride]); pos += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else (b if pb <= pc else c))) & 255
        rows.append(line); prev = line
    px = lambda x, y: tuple(rows[y][x * bpp:x * bpp + bpp])
    return [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, user_agent=UA, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    ctx.route('**/*', route_all)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)  # aborted font and save.js requests

    page.goto(URL); booted(page)
    ok('1 empty state leads with Load sample data', page.is_visible('#empty') and page.text_content('#empty .cta .btn').strip() == 'Load sample data')
    ok('1 Chart.js loaded and defaults set', page.evaluate("!!window.Chart && Chart.defaults.plugins.legend.position === 'bottom' && Chart.defaults.font.size >= 11"))
    page.screenshot(path=SHOT + '01-empty.png')
    page.click('#btnSample')
    page.wait_for_selector('[data-sample]', timeout=30000)
    ok('2 six sample chips', page.locator('[data-sample]').count() == 6)

    for key, want in EXPECT.items():
        page.click('[data-sample="' + key + '"]')
        page.wait_for_timeout(450)
        got = page.evaluate("ResultCharts.chart.spec && ResultCharts.chart.spec.type")
        drawn = page.evaluate("key => key === 'tile' ? !!document.querySelector('#chartArea .tile .v') : !!(document.querySelector('#chartArea canvas') && document.getElementById('chartArea')._chart)", key)
        extra = ''
        if key == 'pivot':
            extra = page.evaluate("ResultCharts.chart.spec.series + ' ' + document.getElementById('chartArea')._chart.data.datasets.length")
            drawn = drawn and page.evaluate("ResultCharts.chart.spec.series === 'grade' && document.getElementById('chartArea')._chart.data.datasets.length >= 2")
        if key == 'line':
            drawn = drawn and page.evaluate("(() => { const l = document.getElementById('chartArea')._chart.data.labels; return l.join() === l.slice().sort().join(); })()")
        ok('3 chip %s gives %s' % (key, want), got == want and drawn, '%s %s' % (got, extra))
        ok('3 chip %s fits 375 px with no sideways scroll' % key, sideways(page))
        page.screenshot(path=SHOT + '02-chip-%s.png' % key, full_page=True)

    ticks = page.evaluate("(() => { const c = document.getElementById('chartArea')._chart; return Object.values(c.options.scales).map(s => s.ticks.font.size); })()")
    ok('4 ticks are 11 px or larger', all(t >= 11 for t in ticks), ticks)
    page.click('[data-sample="pivot"]'); page.wait_for_timeout(300)
    horiz = page.evaluate("document.getElementById('chartArea')._chart.options.indexAxis")
    ok('4 grouped bar with long labels lies on its side on a phone', horiz == 'y', horiz)

    # controls redraw without rerunning
    runs = page.evaluate("ResultCharts.state.p.history(500).length")
    page.click('[data-sample="bar"]'); page.wait_for_timeout(300)
    runs = page.evaluate("ResultCharts.state.p.history(500).length")
    page.click('[data-ctype="pie"]'); page.wait_for_timeout(300)
    ok('5 type switch redraws as pie without rerunning the query', page.evaluate("ResultCharts.chart.spec.type") == 'pie'
       and page.evaluate("document.getElementById('chartArea')._chart.config.type") == 'pie' and page.evaluate("ResultCharts.state.p.history(500).length") == runs)
    page.click('[data-ctype="bar"]'); page.wait_for_timeout(200)

    # pin 1: students per campus
    page.click('#btnPin')
    page.wait_for_selector('#saveScrim:not(.hidden)')
    page.fill('#qName', 'Students per campus')
    page.click('#btnSaveGo'); page.wait_for_timeout(400)
    # pin 2: student count tile
    page.click('[data-sample="tile"]'); page.wait_for_timeout(300)
    page.click('#btnPin'); page.wait_for_selector('#saveScrim:not(.hidden)')
    page.fill('#qName', 'Student count')
    page.click('#btnSaveGo'); page.wait_for_timeout(400)
    st = page.evaluate("(() => { const p = ResultCharts.state.p; return { charts: p.charts().map(c => c.spec.title), origins: p.queries().map(q => q.origin) }; })()")
    ok('6 two pins with saved manual queries', st['charts'] == ['Students per campus', 'Student count'] and st['origins'] == ['manual', 'manual'], st)
    ok('6 picker lists saved queries with origin tags', page.evaluate("[...document.querySelectorAll('#srcPick option')].some(o => /\\[manual\\]$/.test(o.textContent))"))

    page.evaluate("ResultCharts.state.p.execute(\"INSERT INTO students (student_id, first_name, last_name, home_campus_id) VALUES (5001, 'Ada', 'New', 4)\")")
    page.evaluate("ResultCharts.state.auto.flush()")
    page.wait_for_timeout(600)
    page.reload(); booted(page)
    page.click('#tabBoard'); page.wait_for_timeout(700)
    titles = page.evaluate("[...document.querySelectorAll('.bcard h3')].map(h => h.textContent)")
    tile = page.evaluate("(document.querySelector('.bcard .tile .v') || {}).textContent")
    ok('7 after reload the board shows both pins in order', titles == ['Students per campus', 'Student count'], titles)
    ok('7 the board reran the query and shows the changed value', tile == '401', tile)
    ok('7 board fits 375 px', sideways(page))
    page.screenshot(path=SHOT + '03-board.png', full_page=True)

    page.click('.bcard [data-bdown]'); page.wait_for_timeout(400)
    titles = page.evaluate("[...document.querySelectorAll('.bcard h3')].map(h => h.textContent)")
    ok('8 Move down reorders the board', titles == ['Student count', 'Students per campus'], titles)
    page.click('.bcard [data-bup]:not([disabled])'); page.wait_for_timeout(400)

    with page.expect_download() as dl:
        page.click('.bcard [data-bpng]')
    d = dl.value
    path = SHOT + d.suggested_filename
    d.save_as(path)
    corners = png_corners(path)
    solid = all(c[:3] == (0x18, 0x15, 0x0e) and (len(c) == 3 or c[3] == 255) for c in corners)
    ok('9 PNG downloads with a solid background', d.suggested_filename == 'appaday-198-students-per-campus.png' and solid, (d.suggested_filename, corners))

    # a missing column shows on its own card only
    page.evaluate("(() => { const p = ResultCharts.state.p; const q = p.queries().find(q => q.name === 'Students per campus'); p.saveQuery({ id: q.id, name: q.name, sql: 'SELECT name, city FROM campuses' }); })()")
    page.click('#btnRefresh'); page.wait_for_timeout(500)
    errcards = page.evaluate("[...document.querySelectorAll('.bcard')].map(c => !!c.querySelector('[data-err]'))")
    msg = page.evaluate("(document.querySelector('.bcard [data-err]') || {}).textContent")
    ok('10 a missing column errors on its own card only', errcards == [True, False] and 'campus' in (msg or ''), msg)

    ok('11 no console errors', not errs, errs)
    b.close()

failed = [n for n, g in results if not g]
print('\n%d of %d passed' % (len(results) - len(failed), len(results)))
raise SystemExit(1 if failed else 0)
