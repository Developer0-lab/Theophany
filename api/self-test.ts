import { integrationRegistry } from '../lib/integrationRegistry';

type Stage = { id: string; name: string; category?: string; message: string; ok: boolean; configured: boolean };
const json = (res: any, status: number, body: any) => res.status(status).json(body);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, message: 'Method not allowed' });
  const stages: Stage[] = [];
  for (const integration of integrationRegistry) {
    const configured = integration.configured();
    if (!configured) {
      stages.push({ id: integration.id, name: integration.name, category: integration.category, message: 'Not configured.', ok: false, configured: false });
      continue;
    }
    try {
      const result = await integration.check();
      stages.push({ id: integration.id, name: integration.name, category: integration.category, message: result.message, ok: result.ok, configured: true });
    } catch (error: any) {
      stages.push({ id: integration.id, name: integration.name, category: integration.category, message: error?.message || 'Connection check failed.', ok: false, configured: true });
    }
  }
  const passed = stages.filter(s => s.ok).length;
  return json(res, 200, { ok: passed === stages.length, passed, total: stages.length, stages });
}
