import { createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';
import { BillingProviderError, type BillingProvider, type PaymentOrderInput, type PaymentRequest, type VerifiedNotification } from './types.js';

type AlipayOptions = {
  appId: string;
  privateKey: string;
  publicKey: string;
  gateway: string;
  sellerId?: string;
};

function canonicalize(payload: Record<string, string>, notification = false): string {
  return Object.keys(payload)
    .filter((key) => key !== 'sign' && (!notification || key !== 'sign_type') && payload[key] !== '' && payload[key] !== undefined)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('&');
}

function amountToString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export class AlipayProvider implements BillingProvider {
  readonly name = 'alipay';

  constructor(private readonly options: AlipayOptions) {
    if (!options.appId || !options.privateKey || !options.publicKey || !options.gateway) {
      throw new BillingProviderError('PAYMENT_CONFIGURATION_INVALID', 'Alipay payment configuration is incomplete.');
    }
    options.privateKey = options.privateKey.replaceAll('\\n', '\n').trim();
    options.publicKey = options.publicKey.replaceAll('\\n', '\n').trim();
    try {
      const privateKey = createPrivateKey(options.privateKey);
      const publicKey = createPublicKey(options.publicKey);
      if (privateKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyType !== 'rsa' || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('RSA2 requires 2048-bit RSA keys.');
      const gateway = new URL(options.gateway);
      if (gateway.protocol !== 'https:' || gateway.pathname !== '/gateway.do' || !['openapi.alipay.com', 'openapi-sandbox.dl.alipaydev.com', 'openapi.alipaydev.com'].includes(gateway.hostname)) throw new Error('Invalid Alipay gateway.');
    } catch {
      throw new BillingProviderError('PAYMENT_CONFIGURATION_INVALID', 'Alipay RSA2 keys or gateway are invalid.');
    }
  }

  async createPayment(input: PaymentOrderInput): Promise<PaymentRequest> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new BillingProviderError('PAYMENT_CONFIGURATION_INVALID', 'Payment amount must be a positive integer in cents.');
    const fields: Record<string, string> = {
      app_id: this.options.appId,
      method: 'alipay.trade.page.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
      version: '1.0',
      notify_url: input.notifyUrl,
      return_url: input.returnUrl,
      biz_content: JSON.stringify({
        out_trade_no: input.orderNo,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        total_amount: amountToString(input.amountCents),
        subject: input.subject,
      }),
    };
    const content = canonicalize(fields);
    const signer = createSign('RSA-SHA256');
    signer.update(content);
    fields.sign = signer.sign(this.options.privateKey, 'base64');
    return { provider: this.name, orderNo: input.orderNo, formAction: this.options.gateway, formFields: fields };
  }

  verifyNotification(payload: Record<string, string>): VerifiedNotification {
    const sign = payload.sign;
    const content = canonicalize(payload, true);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(content);
    if (!sign || !verifier.verify(this.options.publicKey, sign, 'base64')) {
      throw new BillingProviderError('PAYMENT_VERIFICATION_FAILED', 'Alipay notification signature is invalid.');
    }
    if (payload.app_id !== this.options.appId || (this.options.sellerId && payload.seller_id !== this.options.sellerId)) {
      throw new BillingProviderError('PAYMENT_VERIFICATION_FAILED', 'Alipay notification merchant does not match.');
    }
    if (!payload.out_trade_no?.trim() || !payload.trade_no?.trim() || !payload.trade_status?.trim()) {
      throw new BillingProviderError('PAYMENT_VERIFICATION_FAILED', 'Alipay required payment fields are missing.');
    }
    const amount = Number(payload.total_amount);
    if (!/^\d+(\.\d{1,2})?$/.test(payload.total_amount ?? '') || !Number.isSafeInteger(Math.round(amount * 100)) || amount <= 0) {
      throw new BillingProviderError('PAYMENT_VERIFICATION_FAILED', 'Alipay notification amount is invalid.');
    }
    return {
      orderNo: payload.out_trade_no,
      providerTransactionId: payload.trade_no,
      amountCents: Math.round(amount * 100),
      tradeStatus: payload.trade_status,
      notificationId: payload.notify_id,
    };
  }
}

export function createAlipayProviderFromEnv(): AlipayProvider {
  if (process.env.NODE_ENV === 'production' && (!process.env.ALIPAY_SELLER_ID?.trim() || (process.env.ALIPAY_GATEWAY && process.env.ALIPAY_GATEWAY !== 'https://openapi.alipay.com/gateway.do'))) {
    throw new BillingProviderError('PAYMENT_CONFIGURATION_INVALID', 'Production Alipay requires the seller ID and production gateway.');
  }
  return new AlipayProvider({
    appId: process.env.ALIPAY_APP_ID ?? '',
    privateKey: process.env.ALIPAY_PRIVATE_KEY ?? '',
    publicKey: process.env.ALIPAY_PUBLIC_KEY ?? '',
    gateway: process.env.ALIPAY_GATEWAY ?? 'https://openapi.alipay.com/gateway.do',
    sellerId: process.env.ALIPAY_SELLER_ID || undefined,
  });
}
