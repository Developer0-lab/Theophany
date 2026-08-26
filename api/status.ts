export default function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const configured = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    github: Boolean(process.env.GITHUB_TOKEN),
    supabase: Boolean(process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF),
    vercel: Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID),
  };
  return res.status(200).json({ ok: true, configured });
}
