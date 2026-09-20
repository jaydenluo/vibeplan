export type ProjectEvent = {
  projectId: string;
  workItemId: string;
  action: string;
  payload: Record<string, unknown>;
};

type Listener = (event: ProjectEvent) => void;

export class ProjectEventHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(event: ProjectEvent): void {
    for (const listener of this.listeners.get(event.projectId) ?? []) {
      listener(event);
    }
  }

  subscribe(projectId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(projectId);
    };
  }
}
