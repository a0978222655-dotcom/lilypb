"""Run with: python3 tests/browser_smoke.py (Playwright + Chromium required)."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('LILYPB_TEST_URL', 'http://127.0.0.1:4173')
OUTPUT = Path('/tmp/lilypb-checks')
OUTPUT.mkdir(exist_ok=True)


def nav(page, view):
    page.locator(f'[data-action="nav"][data-view="{view}"]:visible').first.click()


def check_layout(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'


def workflow(browser, width, height):
    context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=width < 701, has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(BASE, wait_until='networkidle')
    expect(page.get_by_role('heading', name='每一堂課，從容開始。')).to_be_visible()
    page.screenshot(path=str(OUTPUT / f'home-{width}.png'), full_page=True)
    check_layout(page)

    nav(page, 'students')
    page.get_by_role('button', name='新增學生', exact=True).first.click()
    page.get_by_label('姓名／稱呼').fill('小莉')
    page.get_by_label('學習目標').fill('核心穩定')
    page.get_by_label('教學提醒與觀察').fill('慢慢引導，留意呼吸節奏。')
    page.get_by_role('button', name='儲存學生資料').click()
    expect(page.get_by_role('heading', name='小莉', exact=True)).to_be_visible()
    check_layout(page)

    nav(page, 'library')
    page.get_by_role('button', name='新增動作', exact=True).first.click()
    page.get_by_label('動作名稱', exact=True).fill('肩橋')
    page.get_by_label('預設分鐘／組').fill('4')
    page.get_by_label('教學提示').fill('緩慢吐氣，感受脊椎一節一節回到墊面。')
    page.get_by_role('button', name='儲存動作', exact=True).click()
    page.get_by_label('搜尋動作', exact=True).fill('肩橋')
    expect(page.locator('.library-card')).to_have_count(1)
    expect(page.get_by_role('heading', name='肩橋', exact=True)).to_be_visible()
    check_layout(page)

    nav(page, 'home')
    page.locator('[data-action="template"][data-index="0"]').click()
    page.get_by_label('課程日期', exact=True).fill('2026-11-04')
    page.get_by_label('課程名稱', exact=True).fill('早晨流動')
    page.get_by_role('button', name='開始編排').click()
    expect(page.locator('[data-total]')).to_have_text('30')
    page.get_by_role('button', name='選擇學生', exact=True).click()
    page.get_by_role('checkbox', name='小莉 核心穩定').check()
    page.get_by_role('button', name='儲存選擇').click()
    expect(page.locator('.assigned-student')).to_contain_text('核心穩定')
    page.get_by_label('目標時長（分鐘）', exact=True).fill('45')
    page.get_by_label('上課時間', exact=True).fill('09:00')
    page.get_by_label('給自己的教學筆記').fill('記得放慢轉換，保持流暢。')
    page.locator('[data-action="pick"]').first.click()
    page.get_by_label('搜尋可加入的動作', exact=True).last.fill('肩橋')
    page.locator('dialog [data-action="add-exercise"]').click()
    page.get_by_role('button', name='完成選擇', exact=True).click()
    expect(page.locator('[data-total]')).to_have_text('34')
    first_group = page.locator('.group-panel').first
    expect(first_group.locator('.exercise-row')).to_have_count(3)
    first_group.get_by_role('button', name='向上移動 肩橋').click()
    expect(first_group.get_by_label('動作名稱', exact=True).nth(1)).to_have_value('肩橋')
    page.screenshot(path=str(OUTPUT / f'planner-{width}.png'), full_page=True)
    check_layout(page)

    page.get_by_role('button', name='複製課程到其他日期').click()
    page.get_by_label('複製到哪一天？').fill('2026-11-04')
    page.get_by_role('button', name='複製課程', exact=True).click()
    page.get_by_label('課程名稱', exact=True).fill('晚間核心')
    page.get_by_role('button', name='完成備課', exact=True).first.click()
    saved = page.evaluate('JSON.parse(localStorage.getItem("lilypb_v2"))')
    assert len(saved['plans']) == 2
    assert sum(plan['done'] for plan in saved['plans'].values()) == 1
    assert saved['students'][0]['name'] == '小莉'
    assert all(plan['time'] == '09:00' for plan in saved['plans'].values())

    nav(page, 'practice')
    expect(page.locator('.practice-card')).to_have_count(1)
    page.get_by_role('button', name='開始上課', exact=True).click()
    page.locator('[data-action="timer"]').first.click()
    expect(page.locator('#timer-value')).to_have_text('05:00')
    page.get_by_role('button', name='暫停計時').click()
    paused = page.locator('#timer-value').inner_text()
    page.wait_for_timeout(1100)
    assert page.locator('#timer-value').inner_text() == paused
    page.get_by_role('button', name='繼續計時').click()
    page.get_by_role('button', name='完成', exact=True).click()
    expect(page.locator('.teaching-item.completed')).to_have_count(1)
    page.screenshot(path=str(OUTPUT / f'teaching-{width}.png'), full_page=True)
    check_layout(page)

    nav(page, 'students')
    page.get_by_role('button', name='課程紀錄').click()
    expect(page.locator('.history-course')).to_have_count(2)
    page.get_by_role('button', name='關閉視窗').click()
    page.reload(wait_until='networkidle')
    assert len(page.evaluate('JSON.parse(localStorage.getItem("lilypb_v2")).plans')) == 2

    page.get_by_role('button', name='資料與設定', exact=True).first.click()
    with page.expect_download() as result:
        page.get_by_role('button', name='匯出完整備份').click()
    backup = json.loads(Path(result.value.path()).read_text())
    assert len(backup['plans']) == 2
    assert backup['students'][0]['goal'] == '核心穩定'
    before = page.evaluate('localStorage.getItem("lilypb_v2")')
    page.locator('#import-file').set_input_files({'name': 'invalid.json', 'mimeType': 'application/json', 'buffer': b'{"bad":true}'})
    expect(page.locator('#toast')).to_contain_text('無法匯入')
    assert page.evaluate('localStorage.getItem("lilypb_v2")') == before
    page.locator('#import-file').set_input_files({'name': 'backup.json', 'mimeType': 'application/json', 'buffer': json.dumps(backup).encode()})
    expect(page.locator('dialog')).not_to_be_visible()
    assert len(page.evaluate('JSON.parse(localStorage.getItem("lilypb_v2")).plans')) == 2
    assert not errors, errors
    context.close()
    print(f'PASS {width}x{height}: students, library, planner, same-day copy, teaching timer, persistence, backup import/export, layout; no JS errors')


def legacy_and_recovery(browser):
    legacy = {'lib': [{'id': 'a1', 'name': '呼吸練習', 'min': 3}], 'plans': {'2026-11-04': {'loc': '原本教室', 'locNote': '帶彈力帶', 'done': True, 'progress': {'i1': True}, 'groups': [{'id': 'g1', 'name': '初期', 'items': [{'id': 'i1', 'name': '呼吸練習', 'sets': 2, 'min': 3, 'note': '原本筆記'}]}]}}}
    context = browser.new_context()
    context.add_init_script(f'localStorage.setItem("pilates_prep_v1", {json.dumps(json.dumps(legacy))})')
    page = context.new_page()
    page.goto(BASE)
    nav(page, 'practice')
    page.get_by_role('button', name='開始上課', exact=True).click()
    expect(page.locator('.teaching-item.completed')).to_have_count(1)
    expect(page.locator('.teaching-item')).to_contain_text('原本筆記')
    assert json.loads(page.evaluate('localStorage.getItem("pilates_prep_v1")')) == legacy
    context.close()

    context = browser.new_context()
    context.add_init_script('localStorage.setItem("lilypb_v2", "{broken")')
    page = context.new_page()
    page.goto(BASE)
    expect(page.locator('[role="alert"]')).to_contain_text('已保留原始資料')
    assert page.evaluate('localStorage.getItem("lilypb_v2")') == '{broken'
    context.close()
    print('PASS original v1 migration and corrupt storage recovery; original data preserved')


def timer_and_failed_writes(browser):
    fixture = {'schemaVersion': 2, 'students': [], 'lib': [], 'locs': [], 'plans': {'2026-11-04': {'title': '計時測試', 'done': True, 'groups': [{'id': 'g1', 'name': '呼吸', 'items': [{'id': 'i1', 'name': '短呼吸', 'min': 0.5, 'sets': 1}]}]}}}
    context = browser.new_context()
    context.add_init_script(f'localStorage.setItem("lilypb_v2", {json.dumps(json.dumps(fixture))})')
    page = context.new_page()
    page.clock.install()
    page.goto(BASE)
    nav(page, 'practice')
    page.get_by_role('button', name='開始上課', exact=True).click()
    page.locator('[data-action="timer"]').click()
    page.clock.fast_forward(10000)
    expect(page.locator('#timer-value')).to_have_text('00:20')
    page.get_by_role('button', name='暫停計時').click()
    page.clock.fast_forward(60000)
    expect(page.locator('#timer-value')).to_have_text('00:20')
    page.get_by_role('button', name='繼續計時').click()
    page.clock.fast_forward(20000)
    expect(page.locator('.timer-bar')).to_have_count(0)
    expect(page.locator('.teaching-item.completed')).to_have_count(1)
    assert page.evaluate('JSON.parse(localStorage.getItem("lilypb_v2")).plans["2026-11-04"].progress.i1')
    context.close()

    context = browser.new_context()
    page = context.new_page()
    page.goto(BASE)
    page.evaluate('() => { Storage.prototype.setItem = () => {throw new DOMException("Quota exceeded", "QuotaExceededError")}; }')
    nav(page, 'library')
    page.get_by_role('button', name='新增動作', exact=True).first.click()
    unsafe_name = '<img src=x onerror="window.injected=true">'
    page.get_by_label('動作名稱', exact=True).fill(unsafe_name)
    page.get_by_role('button', name='儲存動作', exact=True).click()
    expect(page.locator('[role="alert"]')).to_contain_text('尚未成功儲存')
    expect(page.locator('#toast')).to_contain_text('尚未儲存')
    expect(page.get_by_role('heading', name=unsafe_name, exact=True)).to_be_visible()
    assert not page.evaluate('Boolean(window.injected)')
    assert page.evaluate('localStorage.getItem("lilypb_v2")') is None
    page.get_by_role('button', name='資料與設定', exact=True).first.click()
    with page.expect_download() as result:
        page.get_by_role('button', name='匯出完整備份').click()
    backup = json.loads(Path(result.value.path()).read_text())
    assert backup['lib'][-1]['name'] == unsafe_name
    context.close()
    print('PASS timer elapsed-time correction, pause/resume, auto completion, failed-save warnings, unsaved data export and HTML escaping')


if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
        for width, height in [(390, 844), (820, 1180), (1024, 768), (1440, 1000)]:
            workflow(browser, width, height)
        legacy_and_recovery(browser)
        timer_and_failed_writes(browser)
        browser.close()
