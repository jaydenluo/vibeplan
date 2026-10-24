import { useState } from 'react';
import { apiRequest, showMessage } from '../api/client.js';

type InviteResponse = { token: string; expiresAt: string };

type Props = {
  title: string;
  eyebrow: string;
  description: string;
  path: string;
  payload?: Record<string, unknown>;
  onClose: () => void;
};

export function InviteLinkModal({ title, eyebrow, description, path, payload = {}, onClose }: Props) {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function generateLink() {
    setLoading(true);
    try {
      const result = await apiRequest<InviteResponse>(path, { method: 'POST', body: JSON.stringify(payload) });
      setLink(`${window.location.origin}/?invite=${encodeURIComponent(result.token)}`);
    } catch { /* The request client has shown the failure. */ } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      showMessage('复制失败，请手动复制链接', 'error');
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-panel modal-form invite-link-modal" role="dialog" aria-modal="true" aria-labelledby="invite-link-title"><div className="modal-heading"><div><p className="eyebrow">{eyebrow}</p><h3 id="invite-link-title">{title}</h3></div><button className="close-button" type="button" aria-label="关闭" onClick={onClose}>×</button></div><p className="modal-help">{description}</p>{link ? <><label>邀请链接<input aria-label="邀请链接" value={link} readOnly onFocus={(event) => event.currentTarget.select()} /></label><p className="invite-link-expiry">链接有效期 7 天，可被多人使用。</p></> : <div className="invite-link-placeholder">点击下方按钮生成一个可分享的邀请链接。</div>}<div className="modal-actions"><button className="secondary" type="button" onClick={onClose}>关闭</button>{link ? <button className="primary" type="button" onClick={() => void copyLink()}>{copied ? '已复制' : '复制链接'}</button> : <button className="primary" type="button" onClick={() => void generateLink()} disabled={loading}>{loading ? '生成中…' : '生成邀请链接'}</button>}</div></section></div>;
}
