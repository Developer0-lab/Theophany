import crypto from 'crypto';
import { sqlText, supabaseQuery } from '../theophany';

let tablesReady = false;

async function ensureIntegrationTables() {
  if (tablesReady) return;
  const rows = await supabaseQuery<any>("select to_regclass('public.theophany_integrations') as integrations_table, to_regclass('public.theophany_oauth_states') as oauth_states_table;");
  if (!Array.isArray(rows) || !rows[0]?.integrations_table || !rows[0]?.oauth_states_table) throw new Error('Integration storage tables are not ready.');
  tablesReady = true;
}

function secretValue() {
  const value = process.env.THEOPHANY_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error('A server-side token encryption secret is not configured.');
  return value;
}

function key() { return crypto.createHash('sha256').update(secretValue(), 'utf8').digest(); }
function toBase64Url(data: Buffer) { return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function fromBase64Url(value: string) { const padded = String(value).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(value).length % 4) % 4); return Buffer.from(padded, 'base64'); }
function makeUuid() { return crypto.randomUUID(); }

function encryptToken(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return 'v2:' + toBase64Url(iv) + ':' + toBase64Url(cipher.getAuthTag()) + ':' + toBase64Url(ciphertext);
}

function decryptToken(value: string) {
  const parts = String(value).split(':');
  if (parts[0] !== 'v2' || !parts[1] || !parts[2] || !parts[3]) throw new Error('Invalid encrypted token.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), fromBase64Url(parts[1]));
  decipher.setAuthTag(fromBase64Url(parts[2]));
  return Buffer.concat([decipher.update(fromBase64Url(parts[3])), decipher.final()]).toString('utf8');
}

export async function saveOAuthState(sessionId: string, provider: string, metadata: Record<string, any> = {}) {
  await ensureIntegrationTables();
  const state = crypto.randomBytes(32).toString('hex');
  await supabaseQuery('insert into public.theophany_oauth_states(state,session_id,provider,expires_at,metadata) values (' + sqlText(state) + ',' + sqlText(sessionId) + ',' + sqlText(provider) + ",now()+interval '10 minutes'," + sqlText(JSON.stringify(metadata)) + "::jsonb);");
  return state;
}

export async function consumeOAuthState(state: string, provider: string) {
  await ensureIntegrationTables();
  const rows: any = await supabaseQuery('delete from public.theophany_oauth_states where state=' + sqlText(state) + ' and provider=' + sqlText(provider) + ' and expires_at>now() returning session_id,metadata;');
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.session_id) throw new Error('OAuth state is invalid or expired.');
  return { sessionId: row.session_id as string, metadata: row.metadata || {} };
}

export async function consumeOAuthStateAny(state: string) {
  await ensureIntegrationTables();
  const rows: any = await supabaseQuery('delete from public.theophany_oauth_states where state=' + sqlText(state) + ' and expires_at>now() returning session_id,provider,metadata;');
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.session_id || !row?.provider) throw new Error('OAuth state is invalid or expired.');
  return { sessionId: row.session_id as string, provider: row.provider as string, metadata: row.metadata || {} };
}

export async function saveIntegration(sessionId: string, provider: string, tokens: { accessToken: string; refreshToken?: string; expiresAt?: string; scopes?: string[]; metadata?: any }) {
  await ensureIntegrationTables();
  const id = makeUuid();
  const access = encryptToken(tokens.accessToken);
  const refresh = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;
  const expires = tokens.expiresAt ? sqlText(tokens.expiresAt) : 'null';
  const scopesValue = '{' + (tokens.scopes || []).map(s => s.replace(/[{}",\\]/g, '')).join(',') + '}';
  const scopes = sqlText(scopesValue);
  const metadata = sqlText(JSON.stringify(tokens.metadata || {}));
  await supabaseQuery('insert into public.theophany_integrations(id,session_id,provider,status,access_token,refresh_token,expires_at,scopes,metadata) values (' + sqlText(id) + ',' + sqlText(sessionId) + ',' + sqlText(provider) + ",'connected'," + sqlText(access) + ',' + (refresh ? sqlText(refresh) : 'null') + ',' + expires + ',' + scopes + '::text[],' + metadata + "::jsonb) on conflict(session_id,provider) do update set status='connected',access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes,metadata=excluded.metadata,updated_at=now();");
}

export async function getIntegrationStatuses(sessionId: string) {
  await ensureIntegrationTables();
  const rows: any = await supabaseQuery('select provider,status,expires_at,scopes,metadata,updated_at from public.theophany_integrations where session_id=' + sqlText(sessionId) + ' order by provider;');
  return Array.isArray(rows) ? rows : [];
}

export async function disconnectIntegration(sessionId: string, provider: string) {
  await ensureIntegrationTables();
  await supabaseQuery('delete from public.theophany_integrations where session_id=' + sqlText(sessionId) + ' and provider=' + sqlText(provider) + ';');
}

export async function getIntegrationToken(sessionId: string, provider: string, kind: 'access' | 'refresh' = 'access') {
  await ensureIntegrationTables();
  const rows: any = await supabaseQuery('select access_token,refresh_token from public.theophany_integrations where session_id=' + sqlText(sessionId) + ' and provider=' + sqlText(provider) + ' limit 1;');
  const row = Array.isArray(rows) ? rows[0] : null;
  const value = kind === 'refresh' ? row?.refresh_token : row?.access_token;
  return value ? decryptToken(value) : null;
}
