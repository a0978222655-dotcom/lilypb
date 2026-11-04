import { initialState, normalizeState } from './model.js';

export const CONFIG_KEY = 'lilypb_cloud_config';
export function validateConfig(input) {
  const url = new URL(String(input.url).trim());
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('請填寫 Supabase 專案的 HTTPS 網址');
  const publicKey = String(input.publicKey || '').trim();
  let isAnon = false;
  if (publicKey.split('.').length === 3) {
    try { isAnon = JSON.parse(atob(publicKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch { /* Invalid public JWT. */ }
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey) && !isAnon) throw new Error('請使用 publishable key 或 anon key，不能使用 secret / service_role 金鑰');
  return { url: url.origin, publicKey };
}
export class CloudError extends Error {
  constructor(message, code = 'network') { super(message); this.code = code; }
}
const validUser = user => user && /^[0-9a-f-]{36}$/i.test(user.id) && typeof user.email === 'string';

export class SupabaseAPI {
  constructor(config, storage, fetcher = globalThis.fetch.bind(globalThis)) {
    this.config = validateConfig(config); this.storage = storage; this.fetcher = fetcher;
    this.sessionKey = `lilypb_auth:${new URL(this.config.url).hostname}`;
    try { this.session = JSON.parse(storage.getItem(this.sessionKey)); } catch { this.session = null; }
    if (!validUser(this.session?.user) || !this.session?.refresh_token) this.session = null;
    this.refreshing = null;
  }
  async request(path, { method = 'GET', body, token } = {}) {
    let response;
    try {
      response = await this.fetcher(`${this.config.url}${path}`, {
        method, headers: { apikey: this.config.publicKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new CloudError('連線暫時中斷，編輯會保留在這個裝置，恢復連線後可再同步。'); }
    const text = await response.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { throw new CloudError('雲端回應格式不正確，請稍後重試。'); }
    if (!response.ok) {
      if (data?.code === '40001') throw new CloudError('另一個裝置已有更新，請選擇要保留的版本。', 'conflict');
      if (['PGRST202', '42P01'].includes(data?.code)) throw new CloudError('雲端資料表尚未設定，請先執行 supabase/schema.sql。', 'setup');
      if (data?.msg === 'Email not confirmed' || data?.error_code === 'email_not_confirmed') throw new CloudError('請先到信箱完成驗證，再回來登入。', 'auth');
      if (response.status === 429) throw new CloudError('操作太頻繁，請稍等一下再試。', 'auth');
      if ([400, 401, 403, 422].includes(response.status)) throw new CloudError(path.includes('/token') && !path.includes('refresh_token') ? '登入失敗，請確認 Email、密碼與信箱驗證狀態。' : '登入或存取未完成，請確認專案設定，必要時重新登入。', 'auth');
      throw new CloudError('雲端服務暫時無法使用，請稍後再試。', 'server');
    }
    return data;
  }
  setSession(data) {
    if (!validUser(data?.user) || !data?.access_token || !data?.refresh_token) throw new CloudError('登入回應不完整，請重新登入。', 'auth');
    const session = { user: { id: data.user.id, email: data.user.email }, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600) };
    this.storage.setItem(this.sessionKey, JSON.stringify(session)); this.session = session;
    return session;
  }
  async signIn(email, password) { return this.setSession(await this.request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })); }
  async signUp(email, password) {
    const result = await this.request('/auth/v1/signup', { method: 'POST', body: { email, password } });
    return result?.access_token ? this.setSession(result) : null;
  }
  async token() {
    if (!this.session) throw new CloudError('請先登入雲端帳號。', 'auth');
    if (this.session.expires_at * 1000 > Date.now() + 60000) return this.session.access_token;
    if (!this.refreshing) this.refreshing = (async () => {
      // Reuse rotated credentials from another tab before attempting a refresh.
      const stored = JSON.parse(this.storage.getItem(this.sessionKey) || 'null');
      if (stored?.user?.id === this.session.user.id && stored.expires_at * 1000 > Date.now() + 60000) { this.session = stored; return stored.access_token; }
      const expectedId = this.session.user.id;
      const data = await this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: this.session.refresh_token } });
      if (data?.user?.id !== expectedId) throw new CloudError('帳號驗證狀態有變，請重新登入。', 'auth');
      return this.setSession(data).access_token;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async read() {
    const token = await this.token();
    const rows = await this.request(`/rest/v1/lily_workspaces?user_id=eq.${encodeURIComponent(this.session.user.id)}&select=data,version`, { token });
    if (!Array.isArray(rows) || rows.length > 1) throw new CloudError('雲端課程格式不正確，未取代本機資料。');
    if (!rows.length) return null;
    if (!Number.isSafeInteger(rows[0].version) || rows[0].version < 1) throw new CloudError('雲端版本格式不正確。');
    return { data: normalizeState(rows[0].data), version: rows[0].version };
  }
  async write(data, expectedVersion) {
    const token = await this.token();
    const result = await this.request('/rest/v1/rpc/save_lily_workspace', { method: 'POST', token, body: { p_data: normalizeState(data), p_expected_version: expectedVersion } });
    const row = Array.isArray(result) ? result[0] : result;
    if (!Number.isSafeInteger(row?.version) || row.version !== expectedVersion + 1) throw new CloudError('無法確認雲端儲存結果，請重新同步。');
    return row.version;
  }
  async signOut() {
    const session = this.session;
    this.session = null; this.storage.removeItem(this.sessionKey);
    if (session) { try { await this.request('/auth/v1/logout?scope=local', { method: 'POST', token: session.access_token }); } catch { /* Local logout still succeeds offline. */ } }
  }
}

// An account gets its own offline cache; guest data is never uploaded implicitly.
export class CloudSync {
  constructor({ storage, config = null, fetcher, onData = () => {}, onStatus = () => {}, canApply = () => true, acquireLock = async () => () => {}, delay = 700 }) {
    this.storage = storage; this.fetcher = fetcher; this.onData = onData; this.onStatus = onStatus; this.canApply = canApply; this.delay = delay;
    this.acquireLock = acquireLock; this.releaseLock = null;
    this.api = config ? new SupabaseAPI(config, storage, fetcher) : null;
    this.user = null; this.cache = null; this.remote = null; this.status = 'local'; this.message = ''; this.busy = false; this.job = null; this.sequence = 0; this.debounce = null;
  }
  get cacheKey() { return this.user ? `lilypb_account:${new URL(this.api.config.url).hostname}:${this.user.id}` : null; }
  report(status, message = '') { this.status = status; this.message = message; this.onStatus(); }
  async configure(config) {
    if (this.user || this.busy) throw new CloudError('請先登出，再變更雲端專案。');
    const validated = validateConfig(config);
    this.storage.setItem(CONFIG_KEY, JSON.stringify(validated)); this.api = new SupabaseAPI(validated, this.storage, this.fetcher); this.report('local');
  }
  async restore() { if (this.api?.session) return this.openAccount(); }
  async signIn(email, password, signup = false) {
    if (!this.api) throw new CloudError('請先填寫 Supabase 專案設定。', 'setup');
    if (this.busy || this.job) throw new CloudError('正在處理同步，請稍候。');
    this.busy = true; this.report('connecting');
    try {
      const session = signup ? await this.api.signUp(email, password) : await this.api.signIn(email, password);
      if (!session) { this.report('local'); return false; }
    } catch (error) { this.report('error', error.message); throw error; }
    finally { this.busy = false; this.onStatus(); }
    await this.openAccount(); return true;
  }
  async openAccount() {
    this.busy = true; this.report('connecting');
    const user = this.api.session.user;
    const key = `lilypb_account:${new URL(this.api.config.url).hostname}:${user.id}`;
    try {
      this.releaseLock ||= await this.acquireLock(key);
      const raw = this.storage.getItem(key);
      let cached = raw ? JSON.parse(raw) : null;
      if (cached) { cached.data = normalizeState(cached.data); if (!Number.isSafeInteger(cached.version) || cached.version < 0 || typeof cached.dirty !== 'boolean') throw new CloudError('本機帳號快取格式不正確，請保留資料並聯絡協助。'); }
      let remote, offline = false;
      try { remote = await this.api.read(); }
      catch (error) { if (!cached || error.code !== 'network') throw error; offline = true; }
      this.user = user;
      this.remote = remote;
      const conflict = !offline && cached && ((cached.dirty && cached.version !== (remote?.version || 0)) || (!remote && cached.version > 0));
      this.cache = cached && (offline || cached.dirty || conflict) ? cached : { data: remote?.data || initialState(), version: remote?.version || 0, dirty: false };
      this.persist(); this.onData(structuredClone(this.cache.data));
      this.report(conflict ? 'conflict' : offline ? 'offline' : this.cache.dirty ? 'pending' : 'synced');
    } catch (error) { this.releaseLock?.(); this.releaseLock = null; this.user = null; this.cache = null; this.report('error', error.message); throw error; }
    finally { this.busy = false; this.onStatus(); }
    if (this.cache?.dirty && this.status === 'pending') await this.sync();
  }
  persist() { this.storage.setItem(this.cacheKey, JSON.stringify(this.cache)); }
  edit(data) {
    if (!this.user || !this.cache || this.busy) throw new CloudError('雲端資料尚未準備好，請稍候再編輯。');
    const next = { ...this.cache, data: normalizeState(data), dirty: true };
    this.storage.setItem(this.cacheKey, JSON.stringify(next)); this.cache = next; this.sequence++;
    if (this.status !== 'conflict') { this.report('pending'); clearTimeout(this.debounce); this.debounce = setTimeout(() => this.sync(), this.delay); }
  }
  async sync(force = false) {
    if (!this.user || this.busy || this.status === 'conflict') return;
    if (this.job) return this.job;
    clearTimeout(this.debounce);
    this.job = this.runSync(force).finally(() => { this.job = null; });
    return this.job;
  }
  async runSync(force) {
    try {
      this.report('syncing');
      if (!this.cache.dirty) {
        const sequence = this.sequence;
        const remote = await this.api.read();
        if (this.sequence !== sequence) { /* A local edit arrived while reading: write with its original version. */ }
        else if (remote && remote.version !== this.cache.version) {
          if (!force && !this.canApply()) { this.report('remote'); return; }
          this.cache = { data: remote.data, version: remote.version, dirty: false }; this.persist(); this.onData(structuredClone(remote.data), 'sync');
        }
        else if (!remote && this.cache.version > 0) { this.remote = null; this.report('conflict'); return; }
      }
      while (this.cache.dirty) {
        const sequence = this.sequence;
        const version = await this.api.write(structuredClone(this.cache.data), this.cache.version);
        this.cache.version = version; this.cache.dirty = sequence !== this.sequence; this.persist();
      }
      this.report('synced');
    } catch (error) {
      this.report(error.code === 'conflict' ? 'conflict' : error.code === 'network' ? 'offline' : 'error', error.message);
    }
  }
  async resolve(choice) {
    if (!this.user || this.busy || this.job) throw new CloudError('請稍候再處理版本差異。');
    this.busy = true; this.report('connecting');
    try {
      const remote = await this.api.read();
      // Always preserve both versions before the user-authorized replacement.
      this.storage.setItem(`${this.cacheKey}:recovery`, JSON.stringify({ local: this.cache.data, remote: remote?.data || initialState() }));
      if (choice === 'remote') {
        this.cache = { data: remote?.data || initialState(), version: remote?.version || 0, dirty: false };
        this.persist(); this.onData(structuredClone(this.cache.data)); this.report('synced');
      } else {
        const version = await this.api.write(this.cache.data, remote?.version || 0);
        this.cache = { ...this.cache, version, dirty: false }; this.persist(); this.report('synced');
      }
    } catch (error) { this.report('conflict', error.message); throw error; }
    finally { this.busy = false; this.onStatus(); }
  }
  recovery() { return JSON.parse(this.storage.getItem(`${this.cacheKey}:recovery`) || 'null'); }
  async signOut() {
    if (this.busy) throw new CloudError('請等待目前操作完成後再登出。');
    this.busy = true; this.onStatus();
    try {
      clearTimeout(this.debounce); if (this.job) await this.job;
      await this.api.signOut(); this.releaseLock?.(); this.releaseLock = null; this.user = null; this.cache = null; this.report('local');
    } finally { this.busy = false; this.onStatus(); }
  }
}
