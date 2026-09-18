import { getMemories, memoryContext, saveMemory } from '../lib/theophany';

export const config = { runtime: 'nodejs' };

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });

  const text = String(req.body?.text || '').trim();
  const sessionId = String(req.body?.session_id || 'browser-session').trim().slice(0, 120);
  if (!text) return res.status(400).json({ ok: false, message: 'Message is required.' });

  try {
    const memories = await getMemories(sessionId, 16).catch(() => []);
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.THEOPHANY_MODEL || 'gpt-5.4-mini',
        input: [
          {
            role: 'system',
            content: `You are Theophany in Chat Mode. Have a natural, concise conversation with the user. Chat Mode can discuss general topics, planning, updates, projects, goals, and everyday questions. Do not build or deploy software in Chat Mode; if the user asks to build software, tell them to switch to Agent Mode. Use the shared session memory below when relevant and never invent facts. SHARED SESSION MEMORY:\n${memoryContext(memories)}`,
          },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
    const data: any = await response.json();
    const reply = String(
      data.output_text ||
      data.output?.map((x: any) => x.content?.map((c: any) => c.text || '').join('')).join('') ||
      ''
    ).trim();

    if (!reply) throw new Error('The chat service returned no response.');

    await saveMemory(sessionId, `Chat: User said: ${text}`, 'chat_user', 5).catch(() => {});
    await saveMemory(sessionId, `Chat: Theophany replied: ${reply.slice(0, 1200)}`, 'chat_assistant', 5).catch(() => {});

    return res.status(200).json({ ok: true, reply, memories_used: memories.length });
  } catch (error: any) {
    console.error('THEOPHANY_CHAT_ERROR', error);
    return res.status(500).json({ ok: false, message: error?.message || 'Chat service failed.' });
  }
}
