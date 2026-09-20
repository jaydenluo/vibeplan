import { useState } from 'react';
import { apiRequest } from '../api/client.js';

type Props = { onRegistered: () => void; onLogin: () => void };

export function RegisterPage({ onRegistered, onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
      onRegistered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '注册失败');
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary">注册</button>
      <button type="button" className="link-button" onClick={onLogin}>已有账号，去登录</button>
    </form>
  );
}
