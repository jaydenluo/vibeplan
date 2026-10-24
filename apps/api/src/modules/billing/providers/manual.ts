import { BillingProviderError, type BillingProvider, type PaymentOrderInput, type PaymentRequest, type VerifiedNotification } from './types.js';

export class ManualBillingProvider implements BillingProvider {
  readonly name = 'manual';

  async createPayment(input: PaymentOrderInput): Promise<PaymentRequest> {
    return {
      provider: this.name,
      orderNo: input.orderNo,
      formAction: input.returnUrl,
      formFields: { provider: this.name, orderNo: input.orderNo },
    };
  }

  verifyNotification(payload: Record<string, string>): VerifiedNotification {
    const orderNo = payload.orderNo ?? payload.out_trade_no;
    const amount = Number(payload.amountCents ?? payload.total_amount_cents);
    if (!orderNo || !Number.isInteger(amount) || amount < 0) {
      throw new BillingProviderError('PAYMENT_VERIFICATION_FAILED', 'Manual payment payload is invalid.');
    }
    return {
      orderNo,
      providerTransactionId: payload.providerTransactionId ?? `manual-${orderNo}`,
      amountCents: amount,
      tradeStatus: payload.tradeStatus ?? 'TRADE_SUCCESS',
      notificationId: payload.notificationId,
    };
  }
}
