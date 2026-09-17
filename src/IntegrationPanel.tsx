import { useEffect, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, PlugZap } from 'lucide-react';
import { integrations } from './integrations';

type Props = { sessionId: string };
type Status = { provider: string; status: string; scopes?: string[] };

export function IntegrationPanel({ sessionId }: Props) {
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/integrations/status?session_id=${encodeURIComponent(sessionId)}`);
      const d = await r.json();
      if (d.ok) setStatuses(d.integrations || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [sessionId]);

  const connected = new Map(statuses.map(s => [s.provider, s]));
  const connect = (id: string) => {
    if (id === 'gmail') window.location.href = `/api/integrations/gmail/connect?session_id=${encodeURIComponent(sessionId)}`;
  };

  return <section className='th-settings-section'>
    <div className='th-integrations-title'><div><h4>Plugins & integrations</h4><small>Connect services Theophany can work with. Credentials stay server-side.</small></div>{loading && <LoaderCircle className='th-spin' size={16}/>}</div>
    <div className='th-integration-list'>
      {integrations.map(item => {
        const state = connected.get(item.id);
        const isConnected = state?.status === 'connected';
        const active = item.id === 'gmail';
        return <div className='th-integration-row' key={item.id}>
          <span className='th-integration-icon'><PlugZap size={17}/></span>
          <span className='th-integration-info'><b>{item.name}</b><small>{item.description}</small></span>
          {isConnected ? <span className='th-integration-status'><Check size={14}/> Connected</span> : active ? <button className='th-integration-connect' onClick={() => connect(item.id)}><ExternalLink size={14}/> Connect</button> : <span className='th-integration-status muted'>Setup needed</span>}
        </div>;
      })}
    </div>
  </section>;
}
