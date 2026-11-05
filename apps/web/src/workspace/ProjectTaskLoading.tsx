import './ProjectTaskLoading.css';

export function ProjectTaskLoading({ failed = false, onRetry }: { failed?: boolean; onRetry: () => void }) {
  return <div className="project-task-loading" role={failed ? 'alert' : 'status'} aria-label={failed ? '任务加载失败' : '任务加载中'}>
    {!failed && <span className="project-task-loading-spinner" aria-hidden="true" />}
    <p>{failed ? '任务加载失败，请重试。' : '加载中…'}</p>
    {failed && <button className="secondary" type="button" aria-label="重试加载任务" onClick={onRetry}>重试</button>}
  </div>;
}
