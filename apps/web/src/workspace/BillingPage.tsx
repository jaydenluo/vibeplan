import { useCallback, useEffect, useState } from 'react';
import {
  type BillingOrder,
  type BillingPayment,
  type BillingPlanCode,
  type BillingSummary,
  confirmManualBillingOrder,
  createBillingOrder,
  getBillingOrder,
  getBillingSummary,
  resumeBillingPayment,
  showMessage,
} from '../api/client.js';

type Props = {
  organizationId: string;
  organizationName: string;
  onBack?: () => void;
};

type Plan = { code: BillingPlanCode; name: string; priceCents: number | null; memberLimit: number | null; description: string };

const plans: Plan[] = [
  { code: 'free', name: '个人免费', priceCents: 0, memberLimit: 1, description: '个人使用，免费组织合计最多 50 个项目。' },
  { code: 'personal', name: '个人版', priceCents: 12_800, memberLimit: 1, description: '个人使用，项目数量不限。' },
  { code: 'team_10', name: '团队 10 人', priceCents: 48_000, memberLimit: 10, description: '适合小型协作团队，项目数量不限。' },
  { code: 'team_30', name: '团队 30 人', priceCents: 128_000, memberLimit: 30, description: '适合稳定的研发与产品协作。' },
  { code: 'team_100', name: '团队 100 人', priceCents: 368_000, memberLimit: 100, description: '适合多团队协作与跨项目管理。' },
  { code: 'enterprise_1000', name: '企业协作', priceCents: 880_000, memberLimit: 1000, description: '支持最多 1,000 名组织成员。' },
  { code: 'custom', name: '定制企业', priceCents: null, memberLimit: null, description: '超过 1,000 人或需要定制条款，请联系开通。' },
];

const planByCode = new Map(plans.map((plan) => [plan.code, plan]));

function formatAmount(cents: number) {
  return `¥${(cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}/年`;
}

function formatDate(value?: string | null) {
  if (!value) return '未设置';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function planName(code: BillingPlanCode) {
  return planByCode.get(code)?.name ?? code;
}

function orderStatus(status: BillingOrder['status']) {
  return ({ pending: '等待付款', paid: '已付款', scheduled: '已安排', closed: '已关闭', failed: '付款失败', refunded: '已退款' } as const)[status];
}

function submitPayment(payment: BillingPayment) {
  if (!payment?.formAction || typeof document === 'undefined') return;
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = payment.formAction;
  form.style.display = 'none';
  for (const [name, value] of Object.entries(payment.formFields ?? {})) {
    const input = document.createElement('input');
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export function BillingPage({ organizationId, organizationName, onBack }: Props) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [pendingOrder, setPendingOrder] = useState<BillingOrder | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paymentBusy, setPaymentBusy] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const value = await getBillingSummary(organizationId);
      setSummary(value);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  useEffect(() => {
    if (!summary || pendingOrder) return;
    const existing = summary.orders.find((order) => order.status === 'pending');
    if (existing) setPendingOrder(existing);
  }, [pendingOrder, summary]);

  useEffect(() => {
    if (!pendingOrder || pendingOrder.status !== 'pending') return;
    let active = true;
    const check = async () => {
      try {
        const next = await getBillingOrder(organizationId, pendingOrder.id);
        if (!active) return;
        setPendingOrder(next);
        if (next.status !== 'pending') {
          showMessage(next.status === 'paid' ? '付款已确认，订阅权益已更新。' : `订单${orderStatus(next.status)}。`);
          void loadSummary();
        }
      } catch {
        // Keep the pending state. A later interval or manual refresh will retry.
      }
    };
    const timer = window.setInterval(() => { void check(); }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [loadSummary, organizationId, pendingOrder]);

  async function startCheckout(plan: Plan) {
    try {
      const order = await createBillingOrder(organizationId, plan.code);
      setPendingOrder(order);
      if (order.payment?.provider === 'alipay') submitPayment(order.payment);
    } catch { /* The request client has shown the failure. */ }
  }

  async function confirmManualPayment() {
    if (!pendingOrder) return;
    try {
      const order = await confirmManualBillingOrder(organizationId, pendingOrder.id);
      setPendingOrder(order);
      showMessage('付款已确认，订阅权益已更新。');
      await loadSummary();
    } catch { /* The request client has shown the failure. */ }
  }

  async function resumePayment() {
    if (!pendingOrder || paymentBusy) return;
    setPaymentBusy(true);
    try {
      const order = await resumeBillingPayment(organizationId, pendingOrder.id);
      setPendingOrder(order);
      if (order.payment?.provider === 'alipay') submitPayment(order.payment);
    } finally { setPaymentBusy(false); }
  }

  if (loading && !summary) return <section className="billing-page"><p className="muted">正在加载订阅与账单…</p></section>;
  if (!summary) return <section className="billing-page"><p className="muted">{loadFailed ? '暂无可显示的订阅信息。' : '正在加载订阅与账单…'}</p><button className="secondary" type="button" onClick={() => void loadSummary()}>重试</button></section>;

  const { subscription, policy } = summary;
  const currentPlan = planByCode.get(subscription.planCode) ?? plans[0];
  const canManageBilling = summary.role === 'owner' && policy.canManageBilling;
  const warning = !policy.canWriteOrganization
    ? policy.denialReason || '订阅已过宽限期，组织现在为只读状态。'
    : subscription.status === 'grace'
      ? `订阅已到期，宽限期至 ${formatDate(subscription.graceEndsAt)}。请尽快续费。`
      : '';

  return <section className="management-page billing-page">
    <header className="page-heading">
      <div><p className="eyebrow">组织设置</p><h2>订阅与账单</h2><p className="muted">{organizationName} 的订阅、成员额度与付款记录。</p></div>
      <div className="page-actions">{onBack && <button className="secondary" type="button" onClick={onBack}>返回团队</button>}<button className="secondary" type="button" onClick={() => void loadSummary()}>刷新</button></div>
    </header>
    {warning && <p className={`billing-banner ${policy.canWriteOrganization ? 'warning' : 'read-only'}`} role="alert">{warning}</p>}
    {!canManageBilling && <p className="billing-notice">只有组织所有者可以管理订阅与账单。</p>}
    {canManageBilling && summary.payment && !summary.payment.available && <p className="billing-notice">在线支付暂未开通，请联系管理员。</p>}

    <section className="billing-current" aria-label="当前订阅">
      <div><span>当前套餐</span><strong>{currentPlan.name}</strong><small>{subscription.status === 'grace' ? '宽限期内' : subscription.status === 'expired' ? '只读' : '有效'}</small></div>
      <div><span>组织成员</span><strong>{policy.memberUsage} / {policy.memberLimit ?? '不限'} 人</strong><small>按组织去重，同一成员加入多个团队只占一个席位。</small></div>
      <div><span>项目额度</span><strong>{policy.projectLimit == null ? '项目不限数量' : `${policy.projectUsage} / ${policy.projectLimit} 个`}</strong><small>{policy.projectLimit == null ? '当前组织内项目数量不限。' : '免费项目额度由同一所有者的免费组织合计计算。'}</small></div>
      <div><span>到期日期</span><strong>{subscription.planCode === 'free' ? '长期免费' : formatDate(subscription.periodEndsAt)}</strong>{subscription.scheduledPlanCode && <small>下次续费将使用 {planName(subscription.scheduledPlanCode)}。</small>}</div>
    </section>

    {pendingOrder?.status === 'pending' && <section className="billing-pending" aria-live="polite"><strong>{pendingOrder.provider === 'manual' ? '测试支付订单' : '等待付款'}</strong><span>订单号：{pendingOrder.orderNo}。支付完成后此页面会自动更新。</span>{pendingOrder.provider === 'manual' && canManageBilling && <button className="secondary" type="button" onClick={() => void confirmManualPayment()}>确认测试付款</button>}{pendingOrder.provider === 'alipay' && canManageBilling && <button className="primary" type="button" disabled={paymentBusy} onClick={() => void resumePayment()}>继续支付</button>}</section>}

    <section className="billing-section"><div className="billing-section-heading"><div><h3>订阅套餐</h3><p>个人免费自动生效，无需续费。付费套餐按年主动续费，不会自动扣款。降级会保存为下一次续费选择。</p></div></div><div className="billing-plan-grid">
      {plans.map((plan) => {
        const isCurrent = plan.code === currentPlan.code;
        const isCustom = plan.code === 'custom';
        const isFree = plan.code === 'free';
        const isDowngrade = !isCustom && plan.priceCents !== null && currentPlan.priceCents !== null && plan.priceCents < currentPlan.priceCents;
        const actionLabel = isCurrent ? '续费一年' : isDowngrade ? `安排降级至${plan.name}` : `升级至${plan.name}`;
        return <article className={`billing-plan${isCurrent ? ' current' : ''}`} key={plan.code}><div className="billing-plan-heading"><h4>{plan.name}</h4>{isCurrent && <span>当前</span>}</div><strong className="billing-price">{isFree ? '长期免费' : plan.priceCents == null ? '联系开通' : formatAmount(plan.priceCents)}</strong><p>{plan.memberLimit == null ? '成员数量按合同约定' : `最多 ${plan.memberLimit} 名组织成员`}</p><small>{plan.description}</small>{isFree ? <p className="muted">自动生效，无需续费</p> : canManageBilling && (isCustom ? <button className="secondary" type="button" onClick={() => showMessage('请联系 VibePlan 获取定制企业套餐。')}>联系开通定制企业</button> : <button className={isCurrent ? 'secondary' : 'primary'} type="button" disabled={Boolean(pendingOrder?.status === 'pending') || summary.payment?.available === false} onClick={() => void startCheckout(plan)}>{actionLabel}</button>)}</article>;
      })}
    </div></section>

    <section className="billing-section"><div className="billing-section-heading"><div><h3>订单记录</h3><p>付款以支付宝异步通知确认结果为准。</p></div></div>{summary.orders.length === 0 ? <p className="muted">暂无付款订单。</p> : <div className="billing-orders" role="table" aria-label="订单记录"><div role="row" className="billing-order-header"><span>订单号</span><span>套餐</span><span>金额</span><span>状态</span><span>付款时间</span></div>{summary.orders.map((order) => <div role="row" className="billing-order" key={order.id}><span>{order.orderNo}</span><span>{planName(order.planCode)}</span><span>{formatAmount(order.amountCents)}</span><span>{orderStatus(order.status)}</span><span>{order.paidAt ? formatDate(order.paidAt) : '—'}</span></div>)}</div>}</section>
  </section>;
}
