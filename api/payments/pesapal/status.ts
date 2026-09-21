import { recordTransaction } from '../../../lib/pesapal';
export const config = { runtime: 'nodejs' };
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const trackingId = String(req.query?.orderTrackingId || req.query?.OrderTrackingId || '').trim();
    if (!trackingId) return res.status(400).json({ ok: false, message: 'orderTrackingId is required.' });
    const result = await recordTransaction(trackingId);
    return res.status(200).json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ ok: false, message: error?.message || 'Could not fetch payment status.' });
  }
}
