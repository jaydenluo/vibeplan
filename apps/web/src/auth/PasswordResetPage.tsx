import { useState } from 'react';
import { apiRequest, showMessage } from '../api/client.js';

export function PasswordResetRequestPage({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try { await apiRequest('/auth/password/request', { method: 'POST', body: JSON.stringify({ email }) }); showMessage('如果邮箱已注册，重置链接已发送，请检查邮箱。'); }
    catch { /* The request client has shown the failure. */ }
  }
  return <form className="auth-form" onSubmit={submit}>
    <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
    <button type="submit" className="primary">发送重置链接</button><button type="button" className="link-button" onClick={onBack}>返回登录</button>
  </form>;
}

export function PasswordResetPage({ token, onCompleted }: { token: string; onCompleted: () => void }) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (password !== confirm) { showMessage('两次输入的密码不一致。', 'error'); return; }
    try { await apiRequest('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) }); onCompleted(); }
    catch { /* The request client has shown the failure. */ }
  }
  return <form className="auth-form" onSubmit={submit}>
    <label>新密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
    <label>确认新密码<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={8} required /></label>
    <button type="submit" className="primary">重置密码</button>
  </form>;
}
