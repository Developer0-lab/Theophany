import { getMemories, saveMemory } from '../lib/theophany';

export default async function handler(req: any, res: any) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, message: 'Method not allowed' });
  const sessionId = String(req.query?.session_id || req.body?.session_id || '').trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
  try {
    if (req.method === 'GET') return res.status(200).json({ ok: true, memories: await getMemories(sessionId, 30) });
    const content = String(req.body?.content || '').trim();
    const kind = String(req.body?.kind || 'context').trim().slice(0, 40);
    const importance = Number(req.body?.importance || 5);
    if (!content) return res.status(400).json({ ok: false, message: 'Memory content is required.' });
    await saveMemory(sessionId, content, kind, Number.isFinite(importance) ? importance : 5, req.body?.metadata || {});
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ ok: false, message: error?.message || 'Memory operation failed.' });
  }
}
