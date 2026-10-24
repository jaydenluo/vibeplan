import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

type Invite = { organizationId: string; teamId?: string | null; organizationName: string; teamName?: string | null };

export function InviteAcceptanceModal({ token, onHandled }: { token: string; onHandled: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    apiRequest<Invite>(`/invite-links/${encodeURIComponent(token)}`).then(setInvite).catch(() => setUnavailable(true)).finally(() => setLoading(false));
  }, [token]);

  async function accept() {
    setAccepting(true);
    try {
      await apiRequest(`/invite-links/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      onHandled();
    } catch { /* The request client has shown the failure. */ } finally {
      setAccepting(false);
    }
  }

  return <div className="modal-backdrop" role="presentation"><section className="modal-panel modal-form invite-acceptance-modal" role="dialog" aria-modal="true" aria-labelledby="invite-acceptance-title"><div className="modal-heading"><div><p className="eyebrow">邀请链接</p><h3 id="invite-acceptance-title">加入协作空间</h3></div></div>{loading ? <p className="modal-help">正在读取邀请信息…</p> : unavailable ? <p className="modal-help">暂无可处理的邀请内容。</p> : invite ? <><p className="modal-help">你将加入组织“{invite.organizationName}”{invite.teamName ? `，并加入团队“${invite.teamName}”` : ''}。</p><div className="invite-acceptance-summary"><strong>{invite.teamName ?? invite.organizationName}</strong><span>{invite.teamName ? '团队成员邀请' : '组织成员邀请'}</span></div><div className="modal-actions"><button className="primary" type="button" onClick={() => void accept()} disabled={accepting}>{accepting ? '加入中…' : '确认加入'}</button></div></> : null}</section></div>;
}
