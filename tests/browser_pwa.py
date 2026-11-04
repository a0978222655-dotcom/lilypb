"""Test the built iOS-ready web app with Chromium; not a physical iOS test.

Run `npm run build`, serve dist/ on port 4174, then `python3 tests/browser_pwa.py`.
"""
import json
import mimetypes
import os
import re
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('LILYPB_PWA_TEST_URL', 'http://127.0.0.1:4174')
DIST = (Path(__file__).resolve().parent.parent / 'dist').resolve()
OUTPUT = Path('/tmp/lilypb-checks')
OUTPUT.mkdir(exist_ok=True)


def nav(page, view):
    page.locator(f'[data-action="nav"][data-view="{view}"]:visible').first.click()


def ready(page):
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    page.evaluate('navigator.serviceWorker.ready.then(() => true)')


def lesson(page):
    page.locator('[data-action="template"][data-index="0"]').click()
    page.get_by_label('課程日期', exact=True).fill('2026-11-04')
    page.get_by_label('課程名稱', exact=True).fill('離線可用的課程')
    page.get_by_role('button', name='開始編排').click()
    page.get_by_role('button', name='完成備課', exact=True).first.click()


def offline_test(browser):
    context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until='networkidle')
    ready(page)
    assert page.locator('meta[name="apple-mobile-web-app-capable"]').get_attribute('content') == 'yes'
    manifest = page.request.get(BASE + '/manifest.webmanifest')
    assert manifest.ok and manifest.json()['display'] == 'standalone'
    assert manifest.json()['scope'] == './'
    for size, filename in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
        icon = page.request.get(BASE + '/assets/' + filename)
        assert icon.ok and icon.headers['content-type'] == 'image/png'
        assert struct.unpack('>II', icon.body()[16:24]) == (size, size)
    page.locator('[data-action="install"]').click()
    expect(page.get_by_role('heading', name='把備課室，放進主畫面')).to_be_visible()
    expect(page.locator('[data-pwa-status]')).to_contain_text('已準備好離線開啟')
    assert page.locator('.install-steps li').count() == 3
    page.screenshot(path=str(OUTPUT / 'install-iphone.png'))
    page.get_by_role('button', name='關閉視窗').click()
    lesson(page)
    context.set_offline(True)
    page.reload(wait_until='networkidle')
    nav(page, 'practice')
    expect(page.get_by_role('heading', name='離線可用的課程', exact=True)).to_be_visible()
    nav(page, 'students')
    page.get_by_role('button', name='新增學生', exact=True).first.click()
    page.get_by_label('姓名／稱呼').fill('離線記錄也保留')
    page.get_by_role('button', name='儲存學生資料', exact=True).click()
    page.close()
    page = context.new_page()
    page.goto(BASE + '/?from=home-screen', wait_until='networkidle')
    nav(page, 'students')
    expect(page.get_by_role('heading', name='離線記錄也保留', exact=True)).to_be_visible()
    cached = page.evaluate('''async () => {
      const result = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) result.push(request.url);
      return result;
    }''')
    assert cached and all(url.startswith(BASE + '/') for url in cached)
    assert not any('/auth/v1' in url or '/rest/v1' in url or 'backup' in url for url in cached)
    assert not page.evaluate('fetch("https://test-project.supabase.co/rest/v1/lily_workspaces").then(() => true).catch(() => false)')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors
    context.close()
    print('PASS iPhone-size install help, manifest/icons, offline reload/new window, offline editing, saved data and API cache exclusion')


class SubpathHandler(BaseHTTPRequestHandler):
    phase = 1

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if not path.startswith(('/one/', '/two/')):
            self.send_error(404)
            return
        relative = path.split('/', 2)[2] or 'index.html'
        target = (DIST / relative).resolve()
        if not target.is_relative_to(DIST) or not target.is_file():
            self.send_error(404)
            return
        if self.phase == 3 and relative == 'src/styles.css':
            self.send_error(503)
            return
        content = target.read_bytes()
        if relative == 'sw.js':
            content = re.sub(rb"const VERSION = '[^']+';", f"const VERSION = 'test-release-{self.phase}';".encode(), content)
        if relative == 'index.html':
            content = content.replace(b'<body>', f'<body data-test-release="{self.phase}">'.encode())
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *_):
        pass


def updates_and_scopes(browser):
    server = ThreadingHTTPServer(('127.0.0.1', 0), SubpathHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    context = browser.new_context(viewport={'width': 820, 'height': 1180}, has_touch=True)
    page = context.new_page()
    page.on('dialog', lambda dialog: dialog.accept())
    try:
        page.goto(base + '/one/', wait_until='networkidle')
        ready(page)
        lesson(page)
        saved = page.evaluate('localStorage.getItem("lilypb_v2")')
        page2 = context.new_page()
        page2.goto(base + '/two/', wait_until='networkidle')
        ready(page2)
        keys = page.evaluate('caches.keys()')
        assert any('/one/:' in key for key in keys) and any('/two/:' in key for key in keys)

        SubpathHandler.phase = 2
        page.locator('[data-action="install"]').click()
        page.get_by_role('button', name='檢查 App 版本', exact=True).click()
        expect(page.get_by_role('button', name='更新並重新開啟', exact=True)).to_be_visible(timeout=15000)
        assert page.locator('body').get_attribute('data-test-release') == '1', 'Must not reload before user confirms'
        page.get_by_role('button', name='更新並重新開啟', exact=True).click()
        page.wait_for_function('document.body.dataset.testRelease === "2"')
        ready(page)
        assert page.evaluate('localStorage.getItem("lilypb_v2")') == saved
        keys = page.evaluate('caches.keys()')
        assert any('/two/:' in key for key in keys), 'Updating one installed path must not delete another app cache'

        SubpathHandler.phase = 3
        page.evaluate('''async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          const failed = new Promise(resolve => reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker.addEventListener('statechange', () => { if (worker.state === 'redundant') resolve(true); });
          }, {once:true}));
          await reg.update();
          return failed;
        }''')
        keys = page.evaluate('caches.keys()')
        assert any(key.endswith('test-release-2') and '/one/:' in key for key in keys)
        assert not any(key.endswith('test-release-3') and '/one/:' in key for key in keys)
        context.set_offline(True)
        page.reload(wait_until='networkidle')
        assert page.locator('body').get_attribute('data-test-release') == '2'
        assert page.evaluate('localStorage.getItem("lilypb_v2")') == saved
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        print('PASS GitHub Pages subpaths, scoped caches, explicit app updates, saved-data retention and failed-update offline fallback')
    finally:
        context.close()
        server.shutdown()
        server.server_close()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    offline_test(browser)
    updates_and_scopes(browser)
    browser.close()
