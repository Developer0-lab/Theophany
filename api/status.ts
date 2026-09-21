import { configuredIntegrations } from '../lib/integrationRegistry';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  return res.status(200).json({ ok: true, configured: configuredIntegrations() });
}
