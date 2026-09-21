import { getMemories, memoryContext, saveMemory } from '../lib/theophany.js';
import { getIntegrationToken, getIntegrationStatuses } from '../lib/integrations/oauth.js';

type FileChange = { path: string; content: string };
type BuildResult = { summary: string; files: FileChange[]; sql?: string };
const stage = (events: any[], name: string, message: string, done = false) => events.push({ stage: name, message, done });
async function askModel(request: string, needsSupabase: boolean, memories: string): Promise<BuildResult> {
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.THEOPHANY_MODEL || 'gpt-5.4-mini', input: [{ role: 'system', content: `You are Theophany, an autonomous software builder. Return ONLY valid JSON with keys summary, files, and optional sql. files is an array of {path,content}. Make a coherent minimal implementation for the user request. Never include secrets. Use the memory below only when relevant; do not invent facts. SESSION MEMORY:\n${memories}\n${needsSupabase ? 'The request requires Supabase. Return sql containing only the necessary PostgreSQL DDL/RLS/storage metadata setup for the requested app. Enable RLS on every exposed public table and use ownership-aware policies. Do not create SECURITY DEFINER functions. Keep SQL idempotent where practical.' : 'Do not return sql.'}` }, { role: 'user', content: request }], text: { format: { type: 'json_object' } } }) });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
  const data: any = await response.json();
  const output = data.output_text || data.output?.map((x: any) => x.content?.map((c: any) => c.text || '').join('')).join('');
  if (!output) throw new Error('The AI builder returned no output.');
  return JSON.parse(output);
}
async function commitFiles(files: FileChange[], message: string) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.THEOPHANY_GITHUB_REPO || 'Developer0-lab/Theophany';
  if (!token) throw new Error('GITHUB_TOKEN is not configured.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  const results: string[] = [];
  for (const file of files) {
    const url = `https://api.github.com/repos/${repo}/contents/${file.path}`;
    const existing = await fetch(url, { headers });
    let sha: string | undefined;
    if (existing.ok) sha = (await existing.json()).sha;
    const body: any = { message, content: Buffer.from(file.content, 'utf8').toString('base64') };
    if (sha) body.sha = sha;
    const saved = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error(`GitHub rejected ${file.path} (${saved.status}).`);
    results.push(file.path);
  }
  return results;
}
async function provisionSupabase(sql: string) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!token || !projectRef) throw new Error('Supabase provisioning requires SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.');
  if (!sql.trim()) throw new Error('The AI requested Supabase but returned no SQL.');
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  if (!response.ok) { const detail = await response.text(); throw new Error(`Supabase provisioning failed (${response.status}): ${detail.slice(0, 500)}`); }
  return await response.json().catch(() => ({}));
}
async function findVercelDeployment(commitSha: string) {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;
  const r = await fetch(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=20&target=production`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Vercel returned HTTP ${r.status}.`);
  const data: any = await r.json();
  return (data.deployments || []).find((d: any) => d.meta?.githubCommitSha === commitSha) || null;
}

async function googleFetch(sessionId: string, provider: string, url: string, init: any = {}) {
  let access = (await getIntegrationToken(sessionId, provider, 'access')) || '';
  if (!access) throw new Error(`Connect ${provider === 'gmail' ? 'Gmail' : provider === 'google-drive' ? 'Google Drive' : 'Google Calendar'} first.`);
  const call = async (token: string) => fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  let response = await call(access);
  if (response.status === 401) {
    const refreshToken = await getIntegrationToken(sessionId, provider, 'refresh');
    if (refreshToken) {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      if (tokenResponse.ok) {
        const tokenData: any = await tokenResponse.json();
        if (tokenData.access_token) {
          access = tokenData.access_token;
          response = await call(access);
        }
      }
    }
  }
  return response;
}

function connectedProviderSet(statuses: any[]) {
  return new Set((statuses || []).filter((x: any) => x?.status === 'connected').map((x: any) => x.provider));
}

function agentTools(providers: Set<string>) {
  const tools: any[] = [];
  if (providers.has('gmail')) {
    tools.push(
      { type: 'function', name: 'gmail_search', description: 'Search the user\'s Gmail messages. Use a Gmail search query such as newer_than:7d, from:alice@example.com, or subject:invoice.', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'], additionalProperties: false } },
      { type: 'function', name: 'gmail_get_message', description: 'Read one Gmail message by its message id.', parameters: { type: 'object', properties: { message_id: { type: 'string' } }, required: ['message_id'], additionalProperties: false } },
      { type: 'function', name: 'gmail_send', description: 'Send an email from the connected Gmail account.', parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'], additionalProperties: false } }
    );
  }
  if (providers.has('google-drive')) {
    tools.push(
      { type: 'function', name: 'drive_search', description: 'Search files in the connected Google Drive. Return matching file metadata.', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'], additionalProperties: false } },
      { type: 'function', name: 'drive_create_text_file', description: 'Create a plain text file in Google Drive.', parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' }, folder_id: { type: 'string' } }, required: ['name', 'content'], additionalProperties: false } }
    );
  }
  if (providers.has('domains') || process.env.VERCEL_TOKEN) {
    tools.push(
      { type: 'function', name: 'domain_search', description: 'Search a domain name for availability and current registration pricing through Vercel Domains.', parameters: { type: 'object', properties: { domain: { type: 'string' } }, required: ['domain'], additionalProperties: false } },
      { type: 'function', name: 'domain_attach', description: 'Attach an already-owned domain to the configured Theophany Vercel project. Use only when the user has explicitly asked to connect that domain.', parameters: { type: 'object', properties: { domain: { type: 'string' }, project_id: { type: 'string' } }, required: ['domain'], additionalProperties: false } }
    );
  }
  if (providers.has('facebook') || providers.has('instagram')) {
    tools.push(
      { type: 'function', name: 'facebook_list_pages', description: 'List Facebook Pages available to the connected Meta account, including page ids and access tokens. Use this before publishing to identify the requested Page.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
      { type: 'function', name: 'facebook_publish_post', description: 'Publish a text post to a Facebook Page. Only use when the user clearly asks Theophany to publish/post it. Never claim publication unless the API succeeds.', parameters: { type: 'object', properties: { page_id: { type: 'string' }, message: { type: 'string' } }, required: ['page_id','message'], additionalProperties: false } },
      { type: 'function', name: 'instagram_list_accounts', description: 'List Instagram professional accounts connected to the available Facebook Pages. Use this before publishing to identify the requested Instagram account.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
      { type: 'function', name: 'instagram_publish_image', description: 'Publish an image to an Instagram professional account. The image_url must be publicly reachable by Meta. Only use when the user clearly asks Theophany to publish it.', parameters: { type: 'object', properties: { instagram_account_id: { type: 'string' }, image_url: { type: 'string' }, caption: { type: 'string' } }, required: ['instagram_account_id','image_url'], additionalProperties: false } }
    );
  }
  if (providers.has('youtube')) {
    tools.push(
      { type: 'function', name: 'youtube_get_channel', description: 'Get the connected YouTube channel details. Use this to identify the channel before managing content.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
      { type: 'function', name: 'youtube_list_videos', description: 'List recent videos on the connected YouTube channel.', parameters: { type: 'object', properties: { max_results: { type: 'integer', minimum: 1, maximum: 25 } }, required: [], additionalProperties: false } },
      { type: 'function', name: 'youtube_upload_video', description: 'Upload a video to the connected YouTube channel. Only use when the user clearly asks Theophany to upload/publish it. video_url must be publicly reachable by the Theophany server. The API may keep uploads private until the Google API project is verified.', parameters: { type: 'object', properties: { video_url: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, privacy_status: { type: 'string', enum: ['private','unlisted','public'] }, tags: { type: 'array', items: { type: 'string' }, maxItems: 30 }, category_id: { type: 'string' } }, required: ['video_url','title'], additionalProperties: false } }
    );
  }
  if (providers.has('google-calendar')) {
    tools.push(
      { type: 'function', name: 'calendar_list_events', description: 'List upcoming events from the connected Google Calendar.', parameters: { type: 'object', properties: { max_results: { type: 'integer', minimum: 1, maximum: 20 }, days: { type: 'integer', minimum: 1, maximum: 30 } }, required: [], additionalProperties: false } },
      { type: 'function', name: 'calendar_create_event', description: 'Create an event on the connected Google Calendar. Use ISO 8601 date-times with timezone offsets.', parameters: { type: 'object', properties: { summary: { type: 'string' }, description: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, timezone: { type: 'string' } }, required: ['summary', 'start', 'end'], additionalProperties: false } }
    );
  }
  return tools;
}

async function executeAgentTool(sessionId: string, name: string, args: any): Promise<any> {
  if (name === 'domain_search') {
    const domain = String(args.domain || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\\.[a-z]{2,}$/.test(domain)) throw new Error('Please provide a valid domain name.');
    if (!process.env.VERCEL_TOKEN) throw new Error('Vercel domain access is not configured.');
    const r = await fetch('https://api.vercel.com/v1/registrar/domains/' + encodeURIComponent(domain) + '/availability', { headers: { Authorization: 'Bearer ' + process.env.VERCEL_TOKEN, Accept: 'application/json' } });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || data?.message || `Domain search failed (${r.status}).`);
    return { domain, ...data };
  }
  if (name === 'domain_attach') {
    const domain = String(args.domain || '').trim().toLowerCase();
    const projectId = String(args.project_id || process.env.VERCEL_PROJECT_ID || '').trim();
    const teamId = String(process.env.VERCEL_TEAM_ID || '').trim();
    if (!projectId) throw new Error('VERCEL_PROJECT_ID is not configured.');
    if (!/^[a-z0-9.-]+\\.[a-z]{2,}$/.test(domain)) throw new Error('Please provide a valid domain name.');
    const query = teamId ? '?teamId=' + encodeURIComponent(teamId) : '';
    const r = await fetch('https://api.vercel.com/v9/projects/' + encodeURIComponent(projectId) + '/domains' + query, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.VERCEL_TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: domain }) });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || data?.message || `Domain attach failed (${r.status}).`);
    return { attached: true, domain, ...data };
  }
  if (name === 'facebook_list_pages') {
    const access = await getIntegrationToken(sessionId, 'facebook', 'access');
    if (!access) throw new Error('Connect Facebook first.');
    const r = await fetch('https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=' + encodeURIComponent(access));
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || 'Facebook Page lookup failed.');
    return { pages: (data.data || []).map((p: any) => ({ id: p.id, name: p.name, access_token: p.access_token, instagram_business_account: p.instagram_business_account || null })) };
  }
  if (name === 'facebook_publish_post') {
    const pageId = String(args.page_id || '').trim();
    const message = String(args.message || '').trim();
    if (!pageId || !message) throw new Error('page_id and message are required.');
    const access = await getIntegrationToken(sessionId, 'facebook', 'access');
    if (!access) throw new Error('Connect Facebook first.');
    const pagesResponse = await fetch('https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token&access_token=' + encodeURIComponent(access));
    const pages: any = await pagesResponse.json().catch(() => ({}));
    if (!pagesResponse.ok) throw new Error(pages.error?.message || 'Facebook Page lookup failed.');
    const page = (pages.data || []).find((p: any) => String(p.id) === pageId);
    if (!page?.access_token) throw new Error('The requested Facebook Page is not available to the connected account.');
    const r = await fetch('https://graph.facebook.com/v23.0/' + encodeURIComponent(pageId) + '/feed', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ message, access_token: page.access_token }) });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data.id) throw new Error(data.error?.message || 'Facebook publication failed.');
    return { published: true, platform: 'facebook', page_id: pageId, page_name: page.name, post_id: data.id };
  }
  if (name === 'instagram_list_accounts') {
    const access = await getIntegrationToken(sessionId, 'instagram', 'access');
    if (!access) throw new Error('Connect Instagram first.');
    const r = await fetch('https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=' + encodeURIComponent(access));
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || 'Instagram account lookup failed.');
    return { accounts: (data.data || []).filter((p: any) => p.instagram_business_account?.id).map((p: any) => ({ instagram_account_id: p.instagram_business_account.id, facebook_page_id: p.id, facebook_page_name: p.name, page_access_token: p.access_token })) };
  }
  if (name === 'instagram_publish_image') {
    const accountId = String(args.instagram_account_id || '').trim();
    const imageUrl = String(args.image_url || '').trim();
    const caption = String(args.caption || '');
    if (!accountId || !imageUrl) throw new Error('instagram_account_id and image_url are required.');
    let access = await getIntegrationToken(sessionId, 'instagram', 'access');
    if (!access) throw new Error('Connect Instagram first.');
    const pagesResponse = await fetch('https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=' + encodeURIComponent(access));
    const pages: any = await pagesResponse.json().catch(() => ({}));
    if (!pagesResponse.ok) throw new Error(pages.error?.message || 'Instagram Page lookup failed.');
    const page = (pages.data || []).find((p: any) => String(p.instagram_business_account?.id) === accountId);
    if (!page?.access_token) throw new Error('The requested Instagram professional account is not available.');
    const create = await fetch('https://graph.facebook.com/v23.0/' + encodeURIComponent(accountId) + '/media', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ image_url: imageUrl, caption, access_token: page.access_token }) });
    const container: any = await create.json().catch(() => ({}));
    if (!create.ok || !container.id) throw new Error(container.error?.message || 'Instagram media container creation failed.');
    const publish = await fetch('https://graph.facebook.com/v23.0/' + encodeURIComponent(accountId) + '/media_publish', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: container.id, access_token: page.access_token }) });
    const result: any = await publish.json().catch(() => ({}));
    if (!publish.ok || !result.id) throw new Error(result.error?.message || 'Instagram publication failed.');
    return { published: true, platform: 'instagram', instagram_account_id: accountId, media_id: result.id };
  }
  if (name === 'youtube_get_channel') {
    const r = await googleFetch(sessionId, 'youtube', 'https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true');
    if (!r.ok) throw new Error(`YouTube channel lookup failed (${r.status}).`);
    const data: any = await r.json();
    const channel = data.items?.[0];
    if (!channel) throw new Error('No YouTube channel is available for the connected Google account.');
    return { id: channel.id, title: channel.snippet?.title, description: channel.snippet?.description, thumbnails: channel.snippet?.thumbnails, uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads, statistics: channel.statistics };
  }
  if (name === 'youtube_list_videos') {
    const max = Math.min(Math.max(Number(args.max_results || 10), 1), 25);
    const channelResponse = await googleFetch(sessionId, 'youtube', 'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true');
    if (!channelResponse.ok) throw new Error(`YouTube channel lookup failed (${channelResponse.status}).`);
    const channelData: any = await channelResponse.json();
    const uploads = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error('The connected YouTube channel has no uploads playlist.');
    const r = await googleFetch(sessionId, 'youtube', 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=' + encodeURIComponent(uploads) + '&maxResults=' + max);
    if (!r.ok) throw new Error(`YouTube video list failed (${r.status}).`);
    const data: any = await r.json();
    return { videos: (data.items || []).map((x: any) => ({ id: x.contentDetails?.videoId, title: x.snippet?.title, description: x.snippet?.description, published_at: x.snippet?.publishedAt, thumbnail: x.snippet?.thumbnails?.high?.url || x.snippet?.thumbnails?.default?.url })) };
  }
  if (name === 'youtube_upload_video') {
    const videoUrl = String(args.video_url || '').trim();
    const title = String(args.title || '').trim();
    if (!videoUrl || !title) throw new Error('video_url and title are required.');
    const source = await fetch(videoUrl);
    if (!source.ok || !source.body) throw new Error(`Could not fetch the video source (${source.status}).`);
    const contentType = source.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('video/') && contentType !== 'application/octet-stream') throw new Error('The video_url did not return a supported video file.');
    const metadata = {
      snippet: {
        title: title.slice(0, 100),
        description: String(args.description || '').slice(0, 5000),
        tags: Array.isArray(args.tags) ? args.tags.map((x: any) => String(x)).filter(Boolean).slice(0, 30) : undefined,
        categoryId: String(args.category_id || '22'),
      },
      status: { privacyStatus: ['private','unlisted','public'].includes(String(args.privacy_status || 'private')) ? String(args.privacy_status || 'private') : 'private' }
    };
    const init = await googleFetch(sessionId, 'youtube', 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': contentType, ...(source.headers.get('content-length') ? { 'X-Upload-Content-Length': source.headers.get('content-length')! } : {}) }, body: JSON.stringify(metadata) });
    if (!init.ok) throw new Error(`YouTube upload initialization failed (${init.status}).`);
    const uploadUrl = init.headers.get('location');
    if (!uploadUrl) throw new Error('YouTube did not return an upload URL.');
    const uploadResponse = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, ...(source.headers.get('content-length') ? { 'Content-Length': source.headers.get('content-length')! } : {}) }, body: source.body as any, duplex: 'half' } as any);
    const result: any = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok || !result.id) throw new Error(result.error?.message || `YouTube upload failed (${uploadResponse.status}).`);
    return { uploaded: true, platform: 'youtube', video_id: result.id, url: 'https://www.youtube.com/watch?v=' + result.id, title: result.snippet?.title, privacy_status: result.status?.privacyStatus };
  }
  if (name === 'gmail_search') {
    const query = encodeURIComponent(String(args.query || ''));
    const max = Math.min(Math.max(Number(args.max_results || 5), 1), 10);
    const r = await googleFetch(sessionId, 'gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${max}`);
    if (!r.ok) throw new Error(`Gmail search failed (${r.status}).`);
    const data: any = await r.json();
    return { messages: (data.messages || []).map((m: any) => ({ id: m.id, threadId: m.threadId })), resultSizeEstimate: data.resultSizeEstimate || 0 };
  }
  if (name === 'gmail_get_message') {
    const id = encodeURIComponent(String(args.message_id || ''));
    const r = await googleFetch(sessionId, 'gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
    if (!r.ok) throw new Error(`Gmail message read failed (${r.status}).`);
    const data: any = await r.json();
    return { id: data.id, snippet: data.snippet, headers: data.payload?.headers || [] };
  }
  if (name === 'gmail_send') {
    const raw = [
      `To: ${args.to}`,
      `Subject: ${args.subject}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      String(args.body || ''),
    ].join('\\r\\n');
    const encoded = Buffer.from(raw, 'utf8').toString('base64url');
    const r = await googleFetch(sessionId, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: encoded }) });
    if (!r.ok) throw new Error(`Gmail send failed (${r.status}).`);
    const data: any = await r.json();
    return { sent: true, id: data.id, threadId: data.threadId };
  }
  if (name === 'drive_search') {
    const q = String(args.query || '').replace(/'/g, "\\'");
    const max = Math.min(Math.max(Number(args.max_results || 10), 1), 10);
    const r = await googleFetch(sessionId, 'google-drive', `https://www.googleapis.com/drive/v3/files?q=name contains '${q}' and trashed=false&orderBy=modifiedTime desc&pageSize=${max}&fields=files(id,name,mimeType,webViewLink,modifiedTime,size)`);
    if (!r.ok) throw new Error(`Google Drive search failed (${r.status}).`);
    const data: any = await r.json();
    return { files: data.files || [] };
  }
  if (name === 'drive_create_text_file') {
    const metadata: any = { name: String(args.name), mimeType: 'text/plain' };
    if (args.folder_id) metadata.parents = [String(args.folder_id)];
    const boundary = 'theophany_' + crypto.randomUUID();
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      String(args.content || ''),
      `--${boundary}--`,
      '',
    ].join('\\r\\n');
    const r = await googleFetch(sessionId, 'google-drive', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    if (!r.ok) throw new Error(`Google Drive create failed (${r.status}).`);
    return await r.json();
  }
  if (name === 'calendar_list_events') {
    const max = Math.min(Math.max(Number(args.max_results || 10), 1), 20);
    const days = Math.min(Math.max(Number(args.days || 7), 1), 30);
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + days * 86400000).toISOString();
    const r = await googleFetch(sessionId, 'google-calendar', `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=${max}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
    if (!r.ok) throw new Error(`Google Calendar read failed (${r.status}).`);
    const data: any = await r.json();
    return { events: (data.items || []).map((e: any) => ({ id: e.id, summary: e.summary, start: e.start, end: e.end, location: e.location })) };
  }
  if (name === 'calendar_create_event') {
    const event: any = { summary: String(args.summary), start: { dateTime: String(args.start), timeZone: String(args.timezone || 'UTC') }, end: { dateTime: String(args.end), timeZone: String(args.timezone || 'UTC') } };
    if (args.description) event.description = String(args.description);
    const r = await googleFetch(sessionId, 'google-calendar', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
    if (!r.ok) throw new Error(`Google Calendar create failed (${r.status}).`);
    const data: any = await r.json();
    return { created: true, id: data.id, summary: data.summary, htmlLink: data.htmlLink, start: data.start, end: data.end };
  }
  throw new Error(`Unknown agent tool: ${name}`);
}

async function runServiceAgent(sessionId: string, request: string, memories: any[], events: any[]) {
  const statuses = await getIntegrationStatuses(sessionId).catch(() => []);
  const providers = connectedProviderSet(statuses);
  const tools = agentTools(providers);
  if (!tools.length) return null;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.THEOPHANY_MODEL || 'gpt-5.4-mini',
      input: [
        { role: 'system', content: `You are Theophany Agent Mode. You build software AND can operate connected Google services through tools. Use tools when the user asks you to read/search/send Gmail, manage Google Drive files, or read/create Google Calendar events. Do not claim an action happened unless the tool succeeded. Keep responses concise. Shared memory: ${memoryContext(memories)}` },
        { role: 'user', content: request },
      ],
      tools,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI agent request failed (${response.status}).`);
  let data: any = await response.json();
  let input = data.output || [];
  for (let round = 0; round < 6; round++) {
    const calls = input.filter((x: any) => x?.type === 'function_call');
    if (!calls.length) {
      const reply = String(data.output_text || '').trim();
      return reply || null;
    }
    const outputs: any[] = [];
    for (const call of calls) {
      const args = JSON.parse(call.arguments || '{}');
      stage(events, 'Agent', `Using connected service: ${call.name}.`);
      try {
        const result = await executeAgentTool(sessionId, call.name, args);
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
        stage(events, 'Agent', `${call.name} completed.`, true);
      } catch (error: any) {
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: error?.message || 'Tool failed.' }) });
        stage(events, 'Agent', `${call.name} failed.`);
      }
    }
    const follow = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.THEOPHANY_MODEL || 'gpt-5.4-mini', previous_response_id: data.id, input: outputs, tools }),
    });
    if (!follow.ok) throw new Error(`OpenAI agent continuation failed (${follow.status}).`);
    data = await follow.json();
    input = data.output || [];
  }
  throw new Error('Agent tool loop reached its safety limit.');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  const text = String(req.body?.text || '').trim();
  const sessionId = String(req.body?.session_id || 'browser-session').trim().slice(0, 120);
  if (!text) return res.status(400).json({ ok: false, message: 'Tell Theophany what to build.' });
  const events: any[] = [];
  try {
    stage(events, 'Understand', 'Reading your request.', true);
    const memories = await getMemories(sessionId, 12).catch(() => []);
    if (memories.length) stage(events, 'Memory', `Loaded ${memories.length} relevant memories.`, true);
    if (String(req.body?.mode || '').trim() === 'chat') {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.THEOPHANY_MODEL || 'gpt-5.4-mini',
          input: [
            { role: 'system', content: `You are Theophany in Chat Mode. Have a natural, concise conversation with the user. Discuss general topics, planning, updates, projects, goals, and everyday questions. Do not build or deploy software in Chat Mode; if the user asks to build software, tell them to switch to Agent Mode. Use the shared session memory below when relevant and never invent facts. SHARED SESSION MEMORY:\\n${memoryContext(memories)}` },
            { role: 'user', content: text },
          ],
        }),
      });
      if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
      const data: any = await response.json();
      const reply = String(data.output_text || data.output?.map((x: any) => x.content?.map((c: any) => c.text || '').join('')).join('') || '').trim();
      if (!reply) throw new Error('The chat service returned no response.');
      await saveMemory(sessionId, `Chat: User said: ${text}`, 'chat_user', 5).catch(() => {});
      await saveMemory(sessionId, `Chat: Theophany replied: ${reply.slice(0, 1200)}`, 'chat_assistant', 5).catch(() => {});
      stage(events, 'Memory', 'Shared chat context saved for Agent Mode.', true);
      return res.status(200).json({ ok: true, reply, events, memories_used: memories.length });
    }
    if (String(req.body?.mode || '').trim() === 'agent') { const serviceIntent = /\\b(gmail|email|emails|inbox|mail|google drive|drive file|drive files|calendar|calendars|meeting|meetings|schedule|scheduled|event|events)\\b/i.test(text); if (serviceIntent) { const serviceReply = await runServiceAgent(sessionId, text, memories, events); if (serviceReply) { await saveMemory(sessionId, `Agent: User requested: ${text}`, 'agent_user', 6).catch(() => {}); await saveMemory(sessionId, `Agent: Theophany replied: ${serviceReply.slice(0, 1200)}`, 'agent_service_result', 7).catch(() => {}); stage(events, 'Complete', 'Connected service work completed.', true); return res.status(200).json({ ok: true, message: serviceReply, events, service_agent: true }); } } }
    const lower = text.toLowerCase();
    const needsSupabase = /\bsupabase\b|database|authentication|auth|user accounts|storage|realtime|chat/.test(lower);
    const needsVercel = /\bvercel\b|deploy|publish|go live/.test(lower);
    stage(events, 'Plan', `Supabase: ${needsSupabase ? 'required' : 'not requested'} · Vercel: ${needsVercel ? 'required' : 'not requested'}`, true);
    const missing: string[] = [];
    if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
    if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
    if (needsSupabase && !process.env.SUPABASE_ACCESS_TOKEN) missing.push('SUPABASE_ACCESS_TOKEN');
    if (needsSupabase && !process.env.SUPABASE_PROJECT_REF) missing.push('SUPABASE_PROJECT_REF');
    if (missing.length) return res.status(200).json({ ok: false, message: `Connect/configure: ${missing.join(', ')}`, events, missing });
    stage(events, 'Build', 'The AI executor is generating the implementation.');
    const result = await askModel(text, needsSupabase, memoryContext(memories));
    if (!Array.isArray(result.files) || !result.files.length) throw new Error('The AI executor produced no files.');
    stage(events, 'Build', `Generated ${result.files.length} file${result.files.length === 1 ? '' : 's'}.`, true);
    if (needsSupabase) { stage(events, 'Supabase', 'Applying the generated database configuration.'); await provisionSupabase(result.sql || ''); stage(events, 'Supabase', 'Database configuration applied successfully.', true); }
    const committed = await commitFiles(result.files, `Theophany build: ${text.slice(0, 72)}`);
    stage(events, 'Test', 'Changes committed. Waiting for the connected Vercel Git deployment.');
    let deployment: any = null;
    if (process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID) {
      const repo = process.env.THEOPHANY_GITHUB_REPO || 'Developer0-lab/Theophany';
      const gh = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
      if (gh.ok) { const commits: any[] = await gh.json(); if (commits[0]?.sha) deployment = await findVercelDeployment(commits[0].sha); }
      if (deployment) stage(events, 'Deploy', `Vercel deployment ${deployment.id} is ${deployment.readyState || deployment.state}.`, deployment.readyState === 'READY' || deployment.state === 'READY');
      else stage(events, 'Deploy', 'GitHub accepted the build. Vercel deployment is queued or still propagating.', false);
    } else stage(events, 'Deploy', 'Vercel verification is not configured; Git integration will deploy the commit.', true);
    await saveMemory(sessionId, `User request: ${text}`, 'request', 6).catch(() => {});
    await saveMemory(sessionId, `Build result: ${result.summary || 'Build completed.'}`, 'build_result', 7, { files: committed }).catch(() => {});
    stage(events, 'Memory', 'Saved the important build context for next time.', true);
    stage(events, 'Complete', `Built and committed ${committed.length} file${committed.length === 1 ? '' : 's'}.`, true);
    return res.status(200).json({ ok: true, message: result.summary || 'Build completed.', events, files: committed, deployment: deployment ? { id: deployment.id, state: deployment.readyState || deployment.state, url: deployment.url } : null });
  } catch (error: any) { stage(events, 'Repair', error?.message || 'Build failed.'); return res.status(500).json({ ok: false, message: error?.message || 'Build failed.', events }); }
}
