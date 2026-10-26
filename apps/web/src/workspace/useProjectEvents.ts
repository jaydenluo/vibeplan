import { useEffect, useRef, useState } from 'react';
import { apiBase } from '../api/client.js';

export function useProjectEvents(projectId: string | null, onChange: () => void) {
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting' | 'inactive'>('inactive');

  // Use ref to avoid recreating EventSource when onChange callback changes
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!projectId) { setConnectionState('inactive'); return; }
    setConnectionState('connecting');

    const handleChange = () => onChangeRef.current();
    const timer = window.setInterval(handleChange, 60_000);
    const source = typeof EventSource === 'undefined' ? null : new EventSource(`${apiBase}/projects/${projectId}/events/stream`, { withCredentials: true });

    if (source) {
      source.addEventListener('work-item', handleChange);
      source.onopen = () => { setConnectionState('connected'); handleChange(); };
      source.onerror = () => setConnectionState('reconnecting');
    } else {
      setConnectionState('reconnecting');
    }

    window.addEventListener('focus', handleChange);

    return () => {
      source?.close();
      window.clearInterval(timer);
      window.removeEventListener('focus', handleChange);
    };
  }, [projectId]); // Only depend on projectId, not onChange

  return connectionState;
}
