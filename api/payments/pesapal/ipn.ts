import { recordTransaction } from '../../../lib/pesapal';
export const config = { runtime: 'nodejs' };
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false });
  try {
    const source = req.method === 'GET' ? req.query : (req.body || {});
    const trackingId = String(source?.OrderTrackingId || source?.orderTrackingId || '').trim();
    const merchantReference = String(source?.OrderMerchantReference || source?.orderMerchantReference || '').trim();
    if (!trackingId) return res.status(400).json({ ok: false, message: 'OrderTrackingId is required.' });
    const result = await recordTransaction(trackingId, merchantReference || undefined);
    return res.status(200).json({ ok: true, OrderNotificationType: source?.OrderNotificationType || source?.orderNotificationType || 'IPNCHANGE', OrderTrackingId: trackingId, OrderMerchantReference: merchantReference, payment_status: result.status });
  } catch (error: any) {
    console.error('THEOPHANY_PESAPAL_IPN_ERROR', error);
    return res.status(500).json({ ok: false, message: error?.message || 'IPN processing failed.' });
  }
}
