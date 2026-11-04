import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, newPlan, makeItem, totalMinutes, completion, templatePlan, TEMPLATES, normalizeState, copyPlan, moveItem, loadState, KEY, LEGACY_KEY, validDate, courseKey, plansOnDate } from '../src/model.js';

const fakeStorage = entries => { const map = new Map(entries); map.getItem = key => map.get(key) ?? null; return map; };
const legacy = () => ({ lib: [{ id: 'old', name: '呼吸練習', min: 3 }], plans: { '2026-11-04': { loc: '工作室A', locNote: '帶小球', done: true, progress: { i1: true }, groups: [{ id: 'g1', name: '初期', items: [{ id: 'i1', name: '呼吸練習', sets: 2, min: 3, note: '8 下' }] }] } } });
test('reads original v1 data, preserving progress, groups, notes, duration, and locations', () => {
  const state = normalizeState(legacy());
  assert.equal(totalMinutes(state.plans['2026-11-04']), 6);
  assert.equal(completion(state.plans['2026-11-04']), 100);
  assert.equal(state.plans['2026-11-04'].locNote, '帶小球');
  assert.equal(state.plans['2026-11-04'].groups[0].items[0].note, '8 下');
  assert.deepEqual(state.students, []);
  assert.deepEqual(state.locs, ['工作室A', '工作室B']);
});
test('legacy migration reads without writing or removing old storage', () => {
  const data = JSON.stringify(legacy());
  const storage = fakeStorage([[LEGACY_KEY, data]]);
  const result = loadState(storage);
  assert.equal(result.migrated, true);
  assert.equal(result.error, null);
  assert.equal(storage.get(LEGACY_KEY), data);
  assert.equal(storage.has(KEY), false);
});
test('current data has priority over legacy data', () => {
  const result = loadState(fakeStorage([[KEY, JSON.stringify(initialState())], [LEGACY_KEY, JSON.stringify(legacy())]]));
  assert.equal(Object.keys(result.state.plans).length, 0);
  assert.equal(result.migrated, false);
});
test('corrupt storage exposes recovery data and does not silently destroy it', () => {
  const result = loadState(fakeStorage([[KEY, '{invalid']]));
  assert.ok(result.error);
  assert.equal(result.raw, '{invalid');
});
test('storage denied by browser is reported', () => {
  const result = loadState({ getItem() { throw new Error('Access denied'); } });
  assert.match(result.error, /Access denied/);
});
test('templates actually match their advertised duration', () => {
  for (const [index, template] of TEMPLATES.entries()) assert.equal(totalMinutes(templatePlan(index)), template.target);
});
test('copies reset completion and generate separate group and item identities', () => {
  const original = normalizeState(legacy()).plans['2026-11-04'];
  const copy = copyPlan(original);
  assert.equal(copy.done, false);
  assert.deepEqual(copy.progress, {});
  assert.notEqual(copy.groups[0].id, original.groups[0].id);
  assert.notEqual(copy.groups[0].items[0].id, original.groups[0].items[0].id);
  copy.groups[0].items[0].name = '不同的動作';
  assert.equal(original.groups[0].items[0].name, '呼吸練習');
});
test('adding a library item makes an independent snapshot for a course', () => {
  const state = initialState();
  const item = makeItem(state.lib[0]);
  state.lib[0].name = '改名';
  assert.equal(item.name, '呼吸練習');
});
test('multiple courses on the same date survive import/export', () => {
  const state = initialState();
  state.plans['2026-11-04'] = templatePlan(0);
  const key = courseKey(state, '2026-11-04');
  state.plans[key] = templatePlan(1);
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(plansOnDate(restored, '2026-11-04').length, 2);
  assert.equal(totalMinutes(restored.plans[key]), 45);
});
test('same-day courses are ordered by start time, with unscheduled courses last', () => {
  const state = initialState();
  for (const time of ['17:30', '', '09:00']) {
    const key = courseKey(state, '2026-11-04');
    state.plans[key] = { ...newPlan(), time };
  }
  const restored = normalizeState(state);
  assert.deepEqual(plansOnDate(restored, '2026-11-04').map(([, plan]) => plan.time), ['09:00', '17:30', '']);
  restored.plans['2026-11-04'].time = '25:70';
  assert.throws(() => normalizeState(restored), /上課時間/);
});
test('student goals, notes and course associations survive import/export', () => {
  const state = initialState();
  state.students.push({ id: 's1', name: '小莉', goal: '核心穩定', notes: '慢慢引導' });
  const plan = templatePlan(0); plan.studentIds = ['s1', 'missing']; state.plans['2026-11-04'] = plan;
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.students[0].notes, '慢慢引導');
  assert.deepEqual(restored.plans['2026-11-04'].studentIds, ['s1']);
});
test('reordering does not lose items and respects boundaries', () => {
  const plan = templatePlan(0), group = plan.groups[0];
  const [a, b] = group.items;
  moveItem(plan, group.id, a.id, -1); assert.equal(group.items[0].id, a.id);
  moveItem(plan, group.id, a.id, 1); assert.deepEqual(group.items.map(item => item.id), [b.id, a.id]);
  moveItem(plan, group.id, a.id, 1); assert.equal(group.items.length, 2);
});
test('duration uses decimal arithmetic rounded to tenths and progress handles empty plans', () => {
  const plan = newPlan();
  assert.equal(completion(plan), 0);
  plan.groups[0].items.push({ id: 'i1', sets: 3, min: 0.1 });
  assert.equal(totalMinutes(plan), 0.3);
});
test('only valid calendar dates are accepted', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-11-04'), true);
});
test('invalid backup structures, values and unsafe identifiers are rejected', () => {
  const invalids = [null, {}, { lib: [], plans: [] }, { lib: [], plans: {}, schemaVersion: 99 }];
  for (const value of invalids) assert.throws(() => normalizeState(value));
  for (const min of [-1, 'NaN', 'Infinity', 601]) { const data = legacy(); data.lib[0].min = min; assert.throws(() => normalizeState(data)); }
  for (const id of ['x" onclick="alert(1)', '__proto__', 'constructor']) { const data = legacy(); data.lib[0].id = id; assert.throws(() => normalizeState(data)); }
  const data = legacy(); data.lib.push({ ...data.lib[0] }); assert.throws(() => normalizeState(data), /重複/);
});
