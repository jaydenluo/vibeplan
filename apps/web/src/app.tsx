import { useState } from 'react';
import { LoginPage } from './auth/LoginPage.js';
import { RegisterPage } from './auth/RegisterPage.js';
import { WorkspacePage } from './workspace/WorkspacePage.js';
import './styles.css';

export function App() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [authenticated, setAuthenticated] = useState(false);

  if (authenticated) return <WorkspacePage />;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">CODEX WORKSPACE</p>
        <h1>Vibe Plan</h1>
        <p className="muted">让团队计划、代码和 Codex 工作保持在同一条线上。</p>
        {mode === 'login' ? (
          <LoginPage onAuthenticated={() => setAuthenticated(true)} onRegister={() => setMode('register')} />
        ) : (
          <RegisterPage onRegistered={() => setMode('login')} onLogin={() => setMode('login')} />
        )}
      </section>
    </main>
  );
}
