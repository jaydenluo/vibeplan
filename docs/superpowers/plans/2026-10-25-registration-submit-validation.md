# Registration Submit Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users click the registration button at any point and receive clear Chinese explanations of incomplete requirements.

**Architecture:** Keep form validation local to `RegisterPage`, where it can account for API-provided email-verification state and the existing sent-code state. Replace native HTML blocking with a small validation result that drives inline error text and accessible input metadata; do not change the API contract.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library.

---

## File Structure

- `apps/web/src/auth/RegisterPage.tsx`: Owns registration input state, submit-time validation, inline error rendering and focus management.
- `apps/web/src/app.test.tsx`: Covers blocked registrations and successful request preservation through the real registration component.
- `apps/web/src/index.css`: Hosts the existing auth-form styles and will receive the scoped field-error presentation rule if none exists.

### Task 1: Define expected submit behavior with a failing UI test

**Files:**
- Modify: `apps/web/src/app.test.tsx`
- Test: `apps/web/src/app.test.tsx`

- [x] **Step 1: Add a test for an unsent registration code.**

```tsx
it('explains that a registration code must be requested instead of disabling registration', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emailVerificationRequired: true, emailDeliveryConfigured: true }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);

  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '王明' } });
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'wang@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct horse battery staple' } });
  fireEvent.click(screen.getByRole('button', { name: '注册' }));

  expect(await screen.findByText('请先获取邮箱验证码')).toBeTruthy();
  expect(screen.getByRole('button', { name: '注册' })).not.toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/auth\/register$/), expect.anything());
});
```

- [x] **Step 2: Run the focused test to confirm it fails because registration is currently disabled.**

Run: `pnpm --filter @vibeplan/web test -- apps/web/src/app.test.tsx -t "explains that a registration code"`

Expected: FAIL because the button cannot trigger a validation message.

### Task 2: Implement accessible local validation

**Files:**
- Modify: `apps/web/src/auth/RegisterPage.tsx`
- Test: `apps/web/src/app.test.tsx`

- [x] **Step 1: Add a compact validation result and refs for fields.**

```tsx
type FieldName = 'displayName' | 'email' | 'verificationCode' | 'password';
type FieldErrors = Partial<Record<FieldName, string>>;

function validationErrors(values: { displayName: string; email: string; password: string; verificationCode: string; verificationRequired: boolean; codeSent: boolean; deliveryConfigured?: boolean }): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.displayName.trim()) errors.displayName = '请输入姓名';
  if (!/^\S+@\S+\.\S+$/.test(values.email)) errors.email = '请输入有效的邮箱地址';
  if (values.verificationRequired && values.deliveryConfigured === false) errors.verificationCode = '邮件服务尚未配置，请联系管理员。';
  else if (values.verificationRequired && !values.codeSent) errors.verificationCode = '请先获取邮箱验证码';
  else if (values.verificationRequired && !/^\d{6}$/.test(values.verificationCode)) errors.verificationCode = '请输入 6 位邮箱验证码';
  if (values.password.length < 8) errors.password = '密码至少需要 8 位';
  return errors;
}
```

- [x] **Step 2: Set `noValidate` on the form and handle errors before the API request.**

```tsx
const errors = validationErrors({ displayName, email, password, verificationCode, verificationRequired, codeSent, deliveryConfigured });
setFieldErrors(errors);
const firstInvalid = (Object.keys(errors) as FieldName[])[0];
if (firstInvalid) {
  fieldRefs.current[firstInvalid]?.focus();
  return;
}
await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName, ...(verificationRequired ? { verificationCode } : {}) }) });
```

- [x] **Step 3: Render one `role="alert"` error beneath every invalid input.**

```tsx
<input aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'register-email-error' : undefined} />
{fieldErrors.email && <span id="register-email-error" className="field-error" role="alert">{fieldErrors.email}</span>}
```

- [x] **Step 4: Run the focused test.**

Run: `pnpm --filter @vibeplan/web test -- apps/web/src/app.test.tsx -t "explains that a registration code"`

Expected: PASS.

### Task 3: Cover invalid fields and preserve successful registration

**Files:**
- Modify: `apps/web/src/app.test.tsx`
- Test: `apps/web/src/app.test.tsx`

- [x] **Step 1: Add a test that submits empty/invalid fields and asserts all Chinese field messages plus no register API call.**

```tsx
fireEvent.click(screen.getByRole('button', { name: '注册' }));
expect(await screen.findByText('请输入姓名')).toBeTruthy();
expect(screen.getByText('请输入有效的邮箱地址')).toBeTruthy();
expect(screen.getByText('密码至少需要 8 位')).toBeTruthy();
expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/auth\/register$/), expect.anything());
```

- [x] **Step 2: Run both new tests before editing production code further.**

Run: `pnpm --filter @vibeplan/web test -- apps/web/src/app.test.tsx -t "registration code|invalid fields"`

Expected: FAIL before Task 2, PASS after Task 2.

- [x] **Step 3: Run the full web test suite and build.**

Run: `pnpm --filter @vibeplan/web test && pnpm --filter @vibeplan/web build`

Expected: both commands exit 0.

- [x] **Step 4: Check whitespace and inspect the diff.**

Run: `git diff --check && git diff -- apps/web/src/auth/RegisterPage.tsx apps/web/src/app.test.tsx apps/web/src/index.css`

Expected: no whitespace errors; only scoped registration validation changes.
