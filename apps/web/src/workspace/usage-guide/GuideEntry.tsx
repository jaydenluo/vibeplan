import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';

class GuideBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section role="alert"><h2>教程加载失败</h2><p>请检查网络连接后重试。</p><button type="button" onClick={this.props.onRetry}>重新加载教程</button></section> : this.props.children;
  }
}

export function GuideEntry() {
  const [attempt, setAttempt] = useState(0);
  const Page = useMemo(() => lazy(() => import('../UsageGuidePage.js').then(module => ({ default: module.UsageGuidePage }))), [attempt]);
  return <GuideBoundary key={attempt} onRetry={() => setAttempt(value => value + 1)}><Suspense fallback={<p role="status">正在加载使用教程…</p>}><Page /></Suspense></GuideBoundary>;
}
