import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client.js';

type Props = { onRegistered: () => void; onLogin: () => void };
type FieldName = 'displayName' | 'email' | 'verificationCode' | 'password';
type FieldErrors = Partial<Record<FieldName, string>>;

const resendDeadlineKeyPrefix = 'vibe-plan.registration-code-resend-at';
const codeSentAtKeyPrefix = 'vibe-plan.registration-code-sent-at';
const resendCooldownMs = 30_000;
const codeLifetimeMs = 10 * 60_000;

function storedTimestamp(key: string): number {
  if (typeof window === 'undefined') return 0;
  const timestamp = Number(window.sessionStorage.getItem(key));
  return Number.isFinite(timestamp) && timestamp > Date.now() ? timestamp : 0;
}

function registrationStorageKey(prefix: string, email: string): string {
  return `${prefix}:${encodeURIComponent(email.trim().toLowerCase())}`;
}

function validationErrors({
  displayName,
  email,
  password,
  verificationCode,
  verificationRequired,
  deliveryConfigured,
}: {
  displayName: string;
  email: string;
  password: string;
  verificationCode: string;
  verificationRequired: boolean;
  deliveryConfigured: boolean | undefined;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!displayName.trim()) errors.displayName = '请输入姓名';
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = '请输入有效的邮箱地址';
  if (verificationRequired && deliveryConfigured === false) errors.verificationCode = '邮件服务尚未配置，请联系管理员。';
  else if (verificationRequired && !verificationCode) errors.verificationCode = '请先获取邮箱验证码';
  else if (verificationRequired && !/^\d{6}$/.test(verificationCode)) errors.verificationCode = '请输入 6 位邮箱验证码';
  if (password.length < 8) errors.password = '密码至少需要 8 位';
  return errors;
}

export function RegisterPage({ onRegistered, onLogin }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationRequired, setVerificationRequired] = useState(true);
  const [deliveryConfigured, setDeliveryConfigured] = useState<boolean>();
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [resendDeadline, setResendDeadline] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const fieldRefs = useRef<Record<FieldName, HTMLInputElement | null>>({ displayName: null, email: null, verificationCode: null, password: null });

  useEffect(() => {
    let active = true;
    apiRequest<{ emailVerificationRequired?: boolean; emailDeliveryConfigured?: boolean }>('/auth/config')
      .then((config) => {
        if (!active) return;
        setVerificationRequired(config.emailVerificationRequired ?? true);
        setDeliveryConfigured(config.emailDeliveryConfigured);
      })
      .catch(() => { /* Keep verification enabled if configuration cannot be loaded. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const resendKey = registrationStorageKey(resendDeadlineKeyPrefix, email);
    const sentKey = registrationStorageKey(codeSentAtKeyPrefix, email);
    const nextDeadline = storedTimestamp(resendKey);
    setCodeSent(storedTimestamp(sentKey) > 0);
    setResendDeadline(nextDeadline);
    setRemainingSeconds(Math.ceil(Math.max(0, nextDeadline - Date.now()) / 1000));
    setVerificationCode('');
  }, [email]);

  useEffect(() => {
    const updateRemaining = () => {
      const next = Math.ceil(Math.max(0, resendDeadline - Date.now()) / 1000);
      setRemainingSeconds(next);
      if (next === 0 && resendDeadline > 0) {
        window.sessionStorage.removeItem(registrationStorageKey(resendDeadlineKeyPrefix, email));
        setResendDeadline(0);
      }
    };
    updateRemaining();
    if (!resendDeadline) return;
    const timer = window.setInterval(updateRemaining, 1_000);
    return () => window.clearInterval(timer);
  }, [email, resendDeadline]);

  async function sendCode() {
    setSendingCode(true);
    try {
      await apiRequest('/auth/register/request-code', { method: 'POST', body: JSON.stringify({ email }) });
      setCodeSent(true);
      const now = Date.now();
      window.sessionStorage.setItem(registrationStorageKey(codeSentAtKeyPrefix, email), String(now + codeLifetimeMs));
      const nextDeadline = now + resendCooldownMs;
      window.sessionStorage.setItem(registrationStorageKey(resendDeadlineKeyPrefix, email), String(nextDeadline));
      setResendDeadline(nextDeadline);
    } catch { /* The request client has shown the failure. */ } finally {
      setSendingCode(false);
    }
  }

  const sendCodeLabel = remainingSeconds > 0 ? `${remainingSeconds} 秒后重新发送` : codeSent ? '重新发送' : '获取验证码';
  const sendCodeDisabled = sendingCode || !email || deliveryConfigured === false || remainingSeconds > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const errors = validationErrors({ displayName, email, password, verificationCode, verificationRequired, deliveryConfigured });
    setFieldErrors(errors);
    const firstInvalid = Object.keys(errors)[0] as FieldName | undefined;
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName, ...(verificationRequired ? { verificationCode } : {}) }) });
      onRegistered();
    } catch { /* The request client has shown the failure. */ } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      <div className="auth-field"><label>姓名<input ref={(element) => { fieldRefs.current.displayName = element; }} value={displayName} onChange={(event) => { setDisplayName(event.target.value); setFieldErrors((errors) => ({ ...errors, displayName: undefined })); }} maxLength={120} aria-invalid={Boolean(fieldErrors.displayName)} aria-describedby={fieldErrors.displayName ? 'register-display-name-error' : undefined} required /></label>{fieldErrors.displayName && <span id="register-display-name-error" className="field-error" role="alert">{fieldErrors.displayName}</span>}</div>
      <div className="auth-field"><label>邮箱<input ref={(element) => { fieldRefs.current.email = element; }} type="email" value={email} onChange={(event) => { setEmail(event.target.value); setFieldErrors((errors) => ({ ...errors, email: undefined })); }} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'register-email-error' : undefined} required /></label>{fieldErrors.email && <span id="register-email-error" className="field-error" role="alert">{fieldErrors.email}</span>}</div>
      {verificationRequired && <><div className="verification-row"><div className="auth-field"><label>邮箱验证码<input ref={(element) => { fieldRefs.current.verificationCode = element; }} inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={(event) => { setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setFieldErrors((errors) => ({ ...errors, verificationCode: undefined })); }} minLength={6} maxLength={6} aria-invalid={Boolean(fieldErrors.verificationCode)} aria-describedby={fieldErrors.verificationCode ? 'register-verification-code-error' : undefined} required /></label>{fieldErrors.verificationCode && <span id="register-verification-code-error" className="field-error" role="alert">{fieldErrors.verificationCode}</span>}</div><button type="button" className="secondary" onClick={() => void sendCode()} disabled={sendCodeDisabled}>{sendingCode ? '发送中…' : sendCodeLabel}</button></div>{deliveryConfigured === false && <p className="error" role="status">邮件服务尚未配置，请联系管理员。</p>}</>}
      <div className="auth-field"><label>密码<input ref={(element) => { fieldRefs.current.password = element; }} type="password" value={password} onChange={(event) => { setPassword(event.target.value); setFieldErrors((errors) => ({ ...errors, password: undefined })); }} minLength={8} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'register-password-error' : undefined} required /></label>{fieldErrors.password && <span id="register-password-error" className="field-error" role="alert">{fieldErrors.password}</span>}</div>
      <button type="submit" className="primary" disabled={submitting}>{submitting ? '注册中…' : '注册'}</button>
      <button type="button" className="link-button" onClick={onLogin}>已有账号，去登录</button>
    </form>
  );
}
