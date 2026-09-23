import { configuredIntegrations } from '../lib/integrationRegistry.js';
import { getBudgetStatus, setMonthlyBudget } from '../lib/budget.js';

function readBody(req: any) {
  if (!req?.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method === 'GET') {
      const budget = await getBudgetStatus();
      return res.status(200).json({ ok: true, configured: configuredIntegrations(), ...budget });
    }
    if (req.method === 'POST') {
      const body = readBody(req);
      const budgetUsd = Number(body.budgetUsd);
      if (!Number.isFinite(budgetUsd) || budgetUsd < 1 || budgetUsd > 100000) {
        return res.status(400).json({ ok: false, message: 'Monthly budget must be between $1 and $100,000.' });
      }
      return res.status(200).json({ ok: true, ...(await setMonthlyBudget(budgetUsd)) });
    }
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  } catch (error: any) {
    console.error('THEOPHANY_STATUS_ERROR', error);
    return res.status(500).json({ ok: false, message: error?.message || 'Status operation failed.' });
  }
}
