import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

type Props = { onRegistered: () => void; onLogin: () => void };

export function RegisterPage({ onRegistered, onLogin }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationRequired, setVerificationRequired] = useState(true);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<{ emailVerificationRequired?: boolean }>('/auth/config')
      .then((config) => { if (active) setVerificationRequired(config.emailVerificationRequired ?? true); })
      .catch(() => { /* Keep verification enabled if configuration cannot be loaded. */ });
    return () => { active = false; };
  }, []);

  async function sendCode() {
    setSendingCode(true);
    try {
      await apiRequest('/auth/register/request-code', { method: 'POST', body: JSON.stringify({ email }) });
      setCodeSent(true);
    } catch { /* The request client has shown the failure. */ } finally {
      setSendingCode(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName, ...(verificationRequired ? { verificationCode } : {}) }) });
      onRegistered();
    } catch { /* The request client has shown the failure. */ }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>姓名<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} required /></label>
      <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      {verificationRequired && <div className="verification-row"><label>邮箱验证码<input inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} minLength={6} maxLength={6} required={codeSent} /></label><button type="button" className="secondary" onClick={() => void sendCode()} disabled={sendingCode || !email}>{sendingCode ? '发送中…' : codeSent ? '重新发送' : '获取验证码'}</button></div>}
      <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
      <button type="submit" className="primary" disabled={verificationRequired && (!codeSent || verificationCode.length !== 6)}>注册</button>
      <button type="button" className="link-button" onClick={onLogin}>已有账号，去登录</button>
    </form>
  );
}
