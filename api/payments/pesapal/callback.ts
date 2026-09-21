import { recordTransaction } from '../../../lib/pesapal';
export const config = { runtime: 'nodejs' };
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const trackingId = String(req.query?.OrderTrackingId || req.query?.orderTrackingId || '').trim();
  const merchantReference = String(req.query?.OrderMerchantReference || req.query?.orderMerchantReference || '').trim();
  const incomingStatus = String(req.query?.status || '').trim();
  try {
    if (trackingId) await recordTransaction(trackingId, merchantReference || undefined);
    const params = new URLSearchParams();
    if (trackingId) params.set('orderTrackingId', trackingId);
    if (merchantReference) params.set('merchantReference', merchantReference);
    if (incomingStatus) params.set('status', incomingStatus);
    return res.redirect('/?payment=pesapal&' + params.toString());
  } catch (error: any) {
    console.error('THEOPHANY_PESAPAL_CALLBACK_ERROR', error);
    return res.redirect('/?payment=pesapal&status=error');
  }
}
