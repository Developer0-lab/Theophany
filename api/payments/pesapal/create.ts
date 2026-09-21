import { createPayment, recordTransaction } from '../../../lib/pesapal';
export const config = { runtime: 'nodejs' };
export default async function handler(req: any, res: any) {
  const action = String(req.query?.action || 'create').toLowerCase();
  try {
    if (action === 'status') {
      if (req.method !== 'GET') return res.status(405).json({ ok:false, message:'Method not allowed' });
      const trackingId = String(req.query?.orderTrackingId || req.query?.OrderTrackingId || '').trim();
      if (!trackingId) return res.status(400).json({ ok:false, message:'orderTrackingId is required.' });
      return res.status(200).json({ ok:true, ...(await recordTransaction(trackingId)) });
    }
    if (action === 'ipn') {
      if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok:false });
      const source = req.method === 'GET' ? req.query : (req.body || {});
      const trackingId = String(source?.OrderTrackingId || source?.orderTrackingId || '').trim();
      const merchantReference = String(source?.OrderMerchantReference || source?.orderMerchantReference || '').trim();
      if (!trackingId) return res.status(400).json({ ok:false, message:'OrderTrackingId is required.' });
      const result = await recordTransaction(trackingId, merchantReference || undefined);
      return res.status(200).json({ ok:true, OrderNotificationType:source?.OrderNotificationType || source?.orderNotificationType || 'IPNCHANGE', OrderTrackingId:trackingId, OrderMerchantReference:merchantReference, payment_status:result.status });
    }
    if (action === 'callback') {
      if (req.method !== 'GET') return res.status(405).json({ ok:false });
      const trackingId = String(req.query?.OrderTrackingId || req.query?.orderTrackingId || '').trim();
      const merchantReference = String(req.query?.OrderMerchantReference || req.query?.orderMerchantReference || '').trim();
      const incomingStatus = String(req.query?.status || '').trim();
      if (trackingId) await recordTransaction(trackingId, merchantReference || undefined);
      const params = new URLSearchParams();
      if (trackingId) params.set('orderTrackingId', trackingId);
      if (merchantReference) params.set('merchantReference', merchantReference);
      if (incomingStatus) params.set('status', incomingStatus);
      return res.redirect('/?payment=pesapal&' + params.toString());
    }
    if (req.method !== 'POST') return res.status(405).json({ ok:false, message:'Method not allowed' });
    const body = req.body || {};
    const sessionId = String(body.session_id || '').trim().slice(0,120);
    const amount = Number(body.amount);
    const currency = String(body.currency || 'UGX').trim().toUpperCase();
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();
    if (!sessionId) return res.status(400).json({ ok:false, message:'session_id is required.' });
    if (!email || !phone) return res.status(400).json({ ok:false, message:'Customer email and phone are required.' });
    const payment = await createPayment({ sessionId, amount, currency, description:String(body.description || 'Theophany payment'), email, phone, firstName:String(body.first_name || ''), middleName:String(body.middle_name || ''), lastName:String(body.last_name || ''), countryCode:String(body.country_code || 'UG').toUpperCase() });
    return res.status(200).json({ ok:true, ...payment });
  } catch (error:any) {
    console.error('THEOPHANY_PESAPAL_ERROR', error);
    if (action === 'callback') return res.redirect('/?payment=pesapal&status=error');
    return res.status(500).json({ ok:false, message:error?.message || 'PesaPal request failed.' });
  }
}
