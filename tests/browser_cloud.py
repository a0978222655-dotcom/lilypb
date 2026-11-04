"""Two-device browser integration test using a mocked Supabase HTTP service.

This checks the app integration, not a live Supabase deployment or real RLS.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('LILYPB_TEST_URL', 'http://127.0.0.1:4173')
Path('/tmp/lilypb-checks').mkdir(parents=True, exist_ok=True)
PROJECT = 'https://test-project.supabase.co'
USER = {'id': '11111111-1111-4111-8111-111111111111', 'email': 'lily@example.test'}
OTHER = {'id': '22222222-2222-4222-8222-222222222222', 'email': 'other@example.test'}
database = {}
offline = {'phone': False, 'computer': False}
errors = []


def route_for(device):
    def route_request(route):
        if offline[device]:
            return route.abort('internetdisconnected')
        request = route.request
        path = request.url.split(PROJECT)[1]
        body = json.loads(request.post_data or '{}')
        status = 200
        headers = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS'}
        if request.method == 'OPTIONS':
            return route.fulfill(status=204, headers=headers)
        if path.startswith('/auth/v1/signup'):
            result = {'user': USER}
        elif path.startswith('/auth/v1/token'):
            user = OTHER if body.get('email') == OTHER['email'] else USER
            if body.get('password') != 'test-password':
                status, result = 400, {'msg': 'Invalid login credentials'}
            else:
                result = {'user': user, 'access_token': 'token-' + user['id'], 'refresh_token': 'test-refresh', 'expires_in': 3600}
        elif path.startswith('/auth/v1/logout'):
            result = None
        else:
            user = next((user for user in [USER, OTHER] if request.headers.get('authorization') == 'Bearer token-' + user['id']), None)
            if not user:
                status, result = 401, {'message': 'unauthorized'}
            elif path.startswith('/rest/v1/lily_workspaces'):
                result = [database[user['id']]] if user['id'] in database else []
            elif path.startswith('/rest/v1/rpc/save_lily_workspace'):
                current = database.get(user['id'])
                if (current['version'] if current else 0) != body['p_expected_version']:
                    status, result = 400, {'code': '40001'}
                else:
                    database[user['id']] = {'version': body['p_expected_version'] + 1, 'data': body['p_data']}
                    result = [{'version': database[user['id']]['version']}]
            else:
                status, result = 404, {}
        route.fulfill(status=status, headers=headers, content_type='application/json', body=json.dumps(result))
    return route_request


def nav(page, view):
    page.locator(f'[data-action="nav"][data-view="{view}"]:visible').first.click()


def open_cloud(page):
    page.get_by_role('button', name='雲端帳號與同步', exact=True).click()


def configure(page):
    open_cloud(page)
    page.get_by_label('Supabase 專案網址').fill(PROJECT)
    page.get_by_label('公開 publishable key 或 anon key').fill('sb_publishable_test_public_key')
    page.get_by_role('button', name='儲存連線設定', exact=True).click()


def login(page, email=USER['email']):
    page.get_by_label('Email', exact=True).fill(email)
    page.get_by_label('密碼', exact=True).fill('test-password')
    page.get_by_role('button', name='登入帳號', exact=True).click()
    expect(page.locator('.cloud-status-card')).to_contain_text(email)
    expect(page.locator('[data-cloud-account-status]')).to_have_text('已同步到雲端')


def add_student(page, name):
    nav(page, 'students')
    page.get_by_role('button', name='新增學生', exact=True).first.click()
    page.get_by_label('姓名／稱呼').fill(name)
    page.get_by_label('學習目標').fill('核心穩定')
    page.get_by_role('button', name='儲存學生資料', exact=True).click()


def synced(page):
    expect(page.locator('[data-cloud-label]')).to_have_text('已同步到雲端', timeout=10000)


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    phone_context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    computer_context = browser.new_context(viewport={'width': 1366, 'height': 1000})
    for context, device in [(phone_context, 'phone'), (computer_context, 'computer')]:
        context.route(PROJECT + '/**', route_for(device))
    phone, computer = phone_context.new_page(), computer_context.new_page()
    for page in [phone, computer]:
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: dialog.accept())
        page.goto(BASE, wait_until='networkidle')

    phone.locator('[data-action="template"][data-index="0"]').click()
    phone.get_by_label('課程日期', exact=True).fill('2026-11-04')
    phone.get_by_label('課程名稱', exact=True).fill('原本本機的備課')
    phone.get_by_role('button', name='開始編排').click()
    original_guest = phone.evaluate('localStorage.getItem("lilypb_v2")')

    configure(phone)
    phone.get_by_label('Email', exact=True).fill(USER['email'])
    phone.get_by_label('密碼', exact=True).fill('test-password')
    phone.get_by_role('button', name='註冊新帳號', exact=True).click()
    expect(phone.locator('#toast')).to_contain_text('信箱')
    assert not database, 'Signup must not upload guest data'
    login(phone)
    assert not database, 'Login must not implicitly upload guest data'
    phone.get_by_role('button', name='搬入這台裝置原本的備課', exact=True).click()
    expect(phone.locator('.cloud-status-card')).to_contain_text(USER['email'])
    assert database[USER['id']]['data']['plans']['2026-11-04']['title'] == '原本本機的備課'
    assert phone.evaluate('localStorage.getItem("lilypb_v2")') == original_guest
    phone.get_by_role('button', name='關閉視窗').click()

    configure(computer)
    login(computer)
    computer.get_by_role('button', name='關閉視窗').click()
    expect(computer.locator('.day-course')).to_contain_text('原本本機的備課')
    add_student(computer, '電腦新增的學生')
    synced(computer)

    open_cloud(phone)
    phone.get_by_role('button', name='立即同步', exact=True).click()
    expect(phone.locator('dialog')).not_to_be_visible()
    nav(phone, 'students')
    expect(phone.locator('.student-card')).to_contain_text('電腦新增的學生')

    offline['phone'] = True
    add_student(phone, '手機離線新增')
    expect(phone.locator('[data-cloud-label]')).to_have_text('離線中，編輯保留於本機', timeout=10000)
    add_student(computer, '電腦另一個學生')
    synced(computer)
    offline['phone'] = False
    open_cloud(phone)
    phone.get_by_role('button', name='立即同步', exact=True).click()
    expect(phone.locator('[data-cloud-conflict]')).to_be_visible()
    expect(phone.locator('[data-cloud-account-status]')).to_have_text('有不同版本，請處理')
    phone.get_by_role('button', name='改用雲端版本', exact=True).click()
    expect(phone.locator('[data-cloud-account-status]')).to_have_text('已同步到雲端')
    with phone.expect_download() as result:
        phone.get_by_role('button', name='下載取代前的本機版本', exact=True).click()
    recovery = json.loads(Path(result.value.path()).read_text())
    assert any(student['name'] == '手機離線新增' for student in recovery['students'])
    assert 'access_token' not in json.dumps(recovery)
    phone.get_by_role('button', name='關閉視窗').click()
    nav(phone, 'students')
    expect(phone.locator('.student-card')).to_have_count(2)
    expect(phone.locator('main')).to_contain_text('電腦另一個學生')

    phone.reload(wait_until='networkidle')
    synced(phone)
    assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth')
    second_tab = phone_context.new_page()
    second_tab.goto(BASE, wait_until='networkidle')
    open_cloud(second_tab)
    expect(second_tab.locator('[data-cloud-error]')).to_contain_text('同一瀏覽器已開啟')
    second_tab.close()
    open_cloud(phone)
    phone.screenshot(path='/tmp/lilypb-checks/cloud-phone.png', full_page=True)
    phone.get_by_role('button', name='登出', exact=True).click()
    expect(phone.locator('[data-cloud-account-status]')).to_have_text('尚未登入雲端')
    phone.get_by_role('button', name='關閉視窗').click()
    nav(phone, 'students')
    expect(phone.locator('.student-card')).to_have_count(0)
    assert phone.evaluate('localStorage.getItem("lilypb_v2")') == original_guest
    open_cloud(phone)
    login(phone, OTHER['email'])
    phone.get_by_role('button', name='關閉視窗').click()
    nav(phone, 'students')
    expect(phone.locator('.student-card')).to_have_count(0)
    assert OTHER['id'] not in database
    assert len(database[USER['id']]['data']['students']) == 2
    assert not errors, errors
    print('PASS mocked two-device sync: signup/login, explicit guest migration, computer-to-phone updates, offline edits, conflict detection/recovery, session restoration, same-browser tab locking, logout/account isolation; no JS errors')
    browser.close()
