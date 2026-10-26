# Email Delivery and Resend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver authentication email through configured SMTP only, report unavailable delivery accurately, and prevent registration-code resend for 30 seconds in the Web client.

**Architecture:** A focused SMTP mailer validates environment configuration and owns all transport calls. `AuthService` checks that mail delivery is available before creating short-lived credentials, while Fastify converts mail failures into stable API error codes. The registration page reads the delivery capability and stores a resend deadline in session storage; the server remains the authority for configuration and rate limiting.

**Tech Stack:** TypeScript, Fastify, Nodemailer, Vitest, React, sessionStorage.

---

## File Structure

- `apps/api/src/modules/mail/mailer.ts`: SMTP configuration parser, safe mail error type, transactional transport boundary, and auth email templates.
- `apps/api/src/modules/mail/mailer.test.ts`: unit coverage for missing configuration, invalid input, successful handoff, and sanitized transport failure.
- `apps/api/src/modules/auth/service.ts`: mailer capability boundary and preflight before registration-code/reset-token persistence.
- `apps/api/src/app.ts`: default SMTP mailer wiring, capability response, and API error serialization.
- `apps/api/src/app.test.ts`: HTTP behavior for unavailable mail delivery and `/auth/config`.
- `apps/web/src/api/client.ts`: Chinese API message mappings for the two mail-delivery errors.
- `apps/web/src/auth/RegisterPage.tsx`: delivery-state hint and session-restored 30-second resend cooldown.
- `apps/web/src/app.test.tsx`: registration-page countdown/capability behavior using fake timers.
- `.env.example`, `deploy/server/.env.example`, `README.md`: documented `APP_BASE_URL` and real SMTP behavior without credentials.
- `apps/api/package.json`, `pnpm-lock.yaml`: production Nodemailer dependency and TypeScript declarations.

### Task 1: Define and test the SMTP mail boundary

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Replace: `apps/api/src/modules/mail/mailer.ts`
- Create: `apps/api/src/modules/mail/mailer.test.ts`

- [x] **Step 1: Add failing mailer tests**

```ts
it('rejects mail delivery when a required SMTP setting is absent', async () => {
  const mailer = new SmtpMailer({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'user', SMTP_PASSWORD: 'secret', SMTP_FROM: 'noreply@example.com' });
  expect(() => mailer.assertConfigured()).toThrow(expect.objectContaining({ code: 'EMAIL_DELIVERY_NOT_CONFIGURED' }));
});

it('maps a transport failure without leaking its details', async () => {
  const mailer = new SmtpMailer(validEnvironment, { sendMail: async () => { throw new Error('authentication failed for secret'); } });
  await expect(mailer.sendRegistrationCode('member@example.com', '123456')).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED' });
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run --fileParallelism=false apps/api/src/modules/mail/mailer.test.ts`

Expected: FAIL because `SmtpMailer` and its delivery errors do not exist.

- [x] **Step 3: Add Nodemailer and implement the smallest transport abstraction**

Run: `pnpm --filter @vibeplan/api add nodemailer && pnpm --filter @vibeplan/api add -D @types/nodemailer`

Implement `SmtpMailer` with an injected `sendMail`-only test transport, a strict parser for `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `APP_BASE_URL`, and an `EmailDeliveryError` with only `EMAIL_DELIVERY_NOT_CONFIGURED` or `EMAIL_DELIVERY_FAILED`. `sendRegistrationCode` sends a 10-minute code; `sendPasswordReset` sends a URL constructed as `new URL('/reset-password', appBaseUrl)` with the token query parameter. Do not log recipient, tokens, codes, SMTP credentials, or raw transport exceptions.

- [x] **Step 4: Run the mailer tests**

Run: `pnpm vitest run --fileParallelism=false apps/api/src/modules/mail/mailer.test.ts`

Expected: PASS.

### Task 2: Block auth mutations before inaccurate success is returned

**Files:**
- Modify: `apps/api/src/modules/auth/service.ts`
- Modify: `apps/api/src/modules/auth/auth.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

- [x] **Step 1: Add failing AuthService and HTTP tests**

```ts
it('does not create a registration code when delivery is unavailable', async () => {
  const auth = new AuthService(db, unavailableMailer, { accessSecret: 'test', emailVerificationRequired: true });
  await expect(auth.requestRegistrationCode('new@example.com')).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_NOT_CONFIGURED' });
  expect(await registrationCodeCount('new@example.com')).toBe(0);
});

it('reports mail delivery capability and unavailable reset delivery through HTTP', async () => {
  expect((await app.inject({ method: 'GET', url: '/auth/config' })).json()).toMatchObject({ emailDeliveryConfigured: false });
  const response = await app.inject({ method: 'POST', url: '/auth/password/request', payload: { email: 'member@example.com' } });
  expect(response.json().error.code).toBe('EMAIL_DELIVERY_NOT_CONFIGURED');
});
```

- [x] **Step 2: Run the focused API tests to verify they fail**

Run: `pnpm vitest run --fileParallelism=false apps/api/src/modules/auth/auth.test.ts apps/api/src/app.test.ts`

Expected: FAIL because `Mailer` has no capability methods and `/auth/config` does not expose delivery status.

- [x] **Step 3: Implement preflight and stable HTTP errors**

Add `isConfigured()` and `assertConfigured()` to `Mailer`. In `requestRegistrationCode`, call `assertConfigured()` before generating or inserting the code, then send before persisting. In `requestPasswordReset`, call `assertConfigured()` before looking up a user and send before persisting its reset token. Preserve successful no-op handling for an unknown email when delivery is configured. Wire `SmtpMailer` into `buildApp`, return `emailDeliveryConfigured` in `/auth/config`, and serialize `EmailDeliveryError` as HTTP 503 with its stable code.

- [x] **Step 4: Run the API tests**

Run: `pnpm vitest run --fileParallelism=false apps/api/src/modules/auth/auth.test.ts apps/api/src/app.test.ts`

Expected: PASS.

### Task 3: Make Web feedback and resend timing truthful

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/client.test.ts`
- Modify: `apps/web/src/auth/RegisterPage.tsx`
- Modify: `apps/web/src/app.test.tsx`

- [x] **Step 1: Add failing Web tests**

```tsx
it('disables registration-code sending while delivery is not configured', async () => {
  mockAuthConfig({ emailVerificationRequired: true, emailDeliveryConfigured: false });
  render(<App />);
  expect(await screen.findByText('邮件服务尚未配置，请联系管理员。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '获取验证码' })).toBeDisabled();
});

it('restores the remaining registration-code resend cooldown after remounting', async () => {
  sessionStorage.setItem('vibe-plan.registration-code-resend-at', String(Date.now() + 30_000));
  render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);
  expect(await screen.findByRole('button', { name: '30 秒后重新发送' })).toBeDisabled();
});
```

- [x] **Step 2: Run the focused Web tests to verify they fail**

Run: `pnpm vitest run --fileParallelism=false apps/web/src/api/client.test.ts apps/web/src/app.test.tsx`

Expected: FAIL because the client has no mail error mapping and the registration page has no capability or cooldown state.

- [x] **Step 3: Implement the Web behavior**

Map `EMAIL_DELIVERY_NOT_CONFIGURED` to `邮件服务尚未配置，请联系管理员。` and `EMAIL_DELIVERY_FAILED` to `邮件发送失败，请稍后重试或联系管理员。`. Extend auth-config parsing with optional `emailDeliveryConfigured`. Use a one-second effect driven by a `sessionStorage` deadline under `vibe-plan.registration-code-resend-at`; remove it at zero. Start the deadline only after the code request resolves. Disable the send button during cooldown or an explicit unavailable delivery status, and render the Chinese unavailable hint.

- [x] **Step 4: Run the Web tests**

Run: `pnpm vitest run --fileParallelism=false apps/web/src/api/client.test.ts apps/web/src/app.test.tsx`

Expected: PASS.

### Task 4: Document configuration and verify the integrated feature

**Files:**
- Modify: `.env.example`
- Modify: `deploy/server/.env.example`
- Modify: `README.md`

- [x] **Step 1: Update non-secret configuration examples and documentation**

Add `APP_BASE_URL=http://localhost:5173` to the local example and `APP_BASE_URL=https://vibeplan.szxinjin.cn` to the server example. Document that all SMTP fields plus the application URL are required for email verification and password reset; explain that missing delivery configuration returns a visible error rather than succeeding. Do not add real credentials to examples.

- [x] **Step 2: Run integrated verification**

Run: `pnpm vitest run --fileParallelism=false apps/api/src apps/web/src && pnpm lint && pnpm build && git diff --check`

Expected: all test files pass, TypeScript compilation and production build succeed, and the diff has no whitespace errors.

- [x] **Step 3: Perform a local configuration smoke check**

Run: `curl --silent --show-error --max-time 5 http://localhost:4000/auth/config`

Expected: a JSON response includes `emailVerificationRequired` and `emailDeliveryConfigured`. Do not print SMTP credentials, tokens, or email contents.
