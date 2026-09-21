import { createPayment } from '../../../lib/pesapal';
export const config = { runtime: 'nodejs' };
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const body = req.body || {};
    const sessionId = String(body.session_id || '').trim().slice(0, 120);
    const amount = Number(body.amount);
    const currency = String(body.currency || 'UGX').trim().toUpperCase();
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();
    if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
    if (!email || !phone) return res.status(400).json({ ok: false, message: 'Customer email and phone are required.' });
    const payment = await createPayment({ sessionId, amount, currency, description: String(body.description || 'Theophany payment'), email, phone, firstName: String(body.first_name || ''), middleName: String(body.middle_name || ''), lastName: String(body.last_name || ''), countryCode: String(body.country_code || 'UG').toUpperCase() });
    return res.status(200).json({ ok: true, ...payment });
  } catch (error: any) {
    console.error('THEOPHANY_PESAPAL_CREATE_ERROR', error);
    return res.status(500).json({ ok: false, message: error?.message || 'Could not create PesaPal payment.' });
  }
}
