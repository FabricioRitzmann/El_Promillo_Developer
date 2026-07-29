import { loadPublicConfig } from './config.js';

const sessionStorageKey = 'wallet_cards_mvp_session';

function encodeFilterValue(value) {
  if (value === null) {
    return 'null';
  }

  return String(value);
}

function encodeStoragePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function parseResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!text) {
    return null;
  }

  if (contentType.includes('application/json')) {
    return JSON.parse(text);
  }

  return text;
}

export class SupabaseRestClient {
  constructor(config) {
    this.config = config;
    this.supabaseUrl = config.supabase.url.replace(/\/$/, '');
    this.anonKey = config.supabase.anonKey;
  }

  cleanAuthRedirectUrl() {
    if (!window.history?.replaceState) {
      return;
    }

    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, document.title, cleanUrl);
  }

  async fetchUser(accessToken) {
    const response = await fetch(`${this.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: this.baseHeaders(true, accessToken)
    });
    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(data?.msg || data?.error_description || data?.message || 'Session konnte nicht geprüft werden.');
    }

    return data;
  }

  async consumeAuthRedirectSession() {
    const hash = String(window.location.hash || '').replace(/^#/, '');

    if (!hash) {
      return null;
    }

    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken || !refreshToken) {
      return null;
    }

    const expiresIn = Number(params.get('expires_in') || 3600);
    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      token_type: params.get('token_type') || 'bearer',
      user: await this.fetchUser(accessToken)
    };

    this.storeSession(session);
    this.cleanAuthRedirectUrl();

    return session;
  }

  getStoredSession() {
    const rawSession = window.localStorage.getItem(sessionStorageKey);

    if (!rawSession) {
      return null;
    }

    try {
      return JSON.parse(rawSession);
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
      return null;
    }
  }

  storeSession(session) {
    const expiresAt = session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);

    window.localStorage.setItem(sessionStorageKey, JSON.stringify({
      ...session,
      expires_at: expiresAt
    }));
  }

  clearSession() {
    window.localStorage.removeItem(sessionStorageKey);
  }

  async signUp({ email, password, displayName }) {
    const response = await fetch(`${this.supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: this.baseHeaders(false),
      body: JSON.stringify({
        email,
        password,
        data: {
          display_name: displayName || ''
        }
      })
    });

    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(data?.msg || data?.error_description || data?.message || 'Registrierung fehlgeschlagen.');
    }

    if (data?.access_token) {
      this.storeSession(data);
    }

    return data;
  }

  async registerOperator({ email, password, displayName }) {
    const response = await fetch(`${this.supabaseUrl}/functions/v1/register-operator`, {
      method: 'POST',
      headers: this.baseHeaders(false),
      body: JSON.stringify({
        email,
        password,
        displayName: displayName || ''
      })
    });

    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(data?.error_reason || data?.error_message || data?.message || 'Registrierung fehlgeschlagen.');
    }

    return data;
  }

  async signIn({ email, password }) {
    const response = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: this.baseHeaders(false),
      body: JSON.stringify({ email, password })
    });

    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(data?.error_description || data?.msg || data?.message || 'Login fehlgeschlagen.');
    }

    this.storeSession(data);
    return data;
  }

  async signOut() {
    const session = this.getStoredSession();

    if (session?.access_token) {
      await fetch(`${this.supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: this.baseHeaders(true, session.access_token)
      }).catch(() => {});
    }

    this.clearSession();
  }

  async ensureSession() {
    const redirectSession = await this.consumeAuthRedirectSession();

    if (redirectSession) {
      return redirectSession;
    }

    const session = this.getStoredSession();

    if (!session) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    if (session.expires_at && session.expires_at > now + 60) {
      if (!session.user?.id && session.access_token) {
        try {
          const user = await this.fetchUser(session.access_token);
          const refreshedSession = {
            ...session,
            user
          };

          this.storeSession(refreshedSession);
          return refreshedSession;
        } catch {
          this.clearSession();
          return null;
        }
      }

      return session;
    }

    if (!session.refresh_token) {
      this.clearSession();
      return null;
    }

    const response = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: this.baseHeaders(false),
      body: JSON.stringify({
        refresh_token: session.refresh_token
      })
    });

    const data = await parseResponse(response);

    if (!response.ok) {
      this.clearSession();
      return null;
    }

    this.storeSession(data);
    return data;
  }

  baseHeaders(useSession = false, token = null) {
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${token || (useSession ? this.getStoredSession()?.access_token : this.anonKey)}`,
      'Content-Type': 'application/json'
    };
  }

  async restRequest(table, {
    method = 'GET',
    select = null,
    filters = [],
    order = null,
    limit = null,
    body = null,
    auth = true,
    prefer = null,
    onConflict = null,
    maybeSingle = false
  } = {}) {
    const session = auth ? await this.ensureSession() : null;

    if (auth && !session) {
      throw new Error('Bitte erneut einloggen.');
    }

    const url = new URL(`${this.supabaseUrl}/rest/v1/${table}`);

    if (select) {
      url.searchParams.set('select', select);
    }

    for (const filter of filters) {
      url.searchParams.append(filter.column, `${filter.op}.${encodeFilterValue(filter.value)}`);
    }

    if (order) {
      url.searchParams.set('order', order);
    }

    if (limit) {
      url.searchParams.set('limit', String(limit));
    }

    if (onConflict) {
      url.searchParams.set('on_conflict', onConflict);
    }

    const headers = this.baseHeaders(auth, session?.access_token);

    if (prefer) {
      headers.Prefer = prefer;
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (maybeSingle && response.status === 406) {
      return null;
    }

    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(data?.message || data?.hint || data?.error || 'Supabase-Anfrage fehlgeschlagen.');
    }

    if (maybeSingle && Array.isArray(data)) {
      return data[0] || null;
    }

    return data;
  }

  selectRows(table, options = {}) {
    return this.restRequest(table, {
      ...options,
      method: 'GET'
    });
  }

  insertRows(table, body, options = {}) {
    return this.restRequest(table, {
      ...options,
      method: 'POST',
      body,
      prefer: options.prefer || 'return=representation'
    });
  }

  upsertRows(table, body, onConflict, options = {}) {
    return this.restRequest(table, {
      ...options,
      method: 'POST',
      body,
      onConflict,
      prefer: options.prefer || 'resolution=merge-duplicates,return=representation'
    });
  }

  updateRows(table, body, filters, options = {}) {
    return this.restRequest(table, {
      ...options,
      method: 'PATCH',
      body,
      filters,
      prefer: options.prefer || 'return=representation'
    });
  }

  publicStorageUrl(bucket, objectPath) {
    return `${this.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeStoragePath(objectPath)}`;
  }

  async uploadStorageObject(bucket, objectPath, file, { upsert = true } = {}) {
    const session = await this.ensureSession();

    if (!session) {
      throw new Error('Bitte erneut einloggen.');
    }

    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(objectPath)}`,
      {
        method: 'POST',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': file.type || 'application/octet-stream',
          'cache-control': '3600',
          'x-upsert': upsert ? 'true' : 'false'
        },
        body: file
      }
    );

    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(data?.message || data?.error || 'Bild konnte nicht in Supabase Storage hochgeladen werden.');
    }

    return {
      path: objectPath,
      publicUrl: this.publicStorageUrl(bucket, objectPath),
      data
    };
  }

  async deleteStorageObjects(bucket, objectPaths = []) {
    const session = await this.ensureSession();

    if (!session) {
      throw new Error('Bitte erneut einloggen.');
    }

    const prefixes = objectPaths.map((entry) => String(entry || '').trim()).filter(Boolean);

    if (!prefixes.length) {
      return null;
    }

    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
      {
        method: 'DELETE',
        headers: this.baseHeaders(true, session.access_token),
        body: JSON.stringify({ prefixes })
      }
    );

    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(data?.message || data?.error || 'Logo konnte nicht aus Supabase Storage entfernt werden.');
    }

    return data;
  }
}

export async function createSupabaseRestClient() {
  const config = await loadPublicConfig();
  return new SupabaseRestClient(config);
}
