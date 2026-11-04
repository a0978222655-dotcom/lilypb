export const KEY = 'lilypb_v2';
export const LEGACY_KEY = 'pilates_prep_v1';
export const CATEGORIES = ['呼吸', '暖身', '核心', '全身', '伸展', '其他'];
export const uid = () => globalThis.crypto.randomUUID();
export const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const courseDate = key => key.split('~')[0];
export const parseDate = key => new Date(`${courseDate(key)}T12:00:00`);
export const courseKey = (state, date) => state.plans[date] ? `${date}~${uid()}` : date;
export const plansOnDate = (state, date) => Object.entries(state.plans).filter(([key]) => courseDate(key) === courseDate(date)).sort((a, b) => (a[1].time || '99:99').localeCompare(b[1].time || '99:99'));
export const validDate = key => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(+parseDate(key)) && dateKey(parseDate(key)) === key;
export const round = n => Math.round(n * 10) / 10;
export const allItems = plan => plan.groups.flatMap(group => group.items);
export const itemMinutes = item => round(item.sets * item.min);
export const groupMinutes = group => round(group.items.reduce((sum, item) => sum + itemMinutes(item), 0));
export const totalMinutes = plan => round(plan.groups.reduce((sum, group) => sum + groupMinutes(group), 0));
export const completion = plan => allItems(plan).length ? Math.round(allItems(plan).filter(item => plan.progress[item.id]).length / allItems(plan).length * 100) : 0;
export const makeItem = exercise => ({ id: uid(), name: exercise.name, min: exercise.min, sets: 1, note: exercise.note || '' });
export function newPlan() {
  return { title: '', time: '', loc: '', locNote: '', notes: '', studentIds: [], target: 60, done: false, progress: {}, groups: ['暖身與呼吸', '主要練習', '伸展與收尾'].map(name => ({ id: uid(), name, items: [] })) };
}
export function initialState() {
  return { schemaVersion: 2, students: [], locs: ['工作室A', '工作室B'], plans: {}, lib: [
    { id: 'a1', name: '呼吸練習', min: 3, category: '呼吸', note: '' },
    { id: 'a2', name: '貓牛式', min: 3, category: '暖身', note: '' },
    { id: 'a3', name: '胸椎扭轉', min: 3, category: '伸展', note: '' },
    { id: 'a4', name: '高跪前推', min: 3, category: '全身', note: '' },
    { id: 'a5', name: '平移', min: 3, category: '全身', note: '' },
    { id: 'a6', name: '跪姿死蟲', min: 3, category: '核心', note: '' }
  ] };
}
function text(value, fallback = '') { return typeof value === 'string' ? value : fallback; }
function number(value, fallback, min = 0, max = 600) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error('時間或組數格式不正確');
  return n;
}
function array(value) { if (!Array.isArray(value)) throw new Error('資料格式不正確'); return value; }
function uniqueIds(list) {
  const ids = list.map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error('資料含有重複的項目識別碼');
}
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('資料格式不正確'); return value; }
function id(value) {
  if (value == null || value === '') return uid();
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('項目識別碼格式不正確');
  return value;
}
// Accept the original pilates_prep_v1 shape without modifying its stored copy.
export function normalizeState(input) {
  const data = object(input);
  if (data.schemaVersion != null && data.schemaVersion !== 2) throw new Error('不支援這個備份版本');
  const plans = {};
  const students = array(data.students ?? []).map(student => {
    object(student);
    if (!text(student.name).trim()) throw new Error('學生姓名不可空白');
    return { id: id(student.id), name: student.name, goal: text(student.goal), notes: text(student.notes) };
  });
  uniqueIds(students);
  const lib = array(data.lib).map(exercise => {
    object(exercise);
    if (!text(exercise.name).trim()) throw new Error('動作名稱不可空白');
    return { id: id(exercise.id), name: exercise.name, min: number(exercise.min, 3), category: CATEGORIES.includes(exercise.category) ? exercise.category : '其他', note: text(exercise.note) };
  });
  uniqueIds(lib);
  for (const [key, raw] of Object.entries(object(data.plans))) {
    if (!validDate(courseDate(key)) || (key.includes('~') && !/^\d{4}-\d{2}-\d{2}~[a-zA-Z0-9-]+$/.test(key))) throw new Error('課表日期格式不正確');
    object(raw);
    const time = text(raw.time);
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('上課時間格式不正確');
    const groups = array(raw.groups).map(group => {
      object(group);
      return { id: id(group.id), name: text(group.name, '類組'), items: array(group.items).map(item => {
        object(item);
        return { id: id(item.id), name: text(item.name, '未命名動作'), min: number(item.min, 3), sets: number(item.sets, 1, 1, 100), note: text(item.note) };
      }) };
    });
    uniqueIds(groups);
    uniqueIds(groups.flatMap(group => group.items));
    const progress = {};
    for (const item of groups.flatMap(group => group.items)) if (raw.progress?.[item.id] === true) progress[item.id] = true;
    plans[key] = { title: text(raw.title), time, loc: text(raw.loc), locNote: text(raw.locNote), notes: text(raw.notes), studentIds: array(raw.studentIds ?? []).filter(value => students.some(student => student.id === value)), target: number(raw.target, 60, 1), done: raw.done === true, progress, groups };
  }
  return { schemaVersion: 2, students, lib, locs: [...new Set(array(data.locs ?? ['工作室A', '工作室B']).map(loc => text(loc)).filter(Boolean))], plans };
}
export function copyPlan(plan) {
  const copy = structuredClone(plan);
  copy.done = false;
  copy.progress = {};
  copy.groups.forEach(group => { group.id = uid(); group.items.forEach(item => { item.id = uid(); }); });
  return copy;
}
export function moveItem(plan, groupId, itemId, direction) {
  const group = plan.groups.find(group => group.id === groupId);
  if (!group) return;
  const index = group.items.findIndex(item => item.id === itemId);
  const target = index + direction;
  if (index >= 0 && target >= 0 && target < group.items.length) [group.items[index], group.items[target]] = [group.items[target], group.items[index]];
}
export function loadState(storage) {
  let raw = null;
  try {
    const current = storage.getItem(KEY);
    raw = current ?? storage.getItem(LEGACY_KEY);
    return { state: raw !== null ? normalizeState(JSON.parse(raw)) : initialState(), migrated: current === null && raw !== null, error: null, raw };
  } catch (error) {
    return { state: initialState(), migrated: false, error: `無法讀取本機資料：${error.message}`, raw };
  }
}
export const TEMPLATES = [
  { title: '輕盈入門', subtitle: '30 分鐘 · 從呼吸開始，找回身體的節奏', target: 30, minutes: [5, 5, 5, 5, 5, 5], tone: 'sage' },
  { title: '核心與穩定', subtitle: '45 分鐘 · 溫和暖身，專注核心控制', target: 45, minutes: [3, 6, 6, 12, 9, 9], tone: 'lavender' },
  { title: '全身流動', subtitle: '60 分鐘 · 完整練習，留足伸展的時間', target: 60, minutes: [6, 6, 6, 18, 12, 12], tone: 'peach' }
];
export function templatePlan(index) {
  const template = TEMPLATES[index];
  if (!template) throw new Error('找不到範本');
  const plan = newPlan();
  plan.title = template.title;
  plan.target = template.target;
  const lib = initialState().lib;
  const order = [[0, 1], [3, 4, 5], [2]];
  plan.groups.forEach((group, i) => { group.items = order[i].map(index => ({ ...makeItem(lib[index]), min: template.minutes[index] })); });
  return plan;
}
