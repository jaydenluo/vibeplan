import { useEffect, useState } from 'react';
import { apiBase } from '../api/client.js';

export function useProjectEvents(projectId: string | null, onChange: () => void) {
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting' | 'inactive'>('inactive');
  useEffect(() => {
    if (!projectId) { setConnectionState('inactive'); return; }
    setConnectionState('connecting');
    const timer = window.setInterval(onChange, 60_000);
    const source = typeof EventSource === 'undefined' ? null : new EventSource(`${apiBase}/projects/${projectId}/events/stream`, { withCredentials: true });
    if (source) {
      source.addEventListener('work-item', onChange);
      source.onopen = () => { setConnectionState('connected'); onChange(); };
      source.onerror = () => setConnectionState('reconnecting');
    } else setConnectionState('reconnecting');
    window.addEventListener('focus', onChange);
    return () => { source?.close(); window.clearInterval(timer); window.removeEventListener('focus', onChange); };
  }, [projectId, onChange]);
  return connectionState;
}
