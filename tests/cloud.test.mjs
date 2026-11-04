import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudSync, SupabaseAPI, validateConfig } from '../src/cloud.js';
import { initialState, KEY, templatePlan } from '../src/model.js';

const config = { url: 'https://test-project.supabase.co', publicKey: 'sb_publishable_test_public_key' };
const users = [{ id: '11111111-1111-4111-8111-111111111111', email: 'first@example.test' }, { id: '22222222-2222-4222-8222-222222222222', email: 'second@example.test' }];
const storage = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), map };
};
function backend() {
  const db = new Map(); let offline = false, hold = null;
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const calls = [];
  const fetcher = async (url, options) => {
    if (offline) throw new TypeError('Network unavailable');
    const path = new URL(url); const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path: path.pathname, method: options.method });
    if (path.pathname.endsWith('/token')) {
      const user = users.find(user => user.email === body.email) || (body.refresh_token === 'refresh-0' ? users[0] : null);
      if (!user || (body.password && body.password !== 'test-password')) return response({ msg: 'Invalid login credentials' }, 400);
      return response({ user, access_token: `token-${user.id}`, refresh_token: 'refresh-0', expires_in: 3600 });
    }
    if (path.pathname.endsWith('/signup')) return response({ user: users[0] });
    if (path.pathname.endsWith('/logout')) return response(null);
    const user = users.find(user => options.headers.Authorization === `Bearer token-${user.id}`);
    if (!user) return response({ message: 'unauthorized' }, 401);
    if (path.pathname.endsWith('/lily_workspaces')) return response(db.has(user.id) ? [db.get(user.id)] : []);
    if (path.pathname.endsWith('/save_lily_workspace')) {
      if (hold) { const pending = hold; hold = null; await pending; }
      const current = db.get(user.id);
      if ((current?.version || 0) !== body.p_expected_version) return response({ code: '40001' }, 400);
      const row = { data: structuredClone(body.p_data), version: body.p_expected_version + 1 };
      db.set(user.id, row); return response([{ version: row.version }]);
    }
    return response({}, 404);
  };
  return { fetcher, db, calls, setOffline(value) { offline = value; }, holdNextWrite(promise) { hold = promise; } };
}
async function setup(server = backend(), store = storage(), user = users[0]) {
  const sync = new CloudSync({ config, storage: store, fetcher: server.fetcher, delay: 100000 });
  await sync.signIn(user.email, 'test-password');
  return { sync, server, store };
}
function editedState(name) { const state = initialState(); state.plans['2026-11-04'] = { ...templatePlan(0), title: name }; return state; }

test('accepts only HTTPS Supabase URLs and public keys; rejects service credentials', () => {
  assert.equal(validateConfig(config).url, config.url);
  const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.signature`;
  assert.doesNotThrow(() => validateConfig({ ...config, publicKey: jwt('anon') }));
  for (const publicKey of ['sb_secret_sensitive', jwt('service_role'), 'password']) assert.throws(() => validateConfig({ ...config, publicKey }));
  for (const url of ['http://test.supabase.co', 'https://evil.example', 'https://test.supabase.co.evil.example', 'https://test.supabase.co/path', 'https://user:pass@test.supabase.co']) assert.throws(() => validateConfig({ ...config, url }));
});
test('new account does not implicitly upload guest data', async () => {
  const store = storage(); store.setItem(KEY, JSON.stringify(editedState('本機課程')));
  const { sync, server } = await setup(backend(), store);
  assert.equal(server.db.size, 0);
  assert.equal(Object.keys(sync.cache.data.plans).length, 0);
  assert.equal(JSON.parse(store.getItem(KEY)).plans['2026-11-04'].title, '本機課程');
});
test('one account can save on one device and read on another', async () => {
  const { sync: phone, server } = await setup();
  phone.edit(editedState('手機課程')); await phone.sync();
  const { sync: computer } = await setup(server);
  assert.equal(computer.cache.data.plans['2026-11-04'].title, '手機課程');
  assert.equal(computer.status, 'synced');
});
test('different accounts use different caches and remote workspaces', async () => {
  const { sync: first, server, store } = await setup();
  first.edit(editedState('第一個帳號')); await first.sync(); const firstKey = first.cacheKey;
  await first.signOut();
  const { sync: second } = await setup(server, store, users[1]);
  assert.notEqual(second.cacheKey, firstKey);
  assert.equal(Object.keys(second.cache.data.plans).length, 0);
  assert.equal(JSON.parse(store.getItem(firstKey)).data.plans['2026-11-04'].title, '第一個帳號');
});
test('offline edits persist locally and upload when the connection returns', async () => {
  const { sync, server, store } = await setup();
  server.setOffline(true); sync.edit(editedState('離線備課')); await sync.sync();
  assert.equal(sync.status, 'offline'); assert.equal(JSON.parse(store.getItem(sync.cacheKey)).dirty, true);
  server.setOffline(false); await sync.sync();
  assert.equal(sync.status, 'synced'); assert.equal(server.db.get(users[0].id).data.plans['2026-11-04'].title, '離線備課');
});
test('existing account cache can reopen offline without reading guest data', async () => {
  const { sync, server, store } = await setup();
  sync.edit(editedState('待上傳')); await sync.sync(); server.setOffline(true);
  const restored = new CloudSync({ config, storage: store, fetcher: server.fetcher });
  await restored.restore();
  assert.equal(restored.status, 'offline'); assert.equal(restored.cache.data.plans['2026-11-04'].title, '待上傳');
});
test('concurrent devices cannot silently overwrite newer changes', async () => {
  const { sync: first, server } = await setup();
  const { sync: second } = await setup(server);
  first.edit(editedState('第一台')); second.edit(editedState('第二台'));
  await first.sync(); await second.sync();
  assert.equal(second.status, 'conflict'); assert.equal(second.cache.dirty, true);
  assert.equal(server.db.get(users[0].id).data.plans['2026-11-04'].title, '第一台');
});
test('explicit conflict replacement preserves both versions in a recovery backup', async () => {
  const { sync: first, server } = await setup();
  const { sync: second } = await setup(server);
  first.edit(editedState('雲端')); second.edit(editedState('本機'));
  await first.sync(); await second.sync(); await second.resolve('local');
  assert.equal(second.recovery().remote.plans['2026-11-04'].title, '雲端');
  assert.equal(second.recovery().local.plans['2026-11-04'].title, '本機');
  assert.equal(server.db.get(users[0].id).version, 2);
  assert.equal(server.db.get(users[0].id).data.plans['2026-11-04'].title, '本機');
});
test('adopting cloud after a conflict preserves local data for recovery', async () => {
  const { sync: first, server } = await setup();
  const { sync: second } = await setup(server);
  first.edit(editedState('雲端')); second.edit(editedState('本機'));
  await first.sync(); await second.sync(); await second.resolve('remote');
  assert.equal(second.cache.data.plans['2026-11-04'].title, '雲端');
  assert.equal(second.recovery().local.plans['2026-11-04'].title, '本機');
});
test('edits made during an in-flight upload are sent in a following version', async () => {
  const { sync, server } = await setup();
  let release; server.holdNextWrite(new Promise(resolve => { release = resolve; }));
  sync.edit(editedState('第一次')); const pending = sync.sync();
  await new Promise(resolve => setTimeout(resolve, 0));
  sync.edit(editedState('第二次')); release(); await pending;
  assert.equal(server.db.get(users[0].id).version, 2);
  assert.equal(server.db.get(users[0].id).data.plans['2026-11-04'].title, '第二次');
  clearTimeout(sync.debounce);
});
test('a dirty cache restored against a newer cloud version reports a conflict', async () => {
  const { sync: first, server } = await setup(); const store = storage();
  const { sync: second } = await setup(server, store);
  second.edit(editedState('未上傳')); clearTimeout(second.debounce);
  first.edit(editedState('已上傳')); await first.sync();
  const restored = new CloudSync({ config, storage: store, fetcher: server.fetcher }); await restored.restore();
  assert.equal(restored.status, 'conflict'); assert.equal(restored.cache.data.plans['2026-11-04'].title, '未上傳');
});
test('clean clients pull remote changes without uploading or changing the guest snapshot', async () => {
  const { sync: first, server } = await setup(); const { sync: second } = await setup(server);
  first.edit(editedState('新版本')); await first.sync(); await second.sync();
  assert.equal(second.cache.data.plans['2026-11-04'].title, '新版本');
  assert.equal(server.db.get(users[0].id).version, 1);
});
test('quota failures do not replace the previous account cache', async () => {
  const { sync, store } = await setup(); const previous = store.getItem(sync.cacheKey);
  store.setItem = () => { throw new Error('Quota exceeded'); };
  assert.throws(() => sync.edit(editedState('新資料')), /Quota/);
  assert.equal(store.getItem(sync.cacheKey), previous); assert.equal(sync.cache.dirty, false);
});
test('remote refresh waits while a user is editing a form; a manual refresh can apply it', async () => {
  const { sync: first, server } = await setup();
  const { sync: second } = await setup(server);
  second.canApply = () => false;
  first.edit(editedState('其他裝置的更新')); await first.sync();
  await second.sync();
  assert.equal(second.status, 'remote'); assert.equal(Object.keys(second.cache.data.plans).length, 0);
  await second.sync(true);
  assert.equal(second.cache.data.plans['2026-11-04'].title, '其他裝置的更新');
});
test('signup requiring verification never uploads guest data or creates a session', async () => {
  const server = backend(), store = storage(); const sync = new CloudSync({ config, storage: store, fetcher: server.fetcher });
  assert.equal(await sync.signIn(users[0].email, 'test-password', true), false);
  assert.equal(sync.user, null); assert.equal(sync.api.session, null); assert.equal(server.db.size, 0);
});
test('expired access tokens refresh and passwords are never persisted', async () => {
  const store = storage(), server = backend(), api = new SupabaseAPI(config, store, server.fetcher);
  await api.signIn(users[0].email, 'test-password'); api.session.expires_at = 0; store.setItem(api.sessionKey, JSON.stringify(api.session));
  await api.read();
  assert.ok(api.session.expires_at * 1000 > Date.now());
  for (const value of store.map.values()) assert.ok(!value.includes('test-password'));
});
test('a second tab denied an account lock cannot open or write the account cache', async () => {
  const server = backend(), store = storage();
  const sync = new CloudSync({ config, storage: store, fetcher: server.fetcher, acquireLock: async () => { throw new Error('Account already open'); } });
  await assert.rejects(sync.signIn(users[0].email, 'test-password'), /already open/);
  assert.equal(sync.user, null); assert.equal(sync.cache, null); assert.equal(server.db.size, 0);
});
