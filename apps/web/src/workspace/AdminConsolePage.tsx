import { useCallback, useEffect, useState } from 'react';
import {
  type AdminAdministrator,
  type AdminOrder,
  type AdminOrganization,
  type AdminPage,
  type AdminUser,
  type PlatformAdminIdentity,
  getAdminOrders,
  getAdminOrganizations,
  getAdminOverview,
  getAdminUsers,
  getPlatformAdministrators,
  grantPlatformAdministrator,
  revokePlatformAdministrator,
  showMessage,
} from '../api/client.js';

type Tab = 'overview' | 'users' | 'organizations' | 'orders' | 'administrators';

const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: '运营概览' },
  { id: 'users', label: '用户' },
  { id: 'organizations', label: '组织' },
  { id: 'orders', label: '充值记录' },
  { id: 'administrators', label: '管理员' },
];

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function date(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
}

function planName(code?: string | null) {
  return ({ free: '个人免费', team_10: '团队 10 人', team_30: '团队 30 人', team_100: '团队 100 人', enterprise_1000: '企业协作', custom: '定制企业' } as Record<string, string>)[code ?? ''] ?? '个人免费';
}

function orderStatus(status: string) {
  return ({ pending: '待确认', paid: '已付款', scheduled: '已安排', closed: '已关闭', failed: '失败', refunded: '已退款' } as Record<string, string>)[status] ?? status;
}

function compactTransactionId(value: string) {
  return value.length > 14 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value;
}

async function copyTransactionId(value: string) {
  if (!navigator.clipboard?.writeText) return;
  await navigator.clipboard.writeText(value);
}

function normalizePage<T>(value: AdminPage<T> | T[]): AdminPage<T> {
  return Array.isArray(value) ? { items: value, nextCursor: null } : value;
}

export function AdminConsolePage({ identity }: { identity: PlatformAdminIdentity }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<{ userCount: number; organizationCount: number; activeSubscriptionCount: number; revenue30dCents: number; pendingOrderCount: number } | null>(null);
  const [users, setUsers] = useState<AdminPage<AdminUser> | null>(null);
  const [organizations, setOrganizations] = useState<AdminPage<AdminOrganization> | null>(null);
  const [orders, setOrders] = useState<AdminPage<AdminOrder> | null>(null);
  const [administrators, setAdministrators] = useState<AdminPage<AdminAdministrator> | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [organizationQuery, setOrganizationQuery] = useState('');
  const [orderQuery, setOrderQuery] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [orderPlanFilter, setOrderPlanFilter] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminRole, setAdminRole] = useState<'operator' | 'super_admin'>('operator');

  const loadOverview = useCallback(async () => {
    try { setOverview(await getAdminOverview()); } catch { /* The request client has shown the failure. */ }
  }, []);
  const loadUsers = useCallback(async (cursor?: string | null) => {
    try { setUsers(await getAdminUsers({ q: userQuery, cursor, limit: 30 })); } catch { /* The request client has shown the failure. */ }
  }, [userQuery]);
  const loadOrganizations = useCallback(async (cursor?: string | null) => {
    try { setOrganizations(await getAdminOrganizations({ q: organizationQuery, cursor, limit: 30 })); } catch { /* The request client has shown the failure. */ }
  }, [organizationQuery]);
  const loadOrders = useCallback(async (cursor?: string | null) => {
    try { setOrders(await getAdminOrders({ q: orderQuery, status: orderStatusFilter, planCode: orderPlanFilter, cursor, limit: 30 })); } catch { /* The request client has shown the failure. */ }
  }, [orderPlanFilter, orderQuery, orderStatusFilter]);
  const loadAdministrators = useCallback(async () => {
    try { setAdministrators(normalizePage(await getPlatformAdministrators())); } catch { /* The request client has shown the failure. */ }
  }, []);

  useEffect(() => {
    if (tab === 'overview' && !overview) void loadOverview();
    if (tab === 'users' && !users) void loadUsers();
    if (tab === 'organizations' && !organizations) void loadOrganizations();
    if (tab === 'orders' && !orders) void loadOrders();
    if (tab === 'administrators' && !administrators) void loadAdministrators();
  }, [administrators, loadAdministrators, loadOrders, loadOrganizations, loadOverview, loadUsers, orders, organizations, overview, tab, users]);

  async function grant(event: React.FormEvent) {
    event.preventDefault();
    try {
      await grantPlatformAdministrator(adminEmail.trim(), adminRole);
      setAdminEmail(''); showMessage('已授予平台管理员权限。');
      await loadAdministrators();
    } catch { /* The request client has shown the failure. */ }
  }

  async function revoke(userId: string) {
    try {
      await revokePlatformAdministrator(userId);
      showMessage('已撤销平台管理员权限。');
      await loadAdministrators();
    } catch { /* The request client has shown the failure. */ }
  }

  return <section className="admin-console management-page">
    <header className="page-heading admin-heading"><div><p className="eyebrow">平台运营</p><h2>管理后台</h2><p className="muted">只显示运营所需的用户、组织和订阅订单信息。</p></div><span className="admin-role-badge">{identity.role === 'super_admin' ? '超级管理员' : '运营管理员'}</span></header>
    <nav className="admin-tabs" aria-label="管理后台导航">{tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {tab === 'overview' && <Overview data={overview} />}
    {tab === 'users' && <UsersView data={users} query={userQuery} onQuery={setUserQuery} onSearch={() => void loadUsers()} onNext={() => void loadUsers(users?.nextCursor)} />}
    {tab === 'organizations' && <OrganizationsView data={organizations} query={organizationQuery} onQuery={setOrganizationQuery} onSearch={() => void loadOrganizations()} onNext={() => void loadOrganizations(organizations?.nextCursor)} />}
    {tab === 'orders' && <OrdersView data={orders} query={orderQuery} status={orderStatusFilter} plan={orderPlanFilter} onQuery={setOrderQuery} onStatus={setOrderStatusFilter} onPlan={setOrderPlanFilter} onSearch={() => void loadOrders()} onNext={() => void loadOrders(orders?.nextCursor)} />}
    {tab === 'administrators' && <AdministratorsView data={administrators} canManage={identity.role === 'super_admin'} email={adminEmail} role={adminRole} onEmail={setAdminEmail} onRole={setAdminRole} onGrant={grant} onRevoke={(userId) => void revoke(userId)} />}
  </section>;
}

function Overview({ data }: { data: ReturnType<typeof getAdminOverview> extends Promise<infer Value> ? Value | null : never }) {
  if (!data) return <p className="muted">正在加载运营概览…</p>;
  return <div className="admin-metrics"><Metric label="注册用户" value={data.userCount} /><Metric label="组织数量" value={data.organizationCount} /><Metric label="有效订阅" value={data.activeSubscriptionCount} /><Metric label="近 30 天付款" value={money(data.revenue30dCents)} /><Metric label="待确认订单" value={data.pendingOrderCount} tone="pending" /></div>;
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: 'pending' }) { return <section className={`admin-metric${tone ? ` ${tone}` : ''}`}><span>{label}</span><strong>{value}</strong></section>; }

function SearchBar({ label, value, onChange, onSubmit, children }: { label: string; value: string; onChange: (value: string) => void; onSubmit: () => void; children?: React.ReactNode }) {
  const action = `查询${label.replace(/^搜索/, '')}`;
  return <div className="admin-filters"><label>{label}<input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>{children}<button className="secondary" type="button" onClick={onSubmit}>{action}</button></div>;
}

function Pager({ nextCursor, onNext }: { nextCursor?: string | null; onNext: () => void }) { return <div className="admin-pager"><span>每页最多 30 项</span><button className="secondary" type="button" disabled={!nextCursor} onClick={onNext}>加载下一页</button></div>; }

function UsersView({ data, query, onQuery, onSearch, onNext }: { data: AdminPage<AdminUser> | null; query: string; onQuery: (value: string) => void; onSearch: () => void; onNext: () => void }) {
  return <section className="admin-view"><SearchBar label="搜索用户" value={query} onChange={onQuery} onSubmit={onSearch} />{!data ? <p className="muted">正在加载用户…</p> : <><div className="admin-table" role="table" aria-label="用户列表"><div role="row" className="admin-table-head"><span>用户</span><span>注册日期</span><span>组织</span><span>平台角色</span></div>{data.items.map((user) => <div role="row" className="admin-table-row" key={user.id}><span><strong>{user.displayName || user.email}</strong><small>{user.email}</small></span><span>{date(user.createdAt)}</span><span>{user.organizationCount}</span><span>{user.role === 'super_admin' ? '超级管理员' : user.role === 'operator' ? '运营管理员' : '—'}</span></div>)}</div><Pager nextCursor={data.nextCursor} onNext={onNext} /></>}</section>;
}

function OrganizationsView({ data, query, onQuery, onSearch, onNext }: { data: AdminPage<AdminOrganization> | null; query: string; onQuery: (value: string) => void; onSearch: () => void; onNext: () => void }) {
  return <section className="admin-view"><SearchBar label="搜索组织" value={query} onChange={onQuery} onSubmit={onSearch} />{!data ? <p className="muted">正在加载组织…</p> : <><div className="admin-table" role="table" aria-label="组织列表"><div role="row" className="admin-table-head"><span>组织</span><span>所有者</span><span>套餐</span><span>成员</span><span>状态</span></div>{data.items.map((organization) => <div role="row" className="admin-table-row" key={organization.id}><span><strong>{organization.name}</strong><small>{date(organization.createdAt)}</small></span><span>{organization.ownerEmail}</span><span>{planName(organization.planCode)}</span><span>{organization.memberCount} 人 / {organization.projectCount} 项目</span><span>{organization.state === 'read_only' ? '只读' : organization.state}</span></div>)}</div><Pager nextCursor={data.nextCursor} onNext={onNext} /></>}</section>;
}

function OrdersView({ data, query, status, plan, onQuery, onStatus, onPlan, onSearch, onNext }: { data: AdminPage<AdminOrder> | null; query: string; status: string; plan: string; onQuery: (value: string) => void; onStatus: (value: string) => void; onPlan: (value: string) => void; onSearch: () => void; onNext: () => void }) {
  return <section className="admin-view"><SearchBar label="搜索订单" value={query} onChange={onQuery} onSubmit={onSearch}><label>订单状态<select aria-label="订单状态" value={status} onChange={(event) => onStatus(event.target.value)}><option value="">全部状态</option><option value="pending">待确认</option><option value="paid">已付款</option><option value="failed">失败</option><option value="closed">已关闭</option></select></label><label>套餐<select aria-label="套餐" value={plan} onChange={(event) => onPlan(event.target.value)}><option value="">全部套餐</option><option value="team_10">团队 10 人</option><option value="team_30">团队 30 人</option><option value="team_100">团队 100 人</option><option value="enterprise_1000">企业协作</option></select></label></SearchBar>{!data ? <p className="muted">正在加载订单…</p> : <><div className="admin-table admin-orders-table" role="table" aria-label="充值记录"><div role="row" className="admin-table-head"><span>订单号</span><span>组织</span><span>套餐</span><span>金额</span><span>状态</span><span>付款时间</span></div>{data.items.map((order) => <div role="row" className="admin-table-row" key={order.id}><span><strong>{order.orderNo}</strong><small>{order.purchaserEmail}</small><span className="admin-transaction-id">{order.providerTransactionId ? <><span title={order.providerTransactionId}>{compactTransactionId(order.providerTransactionId)}</span><button type="button" aria-label={`复制交易号 ${order.providerTransactionId}`} title="复制完整支付宝交易号" onClick={() => void copyTransactionId(order.providerTransactionId!)}>复制</button></> : '—'}</span></span><span>{order.organizationName}</span><span>{planName(order.planCode)}</span><span>{money(order.amountCents)}</span><span>{orderStatus(order.status)}</span><span>{date(order.paidAt)}</span></div>)}</div><Pager nextCursor={data.nextCursor} onNext={onNext} /></>}</section>;
}

function AdministratorsView({ data, canManage, email, role, onEmail, onRole, onGrant, onRevoke }: { data: AdminPage<AdminAdministrator> | null; canManage: boolean; email: string; role: 'operator' | 'super_admin'; onEmail: (value: string) => void; onRole: (value: 'operator' | 'super_admin') => void; onGrant: (event: React.FormEvent) => void; onRevoke: (userId: string) => void }) {
  return <section className="admin-view">{canManage ? <form className="admin-grant" onSubmit={onGrant}><label>用户邮箱<input aria-label="用户邮箱" type="email" value={email} onChange={(event) => onEmail(event.target.value)} required /></label><label>平台角色<select aria-label="平台角色" value={role} onChange={(event) => onRole(event.target.value as 'operator' | 'super_admin')}><option value="operator">运营管理员</option><option value="super_admin">超级管理员</option></select></label><button className="primary" type="submit">授予管理员</button></form> : <p className="admin-readonly">普通运营管理员只能查看管理员名单。</p>}{!data ? <p className="muted">正在加载管理员…</p> : <div className="admin-table" role="table" aria-label="平台管理员"><div role="row" className="admin-table-head"><span>管理员</span><span>角色</span><span>授权时间</span>{canManage && <span>操作</span>}</div>{data.items.map((administrator) => <div role="row" className="admin-table-row" key={administrator.userId}><span><strong>{administrator.displayName || administrator.email}</strong><small>{administrator.email}</small></span><span>{administrator.role === 'super_admin' ? '超级管理员' : '运营管理员'}</span><span>{date(administrator.createdAt)}</span>{canManage && <span>{administrator.role === 'operator' && !administrator.bootstrap && <button className="link-button" type="button" onClick={() => onRevoke(administrator.userId)}>撤销</button>}</span>}</div>)}</div>}</section>;
}
