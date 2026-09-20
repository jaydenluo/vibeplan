import { useState } from 'react';
import { apiRequest } from '../api/client.js';

type Props = { onAuthenticated: () => void; onRegister: () => void };

export function LoginPage({ onAuthenticated, onRegister }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary">登录</button>
      <button type="button" className="link-button" onClick={onRegister}>注册</button>
    </form>
  );
}
