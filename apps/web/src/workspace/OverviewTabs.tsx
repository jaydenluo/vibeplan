import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ClipboardList, LayoutDashboard } from 'lucide-react';
import { OrganizationOverview } from './OrganizationOverview.js';
import { TodayWork } from './TodayWork.js';
import './OverviewTabs.css';

type OverviewTab = 'workbench' | 'today';
type Props = {
  organizationId: string;
  onOpenProjects: () => void;
  onOpenApprovals: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenTask: (projectId: string, taskId: string) => void;
};
const tabs = [
  { key: 'workbench', label: '工作台', Icon: LayoutDashboard },
  { key: 'today', label: '今日工作', Icon: ClipboardList },
] as const;

function tabFromLocation(): OverviewTab {
  return new URLSearchParams(window.location.search).get('tab') === 'today' ? 'today' : 'workbench';
}

export function OverviewTabs({ organizationId, onOpenProjects, onOpenApprovals, onOpenProject, onOpenTask }: Props) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<OverviewTab>(tabFromLocation);

  useEffect(() => {
    const onPopState = () => setTab(tabFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useLayoutEffect(() => {
    const page = root.current?.closest<HTMLElement>('.workspace-page');
    if (page) page.scrollTop = 0;
  }, [tab]);

  function selectTab(next: OverviewTab) {
    if (next === tab) return;
    const url = new URL(window.location.href);
    if (next === 'today') url.searchParams.set('tab', 'today');
    else url.searchParams.delete('tab');
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setTab(next);
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'Home' ? tabs[0]
      : event.key === 'End' ? tabs[1]
        : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? tabs[1 - index] : undefined;
    if (!next) return;
    event.preventDefault();
    selectTab(next.key);
    document.getElementById(`${id}-tab-${next.key}`)?.focus();
  }

  return <section className="overview-tabs-layout" ref={root} aria-label="总览">
    <div className="overview-page-tabs" role="tablist" aria-label="总览视图">
      {tabs.map(({ key, label, Icon }, index) => <button key={key} type="button" role="tab" id={`${id}-tab-${key}`} aria-selected={tab === key} aria-controls={`${id}-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => selectTab(key)} onKeyDown={event => navigate(event, index)}><Icon size={16} aria-hidden="true" />{label}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel-workbench`} aria-labelledby={`${id}-tab-workbench`} hidden={tab !== 'workbench'}>
      <OrganizationOverview organizationId={organizationId} onOpenProjects={onOpenProjects} onOpenApprovals={onOpenApprovals} onOpenProject={onOpenProject} />
    </div>
    <div role="tabpanel" id={`${id}-panel-today`} aria-labelledby={`${id}-tab-today`} hidden={tab !== 'today'}>
      <TodayWork organizationId={organizationId} onOpenTask={onOpenTask} />
    </div>
  </section>;
}
