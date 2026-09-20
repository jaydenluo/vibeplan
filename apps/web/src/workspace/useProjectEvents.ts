import { useEffect } from 'react';
import { apiBase } from '../api/client.js';

export function useProjectEvents(projectId: string | null, onChange: () => void) {
  useEffect(() => {
    if (!projectId) return undefined;
    const source = new EventSource(`${apiBase}/projects/${projectId}/events`, { withCredentials: true });
    source.addEventListener('work-item', onChange);
    return () => source.close();
  }, [projectId, onChange]);
}
