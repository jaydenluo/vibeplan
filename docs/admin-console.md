# VibePlan Platform Admin Console

The platform admin console is a protected operations area at `/admin` in the same VibePlan Web application. It is for the VibePlan service operator, not for normal organization management.

## Scope and access

The console has five read-oriented views:

| View | Purpose |
| --- | --- |
| Overview | Registered users, organizations, active subscriptions, paid revenue in the last 30 days, and pending orders |
| Users | Search by name or email; inspect registration, last-login, organization count, and platform role |
| Organizations | Inspect owner, plan, member/project use, and expiry, grace, or read-only state |
| Orders | Search and filter subscription/recharge orders by number, organization, user, plan, status, and date |
| Administrators | Inspect platform roles; super administrators can grant and revoke persisted roles |

The console does not make an organization owner, organization administrator, team lead, or team member a platform administrator. Platform authorization is independent of organization authorization.

Every `/admin/*` request requires a signed-in user and server-side platform-role verification. The Web menu is shown only after that verification succeeds, but it is not a security boundary. A direct browser request or API call by an unauthorized user is rejected.

## Bootstrap the first super administrator

Before the first administrator can open `/admin`, add registered VibePlan account email addresses to the server deployment `.env`:

```dotenv
# Comma-separated. These accounts must exist before they sign in.
PLATFORM_ADMIN_EMAILS=owner@example.com,ops@example.com
```

Then restart the API or redeploy the server stack. For the packaged deployment directory:

```bash
./deploy.sh
```

Each matching email is an environment-bootstrap `super_admin`. Matching is evaluated by the API, not by the browser. Use only mailbox addresses controlled by the service operator. Keep at least one recoverable address configured for emergency access.

`PLATFORM_ADMIN_EMAILS` is a server secret: it must be present only in the server `.env` or an equivalent secret manager. Never commit real addresses to Git, expose them as `VITE_*` variables, put them in an image, or add them to client-side configuration.

### Rotate bootstrap access safely

1. Add the new, already-registered operator address to `PLATFORM_ADMIN_EMAILS`.
2. Restart the API or run `./deploy.sh`.
3. Sign in as the new address and verify `/admin` access.
4. Remove the old address only after that verification, then restart/redeploy again.

An email still configured in `PLATFORM_ADMIN_EMAILS` is protected from browser revocation. Removing an address from the environment takes effect only after the API restarts. Database-granted roles are separate from the bootstrap list and do not override an address that remains configured as a super administrator.

## Roles

| Role | Read operations data | Grant or revoke platform roles |
| --- | --- | --- |
| `super_admin` | Yes | Yes, for existing users |
| `operator` | Yes | No |
| Organization role only | No | No |

A super administrator can grant `operator` or `super_admin` to an existing registered user from the Administrators view. The server rejects attempts to revoke an environment-bootstrap administrator or the final effective super administrator. Do not use platform roles as a substitute for organization membership management.

## Orders and payment status

The Orders view contains subscription orders and their payment state. A browser return from Alipay does not prove payment. VibePlan activates a subscription only after the server validates the Alipay asynchronous notification, including the signature and payment details.

Do not use the console to infer or alter payment status. In this release it has no refund, manual-payment confirmation, manual subscription activation, direct price change, direct order editing, invoice, or manual entitlement controls.

## Audit behavior and privacy

The server records an audit event for each platform administrator request that reads sensitive user, organization, or order data, and for every administrator-role change. Audit data identifies the acting administrator, action, target, timestamp, and limited non-sensitive request metadata such as filters and result count.

Audit events must never store or expose password hashes, access or refresh tokens, email-verification codes, Alipay signatures, private keys, or complete payment-notification payloads. Use the console only for legitimate operations needs and limit administrator access to staff who need it.

## Operational boundaries

The console is intentionally an operations viewer with tightly scoped access controls. It does not include:

- refunds or manual payment confirmation;
- manual subscription activation, subscription editing, or price changes;
- deleting users or organization data;
- invoice processing;
- exporting all personal data; or
- a separate `admin` domain or a separate login system.

Changing billing, refund, deletion, or data-export behavior needs a separately designed workflow with stronger approval and financial audit controls.

---

# VibePlan 平台管理后台

平台管理后台是同一个 VibePlan 网页应用中的受保护运营区域，地址为 `/admin`。它服务于 VibePlan 平台运营人员，不是普通组织管理功能。

## 范围与访问

后台包含五个以查询为主的视图：

| 视图 | 用途 |
| --- | --- |
| 概览 | 注册用户、组织、有效订阅、近 30 天已付款金额和待付款订单 |
| 用户 | 按姓名或邮箱查询；查看注册时间、最后登录、组织数和平台角色 |
| 组织 | 查看所有者、套餐、成员/项目用量，以及到期、宽限或只读状态 |
| 充值记录 | 按订单号、组织、购买人、套餐、状态和日期查询订阅订单 |
| 管理员 | 查看平台角色；超级管理员可授予或撤销持久化角色 |

组织所有者、组织管理员、团队负责人和团队成员不会因此获得平台管理员权限。平台权限与组织权限相互独立。

每个 `/admin/*` 请求都要求先登录，并由服务端验证平台角色。网页菜单只是在验证成功后显示，不是安全边界；未授权用户直接访问地址或调用 API 均会被拒绝。

## 引导首个超级管理员

首个管理员打开 `/admin` 前，在服务器部署目录的 `.env` 中填写已注册 VibePlan 账号的邮箱：

```dotenv
# 使用英文逗号分隔；这些邮箱必须已经注册。
PLATFORM_ADMIN_EMAILS=owner@example.com,ops@example.com
```

随后重启 API 或重新部署服务器。使用部署目录时可运行：

```bash
./deploy.sh
```

每个匹配的邮箱都是通过环境变量引导的 `super_admin`。匹配由 API 在服务端完成，浏览器不会保存或决定权限。请仅填写平台运营方可控制的邮箱，并始终保留至少一个可恢复访问的邮箱。

`PLATFORM_ADMIN_EMAILS` 是服务器机密：只能保存在服务器 `.env` 或等价的密钥管理系统。不要将真实邮箱提交到 Git、设置为 `VITE_*` 变量、写入镜像或发到客户端配置中。

### 安全轮换引导权限

1. 将新的、已注册的运营邮箱加入 `PLATFORM_ADMIN_EMAILS`。
2. 重启 API 或运行 `./deploy.sh`。
3. 使用新邮箱登录，确认可以访问 `/admin`。
4. 确认后才移除旧邮箱，再次重启或重新部署。

仍在 `PLATFORM_ADMIN_EMAILS` 中的邮箱不能在网页内撤销。移除邮箱需要 API 重启后才会生效。数据库中授予的角色与引导列表独立，但不能覆盖仍被环境变量指定为超级管理员的邮箱。

## 角色

| 角色 | 查看运营数据 | 授予或撤销平台角色 |
| --- | --- | --- |
| `super_admin` | 可以 | 可以，仅限已注册用户 |
| `operator` | 可以 | 不可以 |
| 仅有组织角色 | 不可以 | 不可以 |

超级管理员可在“管理员”视图中向已注册用户授予 `operator` 或 `super_admin`。服务端会拒绝撤销环境变量引导的管理员，也会阻止撤销最后一个有效超级管理员。平台角色不能替代组织成员和权限管理。

## 订单与支付状态

充值记录显示订阅订单及其支付状态。支付宝的浏览器回跳不代表支付成功；只有服务端验签并校验付款信息后的支付宝异步通知，才能激活订阅。

不要通过后台推断或更改支付状态。本版本不提供退款、人工确认付款、人工开通订阅、直接修改价格、直接编辑订单、发票或人工权益调整。

## 审计与隐私

服务端会记录每次平台管理员读取敏感用户、组织或订单数据的请求，以及每次管理员角色变更。审计记录包括操作管理员、动作、对象、时间和有限的非敏感请求元数据，例如筛选条件和结果数量。

审计记录绝不保存或展示密码哈希、access/refresh token、邮箱验证码、支付宝签名、私钥或完整支付通知载荷。仅向确有运营需要的人员授予平台后台权限。

## 运营边界

该后台刻意限定为带严格权限控制的运营查询界面，不包含：

- 退款或人工确认付款；
- 人工开通、编辑订阅或修改价格；
- 删除用户或组织数据；
- 发票处理；
- 导出全部个人资料；
- 独立的 `admin` 域名或登录系统。

账务、退款、删除或数据导出若需上线，应单独设计流程，并增加更严格的审批和财务审计控制。
