import { integrationRegistry } from '../lib/integrationRegistry.js';

type Stage = { id: string; name: string; category?: string; message: string; ok: boolean; configured: boolean };
const json = (res: any, status: number, body: any) => res.status(status).json(body);

async function runCheck(integration: (typeof integrationRegistry)[number]): Promise<Stage> {
  const configured = integration.configured();
  if (!configured) return { id: integration.id, name: integration.name, category: integration.category, message: 'Not configured.', ok: false, configured: false };
  try {
    const result = await Promise.race([
      integration.check(),
      new Promise<{ ok: boolean; message: string }>((_, reject) => setTimeout(() => reject(new Error('Health check timed out after 10 seconds.')), 10000))
    ]);
    return { id: integration.id, name: integration.name, category: integration.category, message: result.message, ok: result.ok, configured: true };
  } catch (error: any) {
    return { id: integration.id, name: integration.name, category: integration.category, message: error?.message || 'Connection check failed.', ok: false, configured: true };
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, message: 'Method not allowed' });
  try {
    const stages = await Promise.all(integrationRegistry.map(runCheck));
    const passed = stages.filter(s => s.ok).length;
    return json(res, 200, { ok: passed === stages.length, passed, total: stages.length, stages });
  } catch (error: any) {
    return json(res, 500, { ok: false, message: error?.message || 'System check failed.', stages: [] });
  }
}
