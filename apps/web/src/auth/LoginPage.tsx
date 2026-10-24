import { useState } from 'react';
import { apiRequest } from '../api/client.js';

type Props = { onAuthenticated: () => void; onRegister: () => void; onForgotPassword?: () => void };

export function LoginPage({ onAuthenticated, onRegister, onForgotPassword = () => {} }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      onAuthenticated();
    } catch { /* The request client has shown the failure. */ }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
      <button type="submit" className="primary">登录</button>
      <button type="button" className="link-button" onClick={onForgotPassword}>忘记密码？</button>
      <button type="button" className="link-button" onClick={onRegister}>注册</button>
    </form>
  );
}
