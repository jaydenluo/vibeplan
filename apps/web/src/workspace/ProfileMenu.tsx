import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client.js';

type Organization = { id: string; name: string; slug: string };
type User = { id: string; email: string; displayName?: string | null };

type Props = {
  user: User;
  organizations: Organization[];
  organizationId: string;
  onSelectOrganization: (id: string) => void;
  onCreateOrganization: () => void;
  onProfileUpdated?: (user: User) => void;
  onOpenBilling?: (organizationId: string) => void;
  onLogout?: () => void;
};

export function ProfileMenu({ user, organizations, organizationId, onSelectOrganization, onCreateOrganization, onProfileUpdated, onOpenBilling, onLogout }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceApproved, setDeviceApproved] = useState(false);
  const [deviceCode, setDeviceCode] = useState('');
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const label = user.displayName?.trim() || user.email;
  const initial = label.slice(0, 1).toUpperCase();

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    try {
      const updated = await apiRequest<User>('/auth/me', { method: 'PATCH', body: JSON.stringify({ displayName }) });
      onProfileUpdated?.(updated);
      setProfileOpen(false);
    } catch { /* The request client has shown the failure. */ }
  }

  async function approveDevice(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest('/auth/device/approve', { method: 'POST', body: JSON.stringify({ userCode: deviceCode.trim() }) });
      setDeviceCode('');
      setDeviceApproved(true);
    } catch { /* The request client has shown the failure. */ }
  }

  async function logout() {
    try { await apiRequest('/auth/logout', { method: 'POST' }); } finally { onLogout?.(); }
  }

  return <div ref={menuRef} className="profile-menu">
    <button className="profile-trigger" type="button" aria-label="打开个人菜单" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="profile-avatar" aria-hidden="true">{initial}</span>
      <span className="profile-trigger-copy"><strong>{label}</strong><small>{organizations.find((item) => item.id === organizationId)?.name ?? '未选择组织'}</small></span>
      <span className="profile-caret" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="profile-popover" role="menu">
      <button className="profile-menu-item" type="button" role="menuitem" onClick={() => { setProfileOpen(true); setOpen(false); }}>个人资料</button>
      <button className="profile-menu-item" type="button" role="menuitem" disabled={!organizationId || !onOpenBilling} onClick={() => { onOpenBilling?.(organizationId); setOpen(false); }}>订阅与账单</button>
      <button className="profile-menu-item" type="button" role="menuitem" onClick={() => { setDeviceOpen(true); setDeviceApproved(false); setOpen(false); }}>CLI 设备授权</button>
      <button className="profile-menu-item profile-logout" type="button" role="menuitem" onClick={() => { setOpen(false); void logout(); }}>退出登录</button>
      <div className="profile-menu-section"><span>当前组织</span>{organizations.length === 0 ? <p>还没有组织</p> : organizations.map((item) => <button className={`profile-menu-item organization-option${item.id === organizationId ? ' selected' : ''}`} type="button" role="menuitem" key={item.id} onClick={() => { onSelectOrganization(item.id); setOpen(false); }}><span>{item.name}</span>{item.id === organizationId && <small>当前</small>}</button>)}</div>
      <button className="profile-menu-item profile-create" type="button" role="menuitem" onClick={() => { onCreateOrganization(); setOpen(false); }}>{organizations.length === 0 ? '先新建组织' : '新建组织'}</button>
    </div>}
    {profileOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}><form className="modal-panel modal-form" onSubmit={saveProfile} role="dialog" aria-modal="true" aria-labelledby="profile-modal-title"><div className="modal-heading"><div><p className="eyebrow">账户</p><h3 id="profile-modal-title">个人资料</h3></div><button className="close-button" type="button" aria-label="关闭" onClick={() => setProfileOpen(false)}>×</button></div><label>邮箱<input value={user.email} readOnly /></label><label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：张三" maxLength={120} /></label><div className="modal-actions"><button className="secondary" type="button" onClick={() => setProfileOpen(false)}>取消</button><button className="primary" type="submit">保存资料</button></div></form></div>}
    {deviceOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeviceOpen(false); }}><form className="modal-panel modal-form" onSubmit={approveDevice} role="dialog" aria-modal="true" aria-labelledby="device-modal-title"><div className="modal-heading"><div><p className="eyebrow">开发者工具</p><h3 id="device-modal-title">CLI 设备授权</h3></div><button className="close-button" type="button" aria-label="关闭" onClick={() => setDeviceOpen(false)}>×</button></div>{deviceApproved ? <><p className="device-success" role="status">设备已批准，CLI 登录成功。</p><div className="modal-actions"><button className="primary" type="button" onClick={() => setDeviceOpen(false)}>确定</button></div></> : <><p className="modal-help">在终端运行 <code>vibeplan login</code> 后，将显示 6 位设备码。在这里批准后，CLI 才能访问当前账号。</p><label>设备码<input aria-label="CLI 设备码" inputMode="numeric" pattern="[0-9]{6}" placeholder="输入 6 位设备码" value={deviceCode} onChange={(event) => setDeviceCode(event.target.value)} required /></label><div className="modal-actions"><button className="secondary" type="button" onClick={() => setDeviceOpen(false)}>取消</button><button className="primary" type="submit">批准设备</button></div></>}</form></div>}
  </div>;
}
