type VercelRequest = { method?: string; body?: any };
type VercelResponse = { status: (code:number)=>VercelResponse; json:(body:any)=>void };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, message:'Method not allowed.' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ ok:false, message:'OPENAI_API_KEY is not configured.' });

  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ ok:false, message:'An image prompt is required.' });
  if (prompt.length > 4000) return res.status(400).json({ ok:false, message:'Image prompt is too long.' });

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt,
        size: '1024x1024',
        quality: 'auto',
        output_format: 'png'
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || 'OpenAI image generation failed.';
      return res.status(response.status >= 500 ? 502 : response.status).json({ ok:false, message });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ ok:false, message:'OpenAI returned no image data.' });

    return res.status(200).json({
      ok:true,
      image:{ mimeType:'image/png', dataUrl:`data:image/png;base64,${b64}` },
      model:'gpt-image-2'
    });
  } catch {
    return res.status(502).json({ ok:false, message:'Could not reach OpenAI image generation.' });
  }
}
