import { useEffect, useState } from 'react';
import { apiRequest, unauthorizedEvent } from './api/client.js';
import { LoginPage } from './auth/LoginPage.js';
import { RegisterPage } from './auth/RegisterPage.js';
import { PasswordResetPage, PasswordResetRequestPage } from './auth/PasswordResetPage.js';
import { WorkspacePage } from './workspace/WorkspacePage.js';
import { MessageCenter } from './MessageCenter.js';
import './styles.css';

export function App() {
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'anonymous'>('checking');
  const [location, setLocation] = useState(() => ({
    pathname: typeof window === 'undefined' ? '/' : window.location.pathname,
    search: typeof window === 'undefined' ? '' : window.location.search,
  }));
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const fromUrl = new URLSearchParams(window.location.search).get('invite');
    return fromUrl || window.sessionStorage.getItem('vibe-plan.invite-token');
  });

  useEffect(() => {
    if (inviteToken) window.sessionStorage.setItem('vibe-plan.invite-token', inviteToken);
  }, [inviteToken]);

  useEffect(() => {
    const handleUnauthorized = () => {
      const next = window.location.pathname + window.location.search;
      const path = `/login?next=${encodeURIComponent(next)}`;
      setAuthState('anonymous');
      window.history.replaceState({}, '', path);
      setLocation({ pathname: '/login', search: `?next=${encodeURIComponent(next)}` });
    };
    window.addEventListener(unauthorizedEvent, handleUnauthorized);
    return () => window.removeEventListener(unauthorizedEvent, handleUnauthorized);
  }, []);

  useEffect(() => {
    const followLocation = () => setLocation({ pathname: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', followLocation);
    return () => window.removeEventListener('popstate', followLocation);
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest('/auth/me', {}, true, false, false).then(() => {
      if (active) setAuthState('authenticated');
    }).catch(() => {
      if (active) setAuthState('anonymous');
    });
    return () => { active = false; };
  }, []);

  const currentPath = location.pathname;
  const query = new URLSearchParams(location.search);
  const next = query.get('next') || '/overview';
  const go = (path: string) => {
    window.history.pushState({}, '', path);
    const nextLocation = new URL(path, window.location.origin);
    setLocation({ pathname: nextLocation.pathname, search: nextLocation.search });
  };
  if (authState === 'checking') return <><MessageCenter /><main className="auth-shell auth-loading" aria-busy="true"><span>正在检查登录状态…</span></main></>;
  if (authState === 'authenticated') {
    if (currentPath === '/login' || currentPath === '/register' || currentPath === '/forgot-password' || currentPath === '/reset-password') {
      window.history.replaceState({}, '', '/overview');
    }
    return <><MessageCenter /><WorkspacePage inviteToken={inviteToken} onLogout={() => { setAuthState('anonymous'); go('/login'); }} onInviteHandled={() => { setInviteToken(null); window.sessionStorage.removeItem('vibe-plan.invite-token'); window.history.replaceState({}, '', window.location.pathname); }} /></>;
  }

  const resetToken = query.get('token');
  const authTitle = currentPath === '/register' ? '创建账号' : currentPath === '/forgot-password' ? '找回密码' : currentPath === '/reset-password' ? '重置密码' : '登录 Vibe Plan';

  return (
    <><MessageCenter /><main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">CODEX WORKSPACE</p>
        <h1>{authTitle}</h1>
        <p className="muted">让团队计划、代码和 Codex 工作保持在同一条线上。</p>
        {inviteToken && <p className="invite-login-hint">登录后将继续处理你的邀请链接。</p>}
        {currentPath === '/register' ? <RegisterPage onRegistered={() => go(`/login${next !== '/overview' ? `?next=${encodeURIComponent(next)}` : ''}`)} onLogin={() => go(`/login${next !== '/overview' ? `?next=${encodeURIComponent(next)}` : ''}`)} />
          : currentPath === '/forgot-password' ? <PasswordResetRequestPage onBack={() => go('/login')} />
            : currentPath === '/reset-password' && resetToken ? <PasswordResetPage token={resetToken} onCompleted={() => go('/login')} />
              : <LoginPage onAuthenticated={() => { setAuthState('authenticated'); go(next); }} onRegister={() => go('/register')} onForgotPassword={() => go('/forgot-password')} />}
      </section>
    </main></>
  );
}
