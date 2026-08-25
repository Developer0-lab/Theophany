import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, ArrowUp, Sparkles, Volume2, Settings2, MessageCircle, X } from 'lucide-react';

export default function App() {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [status, setStatus] = useState('Tap the orb and tell me what to build.');
  const recognition = useRef<any>(null);
  const speak = (value: string) => { if (!('speechSynthesis' in window)) return; window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(value); u.rate = 1; u.onstart = () => setSpeaking(true); u.onend = () => setSpeaking(false); window.speechSynthesis.speak(u); };
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setStatus('Voice input is not supported in this browser.'); speak('Voice input is not supported in this browser.'); return; }
    if (listening) { recognition.current?.stop(); return; }
    const r = new SpeechRecognition(); r.lang = 'en-US'; r.continuous = false; r.interimResults = true;
    r.onstart = () => { setListening(true); setStatus('Listening…'); };
    r.onresult = (e: any) => { let transcript = ''; for (let i = e.resultIndex; i < e.results.length; i++) transcript += e.results[i][0].transcript; setText(transcript); if (e.results[e.results.length - 1].isFinal) { setStatus('I heard you. Ready to build.'); speak(`I heard: ${transcript}`); } };
    r.onerror = () => { setListening(false); setStatus('I could not hear that. Tap the orb to try again.'); };
    r.onend = () => setListening(false); recognition.current = r; r.start();
  };
  const send = () => { if (!text.trim()) { setStatus('Tell me what you want to build first.'); speak('Tell me what you want to build first.'); return; } const message = text.trim(); setStatus('Thinking…'); setTimeout(() => { setStatus('Ready to execute your request.'); speak(`Understood. I will work on: ${message}`); }, 450); };
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Sparkles size={18}/></div><span>THEOPHANY</span></div><div className="top-actions"><button className="icon-button" onClick={() => setShowChat(true)} aria-label="Conversation"><MessageCircle size={18}/></button><button className="icon-button" aria-label="Settings"><Settings2 size={18}/></button></div></header>
    <main className="voice-screen">
      <div className="welcome"><div className="eyebrow">YOUR AI BUILDER</div><h1>What are we building?</h1><p>{status}</p></div>
      <button className={`voice-orb ${listening ? 'is-listening' : ''} ${speaking ? 'is-speaking' : ''}`} onClick={startListening} aria-label={listening ? 'Stop listening' : 'Start voice input'}><span className="orb-glow"/><span className="orb-core">{listening ? <MicOff size={34}/> : <Mic size={34}/>}</span><span className="pulse p1"/><span className="pulse p2"/></button>
      <div className="voice-label">{listening ? 'Listening' : speaking ? 'Speaking' : 'Tap to speak'}</div>
      <div className="composer"><textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Tell Theophany what you want to build…" rows={1}/><button className="send-button" onClick={send} aria-label="Send"><ArrowUp size={19}/></button></div>
      <div className="hint">Try: “Build a marketplace, use Supabase and deploy it on Vercel.”</div>
      <button className="speak-back" onClick={() => speak(text || 'I am ready. Tell me what you want to build.')}><Volume2 size={15}/> {speaking ? 'Speaking…' : 'Hear Theophany'}</button>
    </main>
    <footer className="footer"><span>THEOPHANY</span><span>•</span><span>Voice-first AI software builder</span></footer>
    {showChat && <div className="chat-overlay"><div className="chat-panel"><button className="close-chat" onClick={() => setShowChat(false)}><X/></button><div className="eyebrow">CONVERSATION</div><h2>Your builds</h2><p>Voice conversations and build activity will appear here.</p></div></div>}
  </div>;
}
