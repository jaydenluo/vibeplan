export type PaymentOrderInput = {
  orderNo: string;
  subject: string;
  amountCents: number;
  notifyUrl: string;
  returnUrl: string;
};

export type PaymentRequest = {
  provider: string;
  orderNo: string;
  formAction: string;
  formFields: Record<string, string>;
};

export type VerifiedNotification = {
  orderNo: string;
  providerTransactionId: string;
  amountCents: number;
  tradeStatus: string;
  notificationId?: string;
};

export interface BillingProvider {
  readonly name: string;
  createPayment(input: PaymentOrderInput): Promise<PaymentRequest>;
  verifyNotification(payload: Record<string, string>): VerifiedNotification;
}

export class BillingProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BillingProviderError';
  }
}
