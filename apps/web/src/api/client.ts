const apiBase = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '/api');
export const unauthorizedEvent = 'vibe-plan:unauthorized';
export const messageEvent = 'vibe-plan:message';
export type MessageTone = 'success' | 'error';
export type AppMessage = { text: string; tone: MessageTone };
const noRefreshPaths = new Set(['/auth/config', '/auth/login', '/auth/register', '/auth/register/request-code', '/auth/password/request', '/auth/password/reset', '/auth/logout', '/auth/refresh', '/auth/device/start', '/auth/device/exchange']);

const webErrorMessages: Record<string, string> = {
  INVALID_CREDENTIALS: '邮箱或密码错误。',
  EMAIL_ALREADY_REGISTERED: '该邮箱已注册，请直接登录。',
  EMAIL_NOT_VERIFIED: '邮箱尚未验证，请完成验证后再登录。',
  EMAIL_VERIFICATION_REQUIRED: '请先完成邮箱验证。',
  INVALID_REGISTRATION_CODE: '验证码无效或已过期，请重新获取。',
  INVALID_EMAIL_TOKEN: '邮箱验证链接无效或已过期，请重新获取。',
  INVALID_PASSWORD_RESET_TOKEN: '密码重置链接无效或已过期，请重新获取。',
  WEAK_PASSWORD: '密码强度不足，请使用更复杂的密码。',
  INVALID_DISPLAY_NAME: '请输入有效的名称。',
  INVALID_ACCESS_TOKEN: '登录状态已失效，请重新登录。',
  INVALID_REFRESH_TOKEN: '登录状态已失效，请重新登录。',
  INVALID_DEVICE_CODE: '设备授权码无效或已过期，请重新发起登录。',
  DEVICE_AUTHORIZATION_PENDING: '设备授权尚未完成，请在网页中批准设备。',
  USER_NOT_FOUND: '用户不存在。',
  VALIDATION_ERROR: '填写内容有误，请检查后重试。',
  FORBIDDEN: '您没有执行此操作的权限。',
  NOT_FOUND: '请求的内容不存在或已无法访问。',
  CONFLICT: '数据已发生变化，请刷新后重试。',
  INVALID_TRANSITION: '当前状态不支持此操作。',
  REQUEST_ERROR: '请求处理失败，请检查后重试。',
  INTERNAL_ERROR: '服务暂时不可用，请稍后重试。',
  SYNC_RESET_REQUIRED: '本地同步记录已失效，请重新同步。',
  BILLING_ORGANIZATION_READ_ONLY: '该组织当前为只读状态，请续费或调整用量后再操作。',
  BILLING_FREE_PROJECT_LIMIT_REACHED: '免费版项目数量已达上限，请升级套餐后继续创建。',
  BILLING_FREE_PLAN_MEMBERSHIP_LOCKED: '免费版暂不支持邀请成员，请升级套餐后继续操作。',
  BILLING_SEAT_LIMIT_EXCEEDED: '组织成员数量已达套餐上限，请升级套餐后继续邀请。',
  BILLING_ORGANIZATION_NOT_FOUND: '组织不存在或您无权访问。',
  BILLING_OWNER_REQUIRED: '只有组织所有者可以管理订阅与账单。',
  BILLING_PLAN_NOT_PURCHASABLE: '该套餐需要联系 VibePlan 开通。',
  BILLING_ORDER_NOT_FOUND: '订单不存在或已无法访问。',
  BILLING_ORDER_NOT_PAYABLE: '该订单当前无法继续支付。',
  PAYMENT_CONFIGURATION_INVALID: '支付配置不完整，请联系管理员。',
  PAYMENT_PROVIDER_MISMATCH: '支付方式与订单不匹配，请重新创建订单。',
  PAYMENT_PROVIDER_NOT_AVAILABLE: '当前支付方式暂不可用，请稍后重试。',
  PLATFORM_ADMIN_REQUIRED: '需要平台管理员权限。',
  PLATFORM_SUPER_ADMIN_REQUIRED: '需要超级管理员权限。',
  PLATFORM_ADMIN_TARGET_NOT_FOUND: '目标用户不存在，请确认对方已注册。',
  PLATFORM_ADMIN_PROTECTED: '该管理员受保护，无法移除。',
};

function webErrorMessage(code: unknown, status: number): string {
  if (typeof code === 'string' && webErrorMessages[code]) return webErrorMessages[code];
  if (status === 401) return '登录状态已失效，请重新登录。';
  if (status === 403) return '您没有执行此操作的权限。';
  if (status === 404) return '请求的内容不存在或已无法访问。';
  if (status === 409) return '数据已发生变化，请刷新后重试。';
  if (status === 422) return '填写内容有误，请检查后重试。';
  if (status >= 500) return '请求失败，请稍后重试。';
  return '请求失败，请稍后重试。';
}

let refreshPromise: Promise<boolean> | undefined;

export function showMessage(text: string, tone: MessageTone = 'success'): void {
  if (typeof window === 'undefined' || !text.trim()) return;
  window.dispatchEvent(new CustomEvent<AppMessage>(messageEvent, { detail: { text, tone } }));
}

async function hasActiveSession(): Promise<boolean> {
  return fetch(`${apiBase}/auth/me`, { credentials: 'include' })
    .then((response) => response.ok)
    .catch(() => false);
}

async function rotateRefreshToken(): Promise<boolean> {
  return fetch(`${apiBase}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  }).then((response) => response.ok).catch(() => false);
}

async function refreshWithBrowserLock(): Promise<boolean> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  const restoreSession = async () => (await hasActiveSession()) || rotateRefreshToken();

  // The lock spans tabs on the same origin. A waiting tab sees the winner's
  // rotated HttpOnly cookies and avoids reusing the now-revoked refresh token.
  return locks ? locks.request('vibe-plan-auth-refresh', restoreSession) : restoreSession();
}

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = refreshWithBrowserLock().finally(() => { refreshPromise = undefined; });
  }
  return refreshPromise;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, allowRefresh = true, notifyErrors = true, notifyUnauthorized = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...(init.body == null ? {} : { 'Content-Type': 'application/json' }), ...(init.headers ?? {}) },
    });
  } catch {
    const message = '网络连接失败，请检查网络后重试。';
    if (notifyErrors) showMessage(message, 'error');
    throw new Error(message);
  }
  if (allowRefresh && response.status === 401 && !noRefreshPaths.has(path) && await refreshSession()) {
    return apiRequest<T>(path, init, false, notifyErrors, notifyUnauthorized);
  }
  if (response.status === 401 && notifyUnauthorized && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(unauthorizedEvent));
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = webErrorMessage(payload.error?.code, response.status);
    if (notifyErrors) showMessage(message, 'error');
    throw new Error(message);
  }
  let result: T;
  if (response.status === 204) {
    result = undefined as T;
  } else {
    try {
      result = await response.json() as T;
    } catch {
      const message = '服务器返回的数据无法解析，请稍后重试。';
      if (notifyErrors) showMessage(message, 'error');
      throw new Error(message);
    }
  }
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') showMessage('操作成功');
  return result;
}

export { apiBase };

export type BillingPlanCode = 'free' | 'team_10' | 'team_30' | 'team_100' | 'enterprise_1000' | 'custom';
export type BillingSubscriptionStatus = 'free' | 'active' | 'grace' | 'expired' | 'scheduled_change' | 'manual';
export type BillingOrderStatus = 'pending' | 'paid' | 'scheduled' | 'closed' | 'failed' | 'refunded';

export type BillingSummary = {
  organizationId: string;
  role: 'owner' | 'admin' | 'member';
  subscription: {
    planCode: BillingPlanCode;
    status: BillingSubscriptionStatus;
    periodStartedAt?: string | null;
    periodEndsAt?: string | null;
    graceEndsAt?: string | null;
    scheduledPlanCode?: BillingPlanCode | null;
    scheduledEffectiveAt?: string | null;
  };
  policy: {
    canWriteOrganization: boolean;
    canCreateProject: boolean;
    canManageMembers: boolean;
    canManageBilling: boolean;
    memberUsage: number;
    memberLimit: number | null;
    projectUsage: number;
    projectLimit: number | null;
    denialCode?: string | null;
    denialReason?: string | null;
  };
  orders: BillingOrder[];
};

export type BillingOrder = {
  id: string;
  orderNo: string;
  planCode: BillingPlanCode;
  amountCents: number;
  status: BillingOrderStatus;
  provider?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  closedAt?: string | null;
};

export type BillingPayment = {
  provider: string;
  formAction?: string | null;
  formFields?: Record<string, string> | null;
};

export type BillingOrderResponse = BillingOrder & { payment?: BillingPayment | null };

export function getBillingSummary(organizationId: string) {
  return apiRequest<BillingSummary>(`/organizations/${organizationId}/billing`);
}

export function createBillingOrder(organizationId: string, planCode: BillingPlanCode) {
  return apiRequest<BillingOrderResponse>(`/organizations/${organizationId}/billing/orders`, {
    method: 'POST',
    body: JSON.stringify({ planCode }),
  });
}

export function getBillingOrder(organizationId: string, orderId: string) {
  return apiRequest<BillingOrder>(`/organizations/${organizationId}/billing/orders/${orderId}`);
}

export function confirmManualBillingOrder(organizationId: string, orderId: string) {
  return apiRequest<BillingOrder>(`/organizations/${organizationId}/billing/orders/${orderId}/confirm`, { method: 'POST', body: '{}' });
}

export type PlatformAdminRole = 'super_admin' | 'operator';

export type PlatformAdminIdentity = {
  userId: string;
  email: string;
  role: PlatformAdminRole;
};

export type AdminOverview = {
  userCount: number;
  organizationCount: number;
  activeSubscriptionCount: number;
  revenue30dCents: number;
  pendingOrderCount: number;
};

export type AdminPage<T> = { items: T[]; nextCursor: string | null };

export type AdminUser = {
  id: string;
  email: string;
  displayName?: string | null;
  createdAt: string;
  emailVerifiedAt?: string | null;
  organizationCount: number;
  role?: PlatformAdminRole | null;
};

export type AdminOrganization = {
  id: string;
  name: string;
  createdAt: string;
  ownerEmail: string;
  planCode?: BillingPlanCode | null;
  periodEnd?: string | null;
  graceEndsAt?: string | null;
  memberCount: number;
  projectCount: number;
  state: 'free' | 'active' | 'grace' | 'read_only';
};

export type AdminOrder = {
  id: string;
  orderNo: string;
  organizationName: string;
  purchaserEmail: string;
  planCode: BillingPlanCode;
  amountCents: number;
  status: BillingOrderStatus;
  providerTransactionId?: string | null;
  paidAt?: string | null;
  createdAt: string;
};

export type AdminAdministrator = PlatformAdminIdentity & {
  displayName?: string | null;
  createdAt?: string | null;
  bootstrap?: boolean;
};

function adminQuery(filters: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function getPlatformAdminMe() {
  // A 403 is the normal result for authenticated non-admin users; the page
  // uses it to hide the admin navigation and should not show an error toast.
  return apiRequest<PlatformAdminIdentity>('/admin/me', {}, true, false);
}

export function getAdminOverview() {
  return apiRequest<AdminOverview>('/admin/overview');
}

export function getAdminUsers(filters: { q?: string; cursor?: string | null; limit?: number } = {}) {
  return apiRequest<AdminPage<AdminUser>>(`/admin/users${adminQuery(filters)}`);
}

export function getAdminOrganizations(filters: { q?: string; planCode?: string; state?: string; cursor?: string | null; limit?: number } = {}) {
  return apiRequest<AdminPage<AdminOrganization>>(`/admin/organizations${adminQuery(filters)}`);
}

export function getAdminOrders(filters: { q?: string; status?: string; planCode?: string; from?: string; to?: string; cursor?: string | null; limit?: number } = {}) {
  return apiRequest<AdminPage<AdminOrder>>(`/admin/orders${adminQuery(filters)}`);
}

export function getPlatformAdministrators() {
  return apiRequest<AdminPage<AdminAdministrator> | AdminAdministrator[]>('/admin/admins');
}

export function grantPlatformAdministrator(email: string, role: PlatformAdminRole) {
  return apiRequest<AdminAdministrator>('/admin/admins', { method: 'POST', body: JSON.stringify({ email, role }) });
}

export function revokePlatformAdministrator(userId: string) {
  return apiRequest<void>(`/admin/admins/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}
