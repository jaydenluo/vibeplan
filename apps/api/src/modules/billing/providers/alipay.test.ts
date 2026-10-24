import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AlipayProvider } from './alipay.js';
import { BillingProviderError } from './types.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function sign(payload: Record<string, string>): string {
  const content = Object.keys(payload).filter((key) => key !== 'sign' && key !== 'sign_type' && payload[key] !== '').sort().map((key) => `${key}=${payload[key]}`).join('&');
  const signer = createSign('RSA-SHA256');
  signer.update(content);
  return signer.sign(privatePem, 'base64');
}

describe('AlipayProvider', () => {
  const provider = new AlipayProvider({ appId: '2026101300000000', privateKey: privatePem, publicKey: publicPem, gateway: 'https://openapi.alipay.com/gateway.do', sellerId: '2088000000000000' });

  it('creates an RSA2 signed web payment request', async () => {
    const request = await provider.createPayment({ orderNo: 'VP202610130001', subject: 'VibePlan 团队 10 人年度订阅', amountCents: 48000, notifyUrl: 'https://vibeplan.example/api/billing/alipay/notify', returnUrl: 'https://vibeplan.example/billing/return' });
    expect(request).toMatchObject({ provider: 'alipay', orderNo: 'VP202610130001', formAction: 'https://openapi.alipay.com/gateway.do' });
    expect(request.formFields).toMatchObject({ app_id: '2026101300000000', method: 'alipay.trade.page.pay', sign_type: 'RSA2' });
    expect(JSON.parse(request.formFields.biz_content)).toMatchObject({ out_trade_no: 'VP202610130001', total_amount: '480.00' });
    const payload = { ...request.formFields };
    expect(provider.verifyNotification({ ...payload, out_trade_no: 'VP202610130001', trade_no: '202610132200000001', total_amount: '480.00', trade_status: 'TRADE_SUCCESS', seller_id: '2088000000000000', sign: sign({ ...payload, out_trade_no: 'VP202610130001', trade_no: '202610132200000001', total_amount: '480.00', trade_status: 'TRADE_SUCCESS', seller_id: '2088000000000000' }) })).toMatchObject({ amountCents: 48000 });
  });

  it('rejects invalid signature, app, seller, and amount data', () => {
    const payload = { app_id: '2026101300000000', seller_id: '2088000000000000', out_trade_no: 'VP1', trade_no: 'TRADE1', total_amount: '480.00', trade_status: 'TRADE_SUCCESS' };
    expect(() => provider.verifyNotification({ ...payload, sign: 'invalid' })).toThrow(BillingProviderError);
    expect(() => provider.verifyNotification({ ...payload, app_id: 'wrong', sign: sign({ ...payload, app_id: 'wrong' }) })).toThrow(/merchant does not match/);
    expect(() => provider.verifyNotification({ ...payload, seller_id: 'wrong', sign: sign({ ...payload, seller_id: 'wrong' }) })).toThrow(/merchant does not match/);
    expect(() => provider.verifyNotification({ ...payload, total_amount: 'not-a-number', sign: sign({ ...payload, total_amount: 'not-a-number' }) })).toThrow(/amount is invalid/);
  });

  it('rejects signed notifications missing required transaction fields', () => {
    const payload = { app_id: '2026101300000000', seller_id: '2088000000000000', out_trade_no: '', trade_no: '', total_amount: '480.00', trade_status: '' };
    expect(() => provider.verifyNotification({ ...payload, sign: sign(payload) })).toThrow(/required payment fields are missing/);
  });
});
