import { KEY, CATEGORIES, uid, dateKey, courseDate, courseKey, plansOnDate, parseDate, validDate, round, allItems, itemMinutes, groupMinutes, totalMinutes, completion, makeItem, newPlan, normalizeState, copyPlan, moveItem, loadState, TEMPLATES, templatePlan } from './model.js';
import cloudDefaults from './cloud-config.js';
import { CloudSync, CONFIG_KEY } from './cloud.js';
import pwaDefaults from './pwa-config.js';
import { setupPWA } from './pwa.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
let loaded = loadState({ getItem: key => localStorage.getItem(key) });
let state = loaded.state;
let storageError = loaded.error;
let saveFailed = false;
let cloud = null;
let pwa = null;
const cloudLabels = { local: '尚未登入雲端', connecting: '正在連接雲端…', pending: '本機已儲存，等待同步', syncing: '正在同步…', synced: '已同步到雲端', remote: '雲端有更新，稍後載入', conflict: '有不同版本，請處理', offline: '離線中，編輯保留於本機', error: '同步未完成，請重試' };
const saveLabel = () => storageError ? '本機資料需要處理' : saveFailed ? '尚未儲存，請匯出備份' : cloud?.user ? cloudLabels[cloud.status] : '儲存在此裝置';
let view = 'home';
let selectedDate = dateKey();
let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let search = '', studentSearch = '', category = '全部', pickerSearch = '', pickerCategory = '全部', activeGroup = null;
let modal = null, timer = null, toastTimeout;
let previousFocus = null;
const paths = {
  leaf: '<path d="M12 21V10m0 6C4 16 3 10 4 7c6 0 9 4 8 9Zm0-4c0-6 4-9 9-9 1 6-2 10-9 10M8 21h8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
  play: '<path d="m9 6 9 6-9 6Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M8 15h2m4 0h2"/>',
  people: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 3a4 4 0 0 1 0 8m3 3a7 7 0 0 1 3 6"/>',
  cloud: '<path d="M6 18a5 5 0 0 1-.5-10A7 7 0 0 1 19 9a4.5 4.5 0 0 1-.5 9Z"/><path d="m9 13 2 2 4-4"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dateLabel = (key, opts = { month: 'long', day: 'numeric', weekday: 'short' }) => parseDate(key).toLocaleDateString('zh-TW', opts);
const title = plan => plan.title || '未命名課程';
const button = (action, label, cls = 'button', attrs = '') => `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
const iconButton = (action, name, label, attrs = '') => button(action, icon(name), 'icon-button', `aria-label="${label}" title="${label}" ${attrs}`);
const badge = plan => `<span class="badge ${plan.done ? 'ready' : 'draft'}" data-status>${plan.done ? `${icon('check')} 已備妥` : '備課中'}</span>`;
const planAt = () => state.plans[selectedDate];
const empty = (heading, text, action = '') => `<div class="empty-state">${icon('leaf')}<h3>${heading}</h3><p>${text}</p>${action}</div>`;

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => element.classList.remove('visible'), 3200);
}
function save() {
  if (storageError) { toast('本機儲存尚未恢復，請先到「資料與設定」處理。'); return false; }
  try {
    if (cloud?.user) cloud.edit(state);
    else localStorage.setItem(KEY, JSON.stringify(state));
    saveFailed = false;
    document.querySelectorAll('[data-save-status]').forEach(el => el.textContent = saveLabel());
    return true;
  } catch {
    saveFailed = true;
    document.querySelectorAll('[data-save-status]').forEach(el => el.textContent = '尚未儲存，請匯出備份');
    toast('儲存失敗，可能是空間不足。請立即匯出備份，避免關閉後遺失。');
    return false;
  }
}
function shell(content) {
  const current = view === 'plan' ? 'home' : view;
  const tabs = [['home', 'grid', '備課總覽'], ['library', 'book', '動作資料庫'], ['students', 'people', '學生管理'], ['practice', 'play', '上課模式']];
  return `<div class="app-shell ${view === 'teaching' ? 'is-teaching' : ''}">
    <aside class="sidebar"><a href="#" class="brand" aria-label="Lily Prep 備課總覽">${icon('leaf')}<span>Lily Prep<small>皮拉提斯備課室</small></span></a>
      <div class="nav-label">YOUR WORKSPACE</div><nav aria-label="主要導覽">${tabs.map(([v, i, name]) => button('nav', `${icon(i)}<span>${name}</span>${v === current ? '<i></i>' : ''}`, `nav-item ${v === current ? 'active' : ''}`, `data-view="${v}" ${v === current ? 'aria-current="page"' : ''}`)).join('')}</nav>
      <div class="sidebar-note"><span class="note-spark">✳</span><p>用心準備，<br>讓身體自在流動。</p><span>ONE CLASS AT A TIME</span></div>
      ${button('settings', `${icon('settings')}<span>資料與設定</span>`, 'nav-item settings-nav')}
      <div class="local-note">${icon('check')}<span data-save-status>${saveLabel()}</span></div>
    </aside>
    <div class="workspace"><header class="topbar"><a href="#" class="mobile-brand brand">${icon('leaf')}<span>Lily Prep</span></a><span class="breadcrumb">我的備課室 <span>/</span> ${view === 'plan' ? '編排課程' : view === 'library' ? '動作資料庫' : view === 'students' ? '學生管理' : view === 'teaching' ? '正在上課' : view === 'practice' ? '上課模式' : '備課總覽'}</span><div class="top-actions"><span class="today-label">${dateLabel(dateKey(), { month: 'long', day: 'numeric', weekday: 'long' })}</span>${button('cloud', `${icon('cloud')}<span data-cloud-label>${cloud?.user ? cloudLabels[cloud.status] : '登入同步'}</span>`, 'cloud-top-button', 'aria-label="雲端帳號與同步"')}${iconButton('settings', 'settings', '資料與設定')}<span class="avatar" aria-hidden="true">L</span></div></header>
    ${storageError ? '<div class="warning" role="alert">本機資料無法讀取，已保留原始資料。請到「資料與設定」下載原始資料；處理前無法儲存新編輯。</div>' : ''}
    ${saveFailed ? '<div class="warning" role="alert">編輯尚未成功儲存，請到「資料與設定」匯出備份，避免關閉網頁後遺失。</div>' : ''}<main id="main">${content}</main><footer class="page-footer">${button('install', `<span data-pwa-update-note>${pwa?.state.updateAvailable ? '有新版本可更新' : '加入 iPhone／iPad 主畫面'}</span>`, 'text-button install-footer')}<span>LILY PREP</span> 為每一堂課，留一點從容。</footer></div>
    <nav class="bottom-nav" aria-label="手機導覽">${tabs.map(([v, i, name]) => button('nav', `${icon(i)}<span>${name}</span>`, current === v ? 'active' : '', `data-view="${v}" ${current === v ? 'aria-current="page"' : ''}`)).join('')}</nav>
  </div>`;
}
function render() {
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = focused?.selectionStart;
  const content = view === 'home' ? homeView() : view === 'library' ? libraryView() : view === 'students' ? studentsView() : view === 'plan' ? planView() : view === 'teaching' ? teachingView() : practiceView();
  app.innerHTML = shell(content);
  if (focusId && !dialog.open) {
    const element = document.getElementById(focusId);
    element?.focus({ preventScroll: true });
    if (selection != null && element?.setSelectionRange) element.setSelectionRange(selection, selection);
  }
}
function navigate(next) { stopTimer(); view = next; closeDialog(); render(); window.scrollTo({ top: 0 }); }
function openPlan(key) {
  selectedDate = key;
  month = new Date(parseDate(key).getFullYear(), parseDate(key).getMonth(), 1);
  if (!state.plans[key]) { state.plans[key] = newPlan(); save(); }
  activeGroup = state.plans[key].groups[0]?.id;
  pickerSearch = ''; pickerCategory = '全部';
  navigate('plan');
}
function openDialog(kind, content) {
  if (!dialog.open) previousFocus = document.activeElement;
  modal = kind;
  dialog.innerHTML = `<div class="dialog-head"><div>${content.heading || ''}</div>${iconButton('close-dialog', 'close', '關閉視窗')}</div>${content.body}`;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() { modal = null; if (dialog.open) { dialog.close(); previousFocus?.focus?.({ preventScroll: true }); } }
dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
dialog.addEventListener('cancel', () => { modal = null; });

function homeView() {
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const plans = Object.entries(state.plans).filter(([key]) => key.startsWith(monthPrefix));
  const finished = plans.filter(([, plan]) => plan.done).length;
  const minutes = round(plans.reduce((sum, [, plan]) => sum + totalMinutes(plan), 0));
  return `<section class="page-heading"><div><p class="eyebrow">A LITTLE PREPARATION, A LOT OF POSSIBILITY</p><h1>每一堂課，<span>從容開始。</span></h1><p class="intro">把靈感整理成課程，陪伴每一次專注的練習。</p></div>${button('new-plan', `${icon('plus')} 建立新課程`, 'button primary')}</section>
    <section class="stats-grid" aria-label="本月備課統計"><div class="stat-card"><span class="stat-icon sage">${icon('calendar')}</span><div><span>本月課程</span><p>${plans.length}<small>堂</small></p></div><span class="stat-detail">${month.getMonth() + 1} 月的教學日常</span></div><div class="stat-card"><span class="stat-icon peach">${icon('check')}</span><div><span>已完成備課</span><p>${finished}<small>堂</small></p></div><span class="stat-detail">${plans.length - finished ? `還有 ${plans.length - finished} 堂靈感待整理` : '照自己的節奏，慢慢準備'}</span></div><div class="stat-card"><span class="stat-icon lavender">${icon('clock')}</span><div><span>累積課程時間</span><p>${minutes}<small>分鐘</small></p></div><span class="stat-detail">每一分鐘，都是用心</span></div></section>
    <div class="home-grid"><section class="panel calendar-panel"><div class="section-head"><div><p class="eyebrow">YOUR SCHEDULE</p><h2>我的備課日曆</h2></div><div class="calendar-controls">${button('today', '今天', 'text-button')}${iconButton('month', 'back', '上個月', 'data-delta="-1"')}<strong>${month.getFullYear()} 年 ${month.getMonth() + 1} 月</strong>${iconButton('month', 'arrow', '下個月', 'data-delta="1"')}</div></div>${calendarView()}<div class="calendar-legend"><span><i class="dot ready"></i>已備妥</span><span><i class="dot draft"></i>備課中</span><span class="legend-hint">選個日子，開始準備下一堂課</span></div></section>
    <aside class="day-panel panel">${selectedDayView()}</aside></div>
    <section class="template-section"><div class="section-head"><div><p class="eyebrow">A GENTLE START</p><h2>從一個靈感開始</h2></div><span class="muted">套用範本，再調整成你的課程</span></div><div class="template-grid">${TEMPLATES.map((template, index) => `<button type="button" class="template-card ${template.tone}" data-action="template" data-index="${index}"><span class="template-art" aria-hidden="true">${index === 0 ? '<i class="arch arch-one"></i><i class="arch arch-two"></i>' : index === 1 ? '<i class="circle circle-one"></i><i class="circle circle-two"></i>' : '<i class="wave wave-one"></i><i class="wave wave-two"></i>'}</span><span class="template-time">${template.target} MIN</span><strong>${template.title}</strong><span>${template.subtitle.split(' · ')[1]}</span><span class="template-link">使用這份範本 ${icon('arrow')}</span></button>`).join('')}</div></section>`;
}
function calendarView() {
  const start = (month.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((start + count) / 7) * 7;
  let result = '<div class="calendar-grid" role="group" aria-label="課程日曆">' + '一二三四五六日'.split('').map(day => `<div class="weekday">${day}</div>`).join('');
  for (let index = 0; index < cells; index++) {
    const day = new Date(month.getFullYear(), month.getMonth(), index - start + 1);
    const key = dateKey(day), entries = plansOnDate(state, key), plan = entries[0]?.[1], outside = day.getMonth() !== month.getMonth();
    const ready = entries.every(([, plan]) => plan.done);
    result += `<button type="button" class="calendar-day ${outside ? 'outside' : ''} ${key === courseDate(selectedDate) ? 'selected' : ''} ${key === dateKey() ? 'today' : ''}" data-action="select-date" data-date="${key}" aria-label="${dateLabel(key, { year: 'numeric', month: 'long', day: 'numeric' })}${plan ? `，${entries.length} 堂課，${ready ? '已備妥' : '備課中'}` : '，尚無課程'}" aria-pressed="${key === courseDate(selectedDate)}" ${key === dateKey() ? 'aria-current="date"' : ''}><span>${day.getDate()}</span>${plan ? `<small class="calendar-plan ${ready ? 'ready' : 'draft'}">${entries.length > 1 ? `${entries.length} 堂課程` : esc(title(plan))}</small><i class="dot ${ready ? 'ready' : 'draft'}"></i>` : ''}</button>`;
  }
  return result + '</div>';
}
function selectedDayView() {
  const entries = plansOnDate(state, selectedDate);
  return `<div class="section-head"><div><p class="eyebrow">${courseDate(selectedDate) === dateKey() ? 'TODAY' : 'SELECTED DAY'}</p><h2>${dateLabel(selectedDate, { month: 'long', day: 'numeric' })}<small class="day-week">${dateLabel(selectedDate, { weekday: 'long' })}</small></h2></div><span class="day-flower" aria-hidden="true">✳</span></div>${entries.length ? entries.map(([key, plan]) => `<article class="day-course">${badge(plan)}<h3>${esc(title(plan))}</h3><p>${icon('pin')}${esc(plan.loc || '尚未設定地點')}</p><p>${icon('clock')}${plan.time ? plan.time + ' · ' : ''}${totalMinutes(plan)} 分鐘 <span>·</span> ${allItems(plan).length} 個動作</p>${plan.studentIds.length ? `<p>${icon('people')}${plan.studentIds.map(id => esc(state.students.find(s => s.id === id)?.name || '')).join('、')}</p>` : ''}<div class="mini-groups">${plan.groups.map((group, index) => `<div><i class="group-dot tone-${index % 3}"></i><span>${esc(group.name)}</span><small>${groupMinutes(group)} 分</small></div>`).join('')}</div>${button('edit-date', `繼續編排 ${icon('arrow')}`, 'button primary full', `data-date="${key}"`)}${plan.done ? button('teach', `${icon('play')} 開始上課`, 'button secondary full', `data-date="${key}"`) : ''}</article>`).join('') + button('new-plan', `${icon('plus')} 再安排一堂課`, 'button secondary full') : empty('今天的留白，留給靈感', '還沒有安排課程。\n從一個動作、一口呼吸開始。', button('edit-date', `${icon('plus')} 為這天備課`, 'button secondary', `data-date="${selectedDate}"`))}<div class="day-footnote">${icon('leaf')} 一點準備，讓教學多一點餘裕。</div>`;
}
function planView() {
  const plan = planAt();
  return `<div class="editor-top">${button('nav', `${icon('back')} 備課總覽`, 'text-button', 'data-view="home"')}<span class="save-label">${icon('check')}<span data-save-status>${saveLabel()}</span></span></div>
    <section class="page-heading compact"><div><p class="eyebrow">MAKE ROOM FOR MOVEMENT</p><h1>${dateLabel(selectedDate)}<span class="heading-badge">${badge(plan)}</span></h1></div><div class="heading-actions">${iconButton('copy-plan', 'copy', '複製課程到其他日期')}${button('finish', `${icon('check')} 完成備課`, 'button primary')}</div></section>
    <div class="editor-grid"><div class="plan-content"><section class="panel plan-info"><label class="field-label" for="plan-title">課程名稱</label><input id="plan-title" class="title-input" data-field="title" value="${esc(plan.title)}" placeholder="為這堂課取個名字，例如：溫柔核心流動" maxlength="100"><div class="info-fields schedule-fields"><label>上課地點<select data-field="loc" aria-label="上課地點"><option value="">選擇地點</option>${[...new Set([...state.locs, ...(plan.loc ? [plan.loc] : [])])].map(loc => `<option ${loc === plan.loc ? 'selected' : ''}>${esc(loc)}</option>`).join('')}</select></label><label>上課時間<input type="time" data-field="time" aria-label="上課時間" value="${plan.time}"></label><label>目標時長（分鐘）<input type="number" min="1" max="600" step="1" inputmode="numeric" data-field="target" aria-label="目標時長（分鐘）" value="${plan.target}"></label></div><label class="field-label" for="plan-loc-note">地點／器材備註</label><input id="plan-loc-note" data-field="locNote" placeholder="例如：3 樓教室，準備彈力帶與小球" value="${esc(plan.locNote)}"><div class="duration-summary"><div>${icon('clock')}<span>已安排 <strong data-total>${totalMinutes(plan)}</strong> / <span data-target>${plan.target}</span> 分鐘</span><span class="duration-remaining" data-remaining>${remainingLabel(plan)}</span></div><div class="duration-track" aria-hidden="true">${durationSegments(plan)}</div></div></section>
    <section class="panel plan-students"><div class="section-head"><h2>${icon('people')} 這堂課的學生</h2>${button('assign-students', '選擇學生', 'text-button')}</div>${plan.studentIds.length ? plan.studentIds.map(id => { const student = state.students.find(student => student.id === id); return student ? `<div class="assigned-student"><span class="student-avatar">${esc(student.name.slice(0, 1))}</span><div><strong>${esc(student.name)}</strong><p>${esc(student.goal || '尚未設定學習目標')}</p>${student.notes ? `<small>${esc(student.notes)}</small>` : ''}</div></div>` : ''; }).join('') : '<p class="muted">關聯學生，備課時一起查看學習目標與提醒。</p>'}</section>
    <div class="section-head flow-head"><h2>課程流程 <span class="count" data-item-count>${allItems(plan).length} 個動作</span></h2><span class="muted">用上下箭頭調整動作順序</span></div>
    ${plan.groups.map((group, index) => groupView(group, index)).join('')}
    ${button('add-group', `${icon('plus')} 新增課程階段`, 'button add-group full')}
    <section class="panel notes-panel"><label for="plan-notes">${icon('book')} 給自己的教學筆記</label><textarea id="plan-notes" data-field="notes" rows="3" placeholder="記下口令、學生需要留意的地方，或今天想傳達的感受…">${esc(plan.notes)}</textarea></section>
    <div class="editor-bottom">${button('delete-plan', `${icon('trash')} 刪除此課程`, 'text-button danger')}${button('finish', `${icon('check')} 完成備課`, 'button primary')}</div></div>
    <aside class="panel picker-sidebar"><div class="section-head"><div><p class="eyebrow">YOUR MOVEMENT LIBRARY</p><h2>加入一點新靈感</h2></div>${icon('book')}</div><p class="muted">從動作庫選擇，加入課程流程。</p><label class="field-label" for="target-group">加入階段</label><select id="target-group" data-field="active-group">${plan.groups.map(group => `<option value="${group.id}" ${group.id === activeGroup ? 'selected' : ''}>${esc(group.name)}</option>`).join('')}</select>${pickerContent()}<p class="picker-note">動作加入後可單獨調整，<br>不會更動動作庫的預設內容。</p></aside></div>`;
}
function remainingLabel(plan) {
  const diff = round(plan.target - totalMinutes(plan));
  return diff > 0 ? `還有 ${diff} 分鐘可安排` : diff < 0 ? `超出 ${-diff} 分鐘` : '時間剛剛好';
}
function durationSegments(plan) {
  const base = Math.max(plan.target, totalMinutes(plan));
  return plan.groups.map((group, index) => `<span class="tone-${index % 3}" style="width:${groupMinutes(group) / base * 100}%"></span>`).join('');
}
function groupView(group, index) {
  return `<section class="panel group-panel tone-border-${index % 3}" data-group-panel="${group.id}"><div class="group-head"><span class="group-number tone-${index % 3}">${String(index + 1).padStart(2, '0')}</span><input aria-label="第 ${index + 1} 階段名稱" data-field="group-name" data-group="${group.id}" value="${esc(group.name)}" maxlength="80"><span class="group-duration" data-group-total="${group.id}">${groupMinutes(group)} 分</span>${iconButton('delete-group', 'trash', '刪除階段', `data-group="${group.id}"`)}</div><div class="group-items">${group.items.map((item, i) => `<article class="exercise-row"><div class="exercise-order"><span>${String(i + 1).padStart(2, '0')}</span><div>${iconButton('move', 'up', `向上移動 ${esc(item.name)}`, `data-group="${group.id}" data-item="${item.id}" data-direction="-1" ${i === 0 ? 'disabled' : ''}`)}${iconButton('move', 'down', `向下移動 ${esc(item.name)}`, `data-group="${group.id}" data-item="${item.id}" data-direction="1" ${i === group.items.length - 1 ? 'disabled' : ''}`)}</div></div><div class="exercise-content"><div class="exercise-name-row"><input aria-label="動作名稱" data-field="item-name" data-group="${group.id}" data-item="${item.id}" value="${esc(item.name)}" maxlength="100">${iconButton('delete-item', 'close', `移除 ${esc(item.name)}`, `data-group="${group.id}" data-item="${item.id}"`)}</div><div class="exercise-details"><label><input type="number" min="1" max="100" step="1" inputmode="numeric" aria-label="${esc(item.name)} 組數" data-field="item-sets" data-group="${group.id}" data-item="${item.id}" value="${item.sets}"> 組</label><span class="muted">×</span><label><input type="number" min="0" max="600" step="0.5" inputmode="decimal" aria-label="${esc(item.name)} 每組分鐘" data-field="item-min" data-group="${group.id}" data-item="${item.id}" value="${item.min}"> 分／組</label><strong data-item-total="${item.id}">${itemMinutes(item)} 分</strong></div><input class="exercise-note" aria-label="${esc(item.name)} 備註" data-field="item-note" data-group="${group.id}" data-item="${item.id}" placeholder="加入口令、次數或注意事項…" value="${esc(item.note)}"></div></article>`).join('') || '<p class="group-empty">留一點空間，加入適合這堂課的動作。</p>'}</div>${button('pick', `${icon('plus')} 加入動作`, 'button group-add', `data-group="${group.id}"`)}</section>`;
}
function filteredLibrary(query, cat) { return state.lib.filter(exercise => (cat === '全部' || exercise.category === cat) && `${exercise.name} ${exercise.note}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())); }
function categoryChips(active, action) { return `<div class="chips" role="group" aria-label="動作分類">${['全部', ...CATEGORIES].map(cat => button(action, cat, `chip ${active === cat ? 'selected' : ''}`, `data-category="${cat}" aria-pressed="${active === cat}"`)).join('')}</div>`; }
function pickerContent(inDialog = false) {
  const list = filteredLibrary(pickerSearch, pickerCategory);
  return `<div class="search-field">${icon('search')}<input id="${inDialog ? 'dialog-' : ''}picker-search" data-search="picker" aria-label="搜尋可加入的動作" placeholder="找一個動作…" value="${esc(pickerSearch)}"></div>${categoryChips(pickerCategory, 'picker-category')}<div class="picker-list">${list.map(exercise => `<button type="button" class="pick-exercise" data-action="add-exercise" data-id="${exercise.id}" ${!planAt()?.groups.length ? 'disabled' : ''}><span class="exercise-symbol ${categoryTone(exercise.category)}">${icon(exercise.category === '呼吸' ? 'leaf' : 'spark')}</span><span><strong>${esc(exercise.name)}</strong><small>${esc(exercise.category)} · ${exercise.min} 分／組</small></span><span class="pick-plus">${icon('plus')}</span></button>`).join('') || '<p class="no-results">找不到符合的動作，試試其他關鍵字。</p>'}</div>`;
}
function categoryTone(cat) { return ['呼吸', '暖身'].includes(cat) ? 'sage' : ['核心', '全身'].includes(cat) ? 'lavender' : 'peach'; }
function studentsView() {
  const students = state.students.filter(student => `${student.name} ${student.goal}`.toLocaleLowerCase().includes(studentSearch.trim().toLocaleLowerCase()));
  return `<section class="page-heading"><div><p class="eyebrow">EVERY BODY HAS A STORY</p><h1>記住每一次，<span>小小的進步。</span></h1><p class="intro">整理學習目標、教學提醒，讓每堂課多一點理解。</p></div>${button('new-student', `${icon('plus')} 新增學生`, 'button primary')}</section><div class="library-toolbar"><div class="search-field">${icon('search')}<input id="student-search" data-search="students" value="${esc(studentSearch)}" placeholder="搜尋學生姓名或學習目標…" aria-label="搜尋學生"></div><span class="muted">${state.students.length} 位學生 · ${cloud?.user ? '雲端帳號資料' : '目前儲存在此裝置'}</span></div><div class="library-grid">${students.map(student => {
    const courses = Object.entries(state.plans).filter(([, plan]) => plan.studentIds.includes(student.id));
    const completed = courses.filter(([, plan]) => completion(plan) === 100).length;
    return `<article class="panel student-card"><div class="section-head"><span class="student-avatar">${esc(student.name.slice(0, 1))}</span>${button('edit-student', '編輯', 'text-button', `data-id="${student.id}"`)}</div><h2>${esc(student.name)}</h2><p class="student-goal">${esc(student.goal || '還沒有設定學習目標')}</p><p class="student-notes">${esc(student.notes || '在這裡記下想為這位學生留意的事。')}</p><div class="student-card-bottom"><small>關聯 ${courses.length} 堂課 · 已練習 ${completed} 堂</small>${button('student-history', `課程紀錄 ${icon('arrow')}`, 'text-button', `data-id="${student.id}"`)}</div></article>`;
  }).join('')}</div>${!students.length ? empty(state.students.length ? '還沒找到這位學生' : '從認識一個人開始', '新增學生後，就能把課程與學習目標放在一起。', button('new-student', `${icon('plus')} 新增學生`, 'button secondary')) : ''}<p class="page-hint">學生資料會包含在匯出備份中，請保存在你信任的地方。</p>`;
}
function studentDialog(id = '') {
  const student = state.students.find(student => student.id === id);
  openDialog('student', { heading: `<p class="eyebrow">EVERY BODY HAS A STORY</p><h2 id="dialog-title">${student ? '編輯' : '新增'}學生</h2>`, body: `<form data-form="student" data-id="${id}" class="dialog-form"><label>姓名／稱呼<input name="name" value="${esc(student?.name || '')}" placeholder="你習慣怎麼稱呼這位學生？" maxlength="100" required></label><label>學習目標<input name="goal" value="${esc(student?.goal || '')}" placeholder="例如：建立核心穩定、改善身體覺察" maxlength="300"></label><label>教學提醒與觀察<textarea name="notes" rows="4" placeholder="記下適合的引導方式，以及課後的觀察…">${esc(student?.notes || '')}</textarea></label><button type="submit" class="button primary full">${icon('check')} 儲存學生資料</button>${student ? button('delete-student', `${icon('trash')} 刪除學生`, 'text-button danger full', `data-id="${id}"`) : ''}</form>` });
}
function assignStudentsDialog() {
  openDialog('assign-students', { heading: '<h2 id="dialog-title">這堂課，陪伴誰一起練習？</h2>', body: state.students.length ? `<form data-form="assign-students" class="dialog-form"><div class="student-options">${state.students.map(student => `<label><input type="checkbox" name="students" value="${student.id}" ${planAt().studentIds.includes(student.id) ? 'checked' : ''}><span><strong>${esc(student.name)}</strong><small>${esc(student.goal)}</small></span></label>`).join('')}</div><button type="submit" class="button primary full">${icon('check')} 儲存選擇</button></form>` : `<p class="muted">先新增學生，再回到課程選擇學生。</p>${button('new-student', `${icon('plus')} 新增學生`, 'button primary full')}` });
}
function studentHistory(id) {
  const student = state.students.find(student => student.id === id);
  const courses = Object.entries(state.plans).filter(([, plan]) => plan.studentIds.includes(id)).sort(([a], [b]) => b.localeCompare(a));
  openDialog('student-history', { heading: `<p class="eyebrow">LEARNING TOGETHER</p><h2 id="dialog-title">${esc(student.name)}的課程紀錄</h2>`, body: `<div class="student-history">${courses.map(([key, plan]) => `<button type="button" class="history-course" data-action="edit-date" data-date="${key}"><div><small>${dateLabel(key)}</small><strong>${esc(title(plan))}</strong><span>${totalMinutes(plan)} 分鐘 · 已練習 ${completion(plan)}%</span></div>${icon('arrow')}</button>`).join('') || '<p class="muted">還沒有關聯的課程。在編排課程時選擇這位學生，就會顯示在這裡。</p>'}</div>` });
}
function libraryView() {
  const list = filteredLibrary(search, category);
  return `<section class="page-heading"><div><p class="eyebrow">A COLLECTION OF MOVEMENT</p><h1>動作資料庫<span class="heading-count">${state.lib.length}</span></h1><p class="intro">收藏熟悉的動作，累積屬於你的教學語彙。</p></div>${button('new-exercise', `${icon('plus')} 新增動作`, 'button primary')}</section><div class="library-toolbar"><div class="search-field">${icon('search')}<input id="library-search" data-search="library" placeholder="搜尋動作名稱、口令或備註…" aria-label="搜尋動作" value="${esc(search)}"></div>${categoryChips(category, 'category')}</div><div class="library-grid">${list.map(exercise => `<article class="panel library-card"><div class="section-head"><span class="exercise-symbol ${categoryTone(exercise.category)}">${icon(exercise.category === '呼吸' ? 'leaf' : 'spark')}</span><span class="category-label">${esc(exercise.category)}</span></div><h2>${esc(exercise.name)}</h2><p>${esc(exercise.note || '為熟悉的動作，留下一句教學提示。')}</p><div class="library-card-bottom"><span>${icon('clock')}${exercise.min} 分／組</span>${button('edit-exercise', '編輯動作', 'text-button', `data-id="${exercise.id}"`)}</div></article>`).join('')}</div>${!list.length ? empty('還沒找到這個動作', '試試其他關鍵字，或新增你的專屬動作。', button('new-exercise', `${icon('plus')} 新增動作`, 'button secondary')) : ''}<p class="page-hint">動作庫中的調整只會套用到之後新增的動作，已編排的課程會保留原樣。</p>`;
}
function practiceView() {
  const plans = Object.entries(state.plans).filter(([, plan]) => plan.done).sort(([a], [b]) => b.localeCompare(a));
  return `<section class="page-heading"><div><p class="eyebrow">BE PRESENT, MOVE WITH EASE</p><h1>把專注，<span>留給當下。</span></h1><p class="intro">選一堂已備妥的課程，逐項帶領練習與計時。</p></div></section><div class="practice-grid">${plans.map(([key, plan]) => `<article class="panel practice-card"><div class="section-head"><span class="practice-date">${dateLabel(key)}</span>${badge(plan)}</div><h2>${esc(title(plan))}</h2><p class="muted">${esc(plan.loc || '尚未設定地點')} · ${totalMinutes(plan)} 分鐘 · ${allItems(plan).length} 個動作</p><div class="progress-track"><span style="width:${completion(plan)}%"></span></div><div class="practice-card-bottom"><small>已練習 ${completion(plan)}%</small>${button('teach', `${icon('play')} 開始上課`, 'button primary', `data-date="${key}"`)}</div></article>`).join('')}</div>${!plans.length ? empty('下一堂好課，從備課開始', '完成課程編排並標記「完成備課」，\n就能在這裡開啟上課模式。', button('nav', '回到備課總覽', 'button secondary', 'data-view="home"')) : ''}`;
}
function teachingView() {
  const plan = planAt();
  return `<div class="editor-top">${button('nav', `${icon('back')} 退出上課`, 'text-button', 'data-view="practice"')}${button('reset-progress', '重新練習', 'text-button')}</div><section class="teaching-heading"><p class="eyebrow">STAY IN THE MOMENT</p><h1>${esc(title(plan))}</h1><p class="muted">${dateLabel(selectedDate)}${plan.time ? ' · ' + plan.time : ''} · ${esc(plan.loc || '尚未設定地點')} · ${totalMinutes(plan)} 分鐘</p>${plan.locNote ? `<p class="teaching-loc-note">${icon('pin')}${esc(plan.locNote)}</p>` : ''}<div class="teaching-progress"><span>${completion(plan) === 100 ? '這堂課，圓滿完成。' : '跟著自己的節奏，一步一步。'}</span><strong>${completion(plan)}<small>%</small></strong></div><div class="progress-track"><span style="width:${completion(plan)}%"></span></div></section><div class="teaching-groups">${plan.groups.map((group, index) => `<section class="panel"><div class="group-head"><span class="group-number tone-${index % 3}">${String(index + 1).padStart(2, '0')}</span><h2>${esc(group.name)}</h2><span class="group-duration">${groupMinutes(group)} 分</span></div>${group.items.map(item => `<div class="teaching-item ${plan.progress[item.id] ? 'completed' : ''}">${button('toggle-progress', plan.progress[item.id] ? icon('check') : '', 'check-button', `data-item="${item.id}" aria-label="${plan.progress[item.id] ? '取消完成' : '完成'} ${esc(item.name)}" aria-pressed="${!!plan.progress[item.id]}"`)}<div><h3>${esc(item.name)}</h3><p>${item.sets} 組 × ${item.min} 分鐘${item.note ? ` · ${esc(item.note)}` : ''}</p></div>${button('timer', `${icon('clock')} ${itemMinutes(item)} 分`, 'button secondary timer-start', `data-item="${item.id}"`)}</div>`).join('')}</section>`).join('')}</div>${plan.notes ? `<section class="panel teaching-notes"><h2>${icon('book')} 教學筆記</h2><p>${esc(plan.notes)}</p></section>` : ''}${timerView()}`;
}
function timerView() {
  if (!timer) return '';
  const item = allItems(planAt()).find(item => item.id === timer.id);
  return `<section class="timer-bar" aria-label="動作計時器"><div><span>${esc(item.name)}</span><strong id="timer-value" role="timer">${formatTime(timeLeft())}</strong></div><div class="timer-actions">${iconButton('timer-pause', timer.running ? 'pause' : 'play', timer.running ? '暫停計時' : '繼續計時')}${button('timer-done', `${icon('check')} 完成`, 'button timer-done')}${iconButton('timer-stop', 'close', '取消計時')}</div></section>`;
}
function formatTime(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function timeLeft() { return timer ? (timer.running ? Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000)) : timer.left) : 0; }
function stopTimer() { if (timer) clearInterval(timer.interval); timer = null; }
function tick() {
  if (!timer?.running) return;
  const left = timeLeft();
  const value = document.querySelector('#timer-value');
  if (value) value.textContent = formatTime(left);
  if (!left) { planAt().progress[timer.id] = true; stopTimer(); save(); render(); navigator.vibrate?.([200, 100, 200]); toast('這個動作已完成，做得很好。'); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

function newPlanDialog(templateIndex = '') {
  const template = templateIndex === '' ? '' : TEMPLATES[Number(templateIndex)];
  openDialog('new-plan', { heading: '<p class="eyebrow">A NEW POSSIBILITY</p><h2 id="dialog-title">準備一堂新課程</h2>', body: `<form data-form="new-plan" class="dialog-form"><label>課程日期<input name="date" type="date" value="${courseDate(selectedDate)}" min="1900-01-01" max="9999-12-31" required></label><label>課程名稱<input name="title" maxlength="100" placeholder="例如：溫柔核心流動" value="${esc(template?.title || '')}"></label><label>開始方式<select name="template"><option value="">空白課程，從頭開始</option>${TEMPLATES.map((t, i) => `<option value="${i}" ${String(i) === String(templateIndex) ? 'selected' : ''}>${t.title} · ${t.target} 分鐘</option>`).join('')}</select></label><p class="muted">同一天可以安排多堂課；每堂課都能獨立編排與記錄進度。</p><button class="button primary full" type="submit">${icon('plus')} 開始編排</button></form>` });
}
function exerciseDialog(id = '') {
  const exercise = state.lib.find(item => item.id === id);
  openDialog('exercise', { heading: `<p class="eyebrow">YOUR MOVEMENT LIBRARY</p><h2 id="dialog-title">${exercise ? '編輯' : '新增'}動作</h2>`, body: `<form data-form="exercise" data-id="${id}" class="dialog-form"><label>動作名稱<input name="name" value="${esc(exercise?.name || '')}" placeholder="例如：肩橋" required maxlength="100"></label><div class="info-fields"><label>分類<select name="category">${CATEGORIES.map(cat => `<option ${cat === exercise?.category ? 'selected' : ''}>${cat}</option>`).join('')}</select></label><label>預設分鐘／組<input name="min" type="number" inputmode="decimal" min="0" max="600" step="0.5" value="${exercise?.min ?? 3}" required></label></div><label>教學提示<textarea name="note" rows="3" placeholder="記下呼吸節奏、口令或注意事項…">${esc(exercise?.note || '')}</textarea></label><button type="submit" class="button primary full">${icon('check')} 儲存動作</button>${exercise ? button('delete-exercise', `${icon('trash')} 刪除此動作`, 'text-button danger full', `data-id="${id}"`) : ''}</form>` });
}
function copyDialog() { openDialog('copy', { heading: '<h2 id="dialog-title">讓好課程，延續到下一次</h2>', body: `<form data-form="copy" class="dialog-form"><p class="muted">複製課程內容，並重設備課狀態與練習進度。</p><label>複製到哪一天？<input name="date" type="date" value="${dateKey(new Date(+parseDate(selectedDate) + 86400000))}" required min="1900-01-01" max="9999-12-31"></label><button class="button primary full" type="submit">${icon('copy')} 複製課程</button></form>` }); }
function settingsDialog() {
  openDialog('settings', { heading: '<p class="eyebrow">KEEP YOUR IDEAS SAFE</p><h2 id="dialog-title">資料與設定</h2>', body: `<div class="settings-content"><section class="install-settings"><h3>你的隨身備課 App</h3><p class="muted">加入 iPhone／iPad 主畫面，隨時開啟自己的備課室。</p>${button('install', '加入主畫面與 App 更新', 'button secondary full')}</section><section><h3>備份與雲端同步</h3><p class="muted">${cloud?.user ? '登入同一個帳號，就能在手機、平板與電腦共用資料。請確認顯示「已同步到雲端」，再切換裝置。' : '目前使用本機備課。登入雲端帳號後，可在手機、平板與電腦共用資料；原本的本機資料會保留。'} 無論是否使用同步，都可以另外匯出備份。</p>${button('cloud', `${icon('cloud')} ${cloud?.user ? '查看同步與帳號' : '啟用跨裝置同步'}`, 'button secondary full')}<div class="settings-buttons">${button('export', `${icon('download')} 匯出完整備份`, 'button secondary')}<label class="button secondary upload-label">${icon('upload')} 匯入備份<input id="import-file" type="file" accept=".json,application/json" aria-label="選擇 JSON 備份檔案"></label></div><p class="muted small">可讀取初版 pilates_prep_v1 的 JSON 資料。匯入會先檢查格式，再請你確認是否取代目前資料。</p>${loaded.migrated ? '<p class="migration-note">已讀取同一網站上的初版資料；初版原始儲存內容會保留。</p>' : ''}${storageError ? `<div class="warning"><p>${esc(storageError)}</p><div class="settings-buttons">${button('export-raw', '下載原始資料', 'button secondary')}${button('recover-storage', '以目前資料重新啟用儲存', 'button secondary')}</div></div>` : ''}</section><section><h3>上課地點 <span class="count">${state.locs.length}</span></h3><form data-form="location" class="location-form"><input name="location" placeholder="新增工作室或教室" aria-label="新增地點名稱" maxlength="100" required><button type="submit" class="button primary">${icon('plus')} 新增</button></form><div class="locations">${state.locs.map((loc, index) => `<div>${icon('pin')}<span>${esc(loc)}</span>${iconButton('delete-location', 'close', `移除 ${esc(loc)}`, `data-index="${index}"`)}</div>`).join('') || '<p class="muted">尚未新增地點。</p>'}</div></section><p class="version-note">Lily Prep 2.0 · 延伸自你的皮拉提斯備課初版</p></div>` });
}
function installMessage() {
  if (!pwa?.state.enabled || !pwa.state.supported) return '正式網站以 HTTPS 上線後，可準備離線使用。';
  if (!pwa.state.ready) return '正在準備離線使用，請保持連線，稍候再查看。';
  return pwa.state.offline ? '目前離線：可以開啟備課室，雲端同步會等待網路恢復。' : '已準備好離線開啟。雲端資料請先確認同步完成。';
}
function installDialog() {
  openDialog('install', { heading: '<p class="eyebrow">A LITTLE ROOM ON YOUR HOME SCREEN</p><h2 id="dialog-title">把備課室，放進主畫面</h2>', body: `<div class="install-content"><div class="install-app"><img src="./assets/apple-touch-icon.png" width="64" height="64" alt="Lily Prep App 圖示"><div><strong>Lily Prep</strong><p>你的隨身皮拉提斯備課室</p></div></div>${pwa?.state.standalone ? '<p class="installed-note">✓ 你已從主畫面開啟備課室。</p>' : '<p class="muted">在 iPhone 或 iPad，用 Safari 開啟新版網站，再照下面三步操作。不需要到 App Store 下載。</p>'}<ol class="install-steps"><li><span>${icon('upload')}</span><div><strong>打開 Safari 的「分享」選單</strong><p>點選方框向上箭頭的分享按鈕；部分版本位於更多選單內。</p></div></li><li><span>${icon('plus')}</span><div><strong>選擇「加入主畫面」</strong><p>若沒有看到，向下捲動分享選單尋找。</p></div></li><li><span>${icon('check')}</span><div><strong>按「加入」，開啟 Lily Prep</strong><p>若有「以網頁 App 打開」選項，請保持開啟。</p></div></li></ol><div class="install-readiness" role="status"><strong>離線使用狀態</strong><p data-pwa-status>${installMessage()}</p></div><p class="muted install-data-note">加入主畫面後，可能需要重新登入。先在原本瀏覽器完成雲端同步或匯出備份，再於 App 登入同一帳號，帶入你的資料。</p><div class="settings-buttons">${button('pwa-check', '檢查 App 版本', 'button secondary')}${button('pwa-update', '更新並重新開啟', 'button primary', `data-pwa-update ${pwa?.state.updateAvailable ? '' : 'hidden'}`)}</div><p class="muted small">離線開啟需要先連網成功開啟一次。計時器在 App 被系統關閉後不會繼續執行。</p></div>` });
}
function updatePWAStatus() {
  document.querySelectorAll('[data-pwa-status]').forEach(el => el.textContent = installMessage());
  document.querySelectorAll('[data-pwa-update]').forEach(el => el.hidden = !pwa?.state.updateAvailable);
  document.querySelectorAll('[data-pwa-update-note]').forEach(el => el.textContent = pwa?.state.updateAvailable ? '有新版本可更新' : '加入 iPhone／iPad 主畫面');
}
function cloudDialog() {
  const config = cloud.api?.config;
  const connected = !!cloud.user;
  const recovery = connected ? cloud.recovery() : null;
  openDialog('cloud', { heading: '<p class="eyebrow">YOUR CLASSES, EVERYWHERE</p><h2 id="dialog-title">讓備課，跟著你一起走</h2>', body: `<div class="cloud-content"><p class="muted">手機、平板與電腦登入同一個帳號，就能共用課表、動作庫與學生紀錄。</p><div class="cloud-status-card"><span class="cloud-status-icon">${icon('cloud')}</span><div><strong data-cloud-account-status>${cloudLabels[cloud.status]}</strong><p>${connected ? esc(cloud.user.email) : '未登入時，仍可使用本機備課。'}</p></div></div><p class="cloud-error" data-cloud-error role="status">${esc(cloud.message)}</p>${connected ? `<div class="settings-buttons">${button('cloud-sync', '立即同步', 'button primary')}${button('cloud-signout', '登出', 'button secondary')}</div><div class="cloud-conflict" data-cloud-conflict ${cloud.status === 'conflict' ? '' : 'hidden'}><h3>另一台裝置有不同的編輯</h3><p>先匯出備份，再選擇要保留的版本。取代前會在這個瀏覽器保留雙方的備份。</p><div class="settings-buttons">${button('export', '下載目前版本', 'button secondary')}${button('cloud-use-remote', '改用雲端版本', 'button secondary')}${button('cloud-use-local', '以目前版本取代雲端', 'button secondary')}</div></div><section class="cloud-migration"><h3>把原本的備課帶到帳號裡</h3><p class="muted">本機備課與帳號資料分開保存，不會在登入時自動混在一起。</p>${button('cloud-migrate', `${icon('upload')} 搬入這台裝置原本的備課`, 'button secondary full')}<p class="muted small">這會取代目前帳號的內容，請先匯出備份。</p></section>${recovery ? `<section><h3>同步取代前的備份</h3><div class="settings-buttons">${button('cloud-recovery-local', '下載取代前的本機版本', 'button secondary')}${button('cloud-recovery-remote', '下載取代前的雲端版本', 'button secondary')}</div></section>` : ''}` : `${config ? `<form data-form="cloud-auth" class="dialog-form"><label>Email<input name="email" type="email" autocomplete="username" placeholder="你的 Email" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" minlength="8" placeholder="至少 8 個字元" required></label><div class="settings-buttons"><button type="submit" name="mode" value="login" class="button primary">登入帳號</button><button type="submit" name="mode" value="signup" class="button secondary">註冊新帳號</button></div><p class="muted small">註冊後可能需要到信箱完成驗證。密碼只會傳送至你設定的 Supabase，不會保存在備課資料或備份中。</p></form>${button('cloud-retry', '恢復登入連線', 'text-button')}` : '<div class="cloud-setup-note"><h3>先連接一個 Supabase 專案</h3><p>專案建立好後，填入下方公開連線資訊。完成一次網站部署設定後，每個裝置就只需要登入。</p></div>'}<details class="cloud-config-details" ${config ? '' : 'open'}><summary>專案連線設定（首次設定）</summary><form data-form="cloud-config" class="dialog-form"><label>Supabase 專案網址<input name="url" type="url" placeholder="https://專案代碼.supabase.co" value="${esc(config?.url || '')}" required autocapitalize="none" spellcheck="false"></label><label>公開 publishable key 或 anon key<textarea name="publicKey" rows="3" placeholder="sb_publishable_…" required autocapitalize="none" spellcheck="false">${esc(config?.publicKey || '')}</textarea></label><p class="muted small">此處只接受公開金鑰。不要填入 secret 或 service_role 金鑰。請先依專案內的雲端啟用說明建立資料表。</p><button type="submit" class="button secondary full">儲存連線設定</button></form></details>`}</div>` });
}
function updateCloudStatus() {
  if (!cloud) return;
  app.inert = cloud.busy;
  document.querySelectorAll('[data-save-status]').forEach(el => el.textContent = saveLabel());
  document.querySelectorAll('[data-cloud-label]').forEach(el => el.textContent = cloud.user || cloud.busy ? cloudLabels[cloud.status] : '登入同步');
  document.querySelectorAll('[data-cloud-account-status]').forEach(el => el.textContent = cloudLabels[cloud.status]);
  document.querySelectorAll('[data-cloud-error]').forEach(el => el.textContent = cloud.message);
  document.querySelectorAll('[data-cloud-conflict]').forEach(el => el.hidden = cloud.status !== 'conflict');
  document.querySelectorAll('form[data-form^="cloud"] button[type="submit"]').forEach(el => el.disabled = cloud.busy);
}
async function cloudAction(action) {
  try {
    if (action === 'cloud-sync') { await cloud.sync(true); return updateCloudStatus(); }
    if (action === 'cloud-retry') { await cloud.restore(); return cloudDialog(); }
    if (action === 'cloud-signout') {
      if (cloud.cache?.dirty && !confirm('這個裝置還有未同步的編輯。登出後會保留在此帳號的本機快取，重新登入才能繼續同步。仍要登出？')) return;
      await cloud.signOut(); loaded = loadState({ getItem: key => localStorage.getItem(key) }); state = loaded.state; storageError = loaded.error; saveFailed = false; navigate('home'); return cloudDialog();
    }
    if (action === 'cloud-migrate') {
      const guest = loadState({ getItem: key => localStorage.getItem(key) });
      if (guest.error) return toast('本機資料無法讀取，請先處理原始資料。');
      if (!confirm(`將原本本機的 ${Object.keys(guest.state.plans).length} 堂課、${guest.state.students.length} 位學生搬入帳號，並取代目前帳號資料？請先匯出目前版本。`)) return;
      cloud.edit(guest.state); state = guest.state; navigate('home'); await cloud.sync(); return cloudDialog();
    }
    if (action.startsWith('cloud-use-')) {
      const choice = action === 'cloud-use-remote' ? 'remote' : 'local';
      if (!confirm(choice === 'remote' ? '以雲端版本取代目前畫面？取代前會保留備份。' : '以目前畫面的版本取代最新雲端資料？取代前會保留備份。')) return;
      await cloud.resolve(choice); return cloudDialog();
    }
    if (action.startsWith('cloud-recovery-')) {
      const key = action.endsWith('local') ? 'local' : 'remote';
      const recovered = cloud.recovery()?.[key]; if (recovered) download(JSON.stringify(recovered, null, 2), `lily-prep-${key}-recovery-${dateKey()}.json`);
    }
  } catch (error) { toast(error.message || '雲端操作未完成，請稍後重試。'); updateCloudStatus(); }
}
function download(data, filename) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function updateSummary() {
  const plan = planAt(); if (view !== 'plan' || !plan) return;
  document.querySelectorAll('[data-total]').forEach(el => el.textContent = totalMinutes(plan));
  document.querySelectorAll('[data-target]').forEach(el => el.textContent = plan.target);
  document.querySelectorAll('[data-remaining]').forEach(el => el.textContent = remainingLabel(plan));
  document.querySelector('.duration-track').innerHTML = durationSegments(plan);
  document.querySelectorAll('[data-group-total]').forEach(el => el.textContent = `${groupMinutes(plan.groups.find(group => group.id === el.dataset.groupTotal))} 分`);
  document.querySelectorAll('[data-item-total]').forEach(el => el.textContent = `${itemMinutes(allItems(plan).find(item => item.id === el.dataset.itemTotal))} 分`);
  document.querySelectorAll('[data-status]').forEach(el => { el.className = `badge ${plan.done ? 'ready' : 'draft'}`; el.textContent = plan.done ? '已備妥' : '備課中'; });
  document.querySelectorAll('#target-group option').forEach(option => { option.textContent = plan.groups.find(group => group.id === option.value)?.name || ''; });
}
function changedPlan() { planAt().done = false; save(); }
function refreshPickerDialog() { openDialog('picker', { heading: '<h2 id="dialog-title">選擇動作</h2>', body: `<p class="muted">加入「${esc(planAt().groups.find(group => group.id === activeGroup)?.name || '')}」；可連續加入多個動作。</p>${pickerContent(true)}${button('close-dialog', '完成選擇', 'button primary full')}` }); }

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  const plan = planAt();
  const group = plan?.groups.find(group => group.id === target.dataset.group);
  if (action === 'nav') return navigate(target.dataset.view);
  if (action === 'close-dialog') return closeDialog();
  if (action === 'settings') return settingsDialog();
  if (action === 'install') return installDialog();
  if (action === 'pwa-check') {
    if (!navigator.onLine) return toast('目前離線，恢復連線後再檢查版本。');
    if (!pwa?.state.enabled) return toast('請先部署新版網站，再檢查 App 版本。');
    void pwa.check().then(() => { updatePWAStatus(); toast(pwa.state.updateAvailable ? '有新版本，準備好後即可更新。' : '版本已檢查；若有更新，會在這裡顯示。'); }); return;
  }
  if (action === 'pwa-update') {
    if (saveFailed || storageError) return toast('請先匯出備份，處理未儲存的資料後再更新。');
    if (!confirm('更新會重新開啟備課室並結束目前的計時。請先儲存尚未送出的表單，確定更新？')) return;
    if (!pwa.applyUpdate()) toast('目前沒有等待安裝的新版本。'); return;
  }
  if (action === 'cloud') return cloudDialog();
  if (action.startsWith('cloud-')) { void cloudAction(action); return; }
  if (action === 'new-student') return studentDialog();
  if (action === 'edit-student') return studentDialog(target.dataset.id);
  if (action === 'student-history') return studentHistory(target.dataset.id);
  if (action === 'assign-students') return assignStudentsDialog();
  if (action === 'new-plan') return newPlanDialog();
  if (action === 'template') return newPlanDialog(target.dataset.index);
  if (action === 'new-exercise') return exerciseDialog();
  if (action === 'edit-exercise') return exerciseDialog(target.dataset.id);
  if (action === 'copy-plan') return copyDialog();
  if (action === 'month') { month = new Date(month.getFullYear(), month.getMonth() + Number(target.dataset.delta), 1); }
  else if (action === 'today') { selectedDate = dateKey(); month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); }
  else if (action === 'select-date') { selectedDate = target.dataset.date; month = new Date(parseDate(selectedDate).getFullYear(), parseDate(selectedDate).getMonth(), 1); }
  else if (action === 'edit-date') return openPlan(target.dataset.date);
  else if (action === 'category') category = target.dataset.category;
  else if (action === 'picker-category') { pickerCategory = target.dataset.category; if (dialog.open) return refreshPickerDialog(); }
  else if (action === 'pick') { activeGroup = target.dataset.group; pickerSearch = ''; pickerCategory = '全部'; return refreshPickerDialog(); }
  else if (action === 'add-exercise') {
    const destination = plan.groups.find(group => group.id === activeGroup) || plan.groups[0];
    const exercise = state.lib.find(exercise => exercise.id === target.dataset.id);
    if (!destination || !exercise) return toast('請先新增課程階段。');
    destination.items.push(makeItem(exercise)); changedPlan(); toast(`已將「${exercise.name}」加入${destination.name}`);
    if (dialog.open) { render(); return; }
  }
  else if (action === 'add-group') { const group = { id: uid(), name: '新的課程階段', items: [] }; plan.groups.push(group); activeGroup ||= group.id; changedPlan(); }
  else if (action === 'delete-group') {
    if (!confirm(`刪除「${group.name}」及其中 ${group.items.length} 個動作？`)) return;
    plan.groups = plan.groups.filter(g => g.id !== group.id); if (activeGroup === group.id) activeGroup = plan.groups[0]?.id; changedPlan();
  }
  else if (action === 'delete-item') { group.items = group.items.filter(item => item.id !== target.dataset.item); delete plan.progress[target.dataset.item]; changedPlan(); }
  else if (action === 'move') { moveItem(plan, group.id, target.dataset.item, Number(target.dataset.direction)); changedPlan(); }
  else if (action === 'finish') {
    if (!allItems(plan).length) return toast('先加入至少一個動作，再完成備課。');
    if (!document.querySelector('.plan-content')?.querySelector('input:invalid')) { plan.done = true; const stored = save(); toast(stored ? '備課完成。準備好，就能開始上課。' : '課程尚未儲存，請立即匯出備份。'); }
    else { document.querySelector('.plan-content input:invalid').reportValidity(); return; }
  }
  else if (action === 'delete-plan') {
    if (!confirm(`確定刪除 ${dateLabel(selectedDate)} 的整份課程？`)) return;
    delete state.plans[selectedDate]; save(); return navigate('home');
  }
  else if (action === 'teach') { selectedDate = target.dataset.date; if (!state.plans[selectedDate]?.done) return; return navigate('teaching'); }
  else if (action === 'toggle-progress') { plan.progress[target.dataset.item] = !plan.progress[target.dataset.item]; save(); }
  else if (action === 'reset-progress') { if (!confirm('重新開始這堂課的練習進度？')) return; stopTimer(); plan.progress = {}; save(); }
  else if (action === 'timer') {
    const item = allItems(plan).find(item => item.id === target.dataset.item);
    stopTimer(); const seconds = Math.max(1, Math.round(itemMinutes(item) * 60));
    timer = { id: item.id, deadline: Date.now() + seconds * 1000, left: seconds, running: true, interval: setInterval(tick, 250) };
  }
  else if (action === 'timer-pause') { if (!timer) return; if (timer.running) { timer.left = timeLeft(); timer.running = false; } else { timer.deadline = Date.now() + timer.left * 1000; timer.running = true; } }
  else if (action === 'timer-done') { if (!timer) return; plan.progress[timer.id] = true; stopTimer(); save(); }
  else if (action === 'timer-stop') stopTimer();
  else if (action === 'delete-exercise') {
    if (!confirm('從動作庫刪除這個動作？已編排的課程不受影響。')) return;
    state.lib = state.lib.filter(exercise => exercise.id !== target.dataset.id); save(); closeDialog();
  }
  else if (action === 'delete-student') {
    if (!confirm('刪除這位學生及其課程關聯？課程內容會保留。')) return;
    state.students = state.students.filter(student => student.id !== target.dataset.id);
    Object.values(state.plans).forEach(plan => { plan.studentIds = plan.studentIds.filter(id => id !== target.dataset.id); });
    save(); closeDialog();
  }
  else if (action === 'delete-location') { state.locs.splice(Number(target.dataset.index), 1); save(); render(); return settingsDialog(); }
  else if (action === 'export') { download(JSON.stringify(state, null, 2), `lily-prep-${dateKey()}.json`); return toast('備份已匯出，請妥善保存。'); }
  else if (action === 'export-raw') { if (loaded.raw === null) return toast('沒有可下載的原始資料。'); return download(loaded.raw, `lily-prep-recovery-${dateKey()}.json`); }
  else if (action === 'recover-storage') {
    if (!confirm('請先下載原始資料。本操作會以目前畫面中的資料取代損壞的新版儲存內容，是否繼續？')) return;
    storageError = null; save(); render(); return settingsDialog();
  }
  render();
});
document.addEventListener('click', event => { if (event.target.closest('a.brand')) { event.preventDefault(); navigate('home'); } });

document.addEventListener('input', event => {
  const target = event.target;
  if (target.dataset.search) {
    if (target.dataset.search === 'library') { search = target.value; render(); }
    else if (target.dataset.search === 'students') { studentSearch = target.value; render(); }
    else {
      pickerSearch = target.value;
      if (dialog.open) {
        const start = target.selectionStart, id = target.id; refreshPickerDialog(); const next = document.getElementById(id); next?.focus(); next?.setSelectionRange(start, start);
      } else render();
    }
    return;
  }
  const field = target.dataset.field;
  if (!field || field === 'active-group' || view !== 'plan') return;
  if (!target.validity.valid || (target.type === 'number' && target.value === '')) return;
  const plan = planAt();
  const group = plan.groups.find(group => group.id === target.dataset.group);
  if (field.startsWith('item-')) {
    const item = group.items.find(item => item.id === target.dataset.item);
    const key = field.slice(5);
    item[key] = ['sets', 'min'].includes(key) ? Number(target.value) : target.value;
    delete plan.progress[item.id];
  } else if (field === 'group-name') group.name = target.value;
  else plan[field] = field === 'target' ? Number(target.value) : target.value;
  changedPlan(); updateSummary();
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.dataset.field === 'active-group') activeGroup = target.value;
  if (target.id !== 'import-file') return;
  const file = target.files[0]; if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('備份檔案超過 10 MB');
    const imported = normalizeState(JSON.parse(await file.text()));
    if (!confirm(`即將以備份中的 ${Object.keys(imported.plans).length} 堂課程、${imported.lib.length} 個動作取代目前資料。確定已匯出目前資料，並要繼續匯入？`)) return;
    // Persist before replacing in-memory state: failed imports leave current work intact.
    if (cloud?.user) cloud.edit(imported);
    else localStorage.setItem(KEY, JSON.stringify(imported));
    state = imported; storageError = null; saveFailed = false; closeDialog(); navigate('home'); toast('備份已匯入。歡迎帶著靈感回來。');
  } catch (error) { toast(`無法匯入：${error.message}。目前資料未變更。`); }
  finally { target.value = ''; }
});
document.addEventListener('submit', event => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'cloud-config' || form.dataset.form === 'cloud-auth') {
    void (async () => {
      try {
        if (form.dataset.form === 'cloud-config') { await cloud.configure(values); cloudDialog(); toast('連線設定已儲存，可以登入或註冊帳號。'); }
        else {
          const signup = event.submitter?.value === 'signup';
          const password = values.password; form.elements.password.value = '';
          const loggedIn = await cloud.signIn(values.email.trim(), password, signup);
          cloudDialog(); if (!loggedIn) toast('請到信箱開啟驗證信，完成後再回來登入。');
        }
      } catch (error) { toast(error.message || '連線未完成，請稍後重試。'); }
    })();
    return;
  }
  if (form.dataset.form === 'student') {
    const name = values.name.trim(); if (!name) return toast('請輸入學生姓名或稱呼。');
    const student = { id: form.dataset.id || uid(), name, goal: values.goal.trim(), notes: values.notes.trim() };
    const index = state.students.findIndex(item => item.id === student.id);
    if (index < 0) state.students.push(student); else state.students[index] = student;
    const stored = save(); closeDialog(); render(); toast(stored ? '學生資料已儲存。' : '學生資料尚未儲存，請匯出備份。'); return;
  }
  if (form.dataset.form === 'assign-students') {
    planAt().studentIds = new FormData(form).getAll('students');
    changedPlan(); closeDialog(); render(); return;
  }
  if (form.dataset.form === 'new-plan') {
    if (!validDate(values.date)) return toast('請選擇有效的日期。');
    const plan = values.template === '' ? newPlan() : templatePlan(Number(values.template));
    plan.title = values.title.trim() || plan.title;
    const key = courseKey(state, values.date);
    state.plans[key] = plan; save(); closeDialog(); return openPlan(key);
  }
  if (form.dataset.form === 'copy') {
    if (!validDate(values.date)) return toast('請選擇有效的日期。');
    const key = courseKey(state, values.date);
    state.plans[key] = copyPlan(planAt()); save(); closeDialog(); openPlan(key); toast('課程已複製，可以開始調整。'); return;
  }
  if (form.dataset.form === 'exercise') {
    const name = values.name.trim(); if (!name) return toast('請輸入動作名稱。');
    const exercise = { id: form.dataset.id || uid(), name, category: values.category, min: Number(values.min), note: values.note.trim() };
    const index = state.lib.findIndex(item => item.id === exercise.id);
    if (index < 0) state.lib.push(exercise); else state.lib[index] = exercise;
    const stored = save(); closeDialog(); render(); toast(stored ? '動作已儲存。' : '動作尚未儲存，請匯出備份。'); return;
  }
  if (form.dataset.form === 'location') {
    const name = values.location.trim(); if (!name) return;
    if (state.locs.includes(name)) return toast('這個地點已經在清單裡。');
    state.locs.push(name); save(); render(); settingsDialog();
  }
});

const browserStorage = { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) };
let cloudConfig = null, configError = null;
try { cloudConfig = JSON.parse(browserStorage.getItem(CONFIG_KEY) || 'null') || (cloudDefaults.url ? cloudDefaults : null); }
catch { configError = '雲端連線設定無法讀取，可以在「雲端帳號與同步」重新設定。'; }
const cloudOptions = {
  storage: browserStorage,
  onData(data, reason) { stopTimer(); state = data; storageError = null; saveFailed = false; if (reason !== 'sync') view = 'home'; closeDialog(); render(); },
  canApply: () => !dialog.open && !['plan', 'teaching'].includes(view),
  acquireLock: async key => {
    if (!navigator.locks) return () => {};
    return new Promise((resolve, reject) => {
      navigator.locks.request(key, { ifAvailable: true }, lock => {
        if (!lock) { reject(new Error('同一瀏覽器已開啟這個帳號的備課視窗，請先關閉另一個視窗，再恢復登入。')); return; }
        let release;
        const hold = new Promise(done => { release = done; });
        resolve(() => release());
        return hold;
      }).catch(reject);
    });
  },
  onStatus: updateCloudStatus,
};
try { cloud = new CloudSync({ ...cloudOptions, config: cloudConfig }); }
catch { cloud = new CloudSync(cloudOptions); configError = '雲端連線設定不正確，請重新填寫公開連線資訊。'; }
// Confirmation links can contain tokens; login is completed through the form instead.
if (new URLSearchParams(location.hash.slice(1)).has('access_token')) history.replaceState(null, '', location.pathname + location.search);
render();
pwa = setupPWA({ enabled: pwaDefaults.enabled, onChange: updatePWAStatus });
if (configError) toast(configError);
void cloud.restore().catch(error => toast(error.message));
setInterval(() => { if (!document.hidden) void cloud.sync(); }, 20000);
window.addEventListener('online', () => void cloud.sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) void cloud.sync(); });
if (loaded.migrated) toast('已讀取初版備課資料，原始資料仍然保留。');
