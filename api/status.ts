export default function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const configured = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    github: Boolean(process.env.GITHUB_TOKEN),
    supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    vercel: Boolean(process.env.VERCEL_TOKEN),
  };
  return res.status(200).json({ ok: true, configured });
}
