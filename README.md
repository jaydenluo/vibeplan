# Vibe Plan

Vibe Plan is a self-hosted collaboration layer for AI-assisted development. The server stores organization-scoped project plans and realtime task events; developers keep source code in Git and use coding agents locally through the `vibeplan` CLI.

## Local development

Requirements: Node.js 22, pnpm 11, and PostgreSQL. Docker Compose provides PostgreSQL:

```bash
./start.sh
```

The API runs on `http://localhost:4000` and the web app on `http://localhost:5173`.
The script stops any existing development processes on ports `5173` and `4000`, installs dependencies when needed, creates `.env` from `.env.example`, starts the local PostgreSQL container, runs migrations, and then restarts both Web and API services.

## Organization workflow

After signing in, use the **团队** navigation to view teams. The avatar menu in the upper-left provides personal profile editing, organization switching, and organization creation. Organization, team, and project forms do not require internal identifiers; the server generates those values. A project can be created without a Git URL, but code synchronization and repository analysis remain unavailable until one is configured. Invited users can accept or reject invitations from **待处理审批**. A user can also request access to a team; organization administrators and team leads review those requests in the same page. The current development mailer logs verification and invitation tokens to the API console; configure SMTP before production use.

## CLI workflow

面向最终用户的完整安装和使用教程见 [docs/user-guide.md](docs/user-guide.md)。npm 用户安装 `@vibeplan/cli` 后，也可以直接查看 npm 页面中的同一份 CLI 使用说明。

```bash
pnpm --filter @vibeplan/cli build
node apps/cli/dist/index.js login
node apps/cli/dist/index.js init --project-id PROJECT_ID
node apps/cli/dist/index.js task:list
node apps/cli/dist/index.js check
```

查看已安装的 CLI 版本：

```bash
vibeplan --version
```

The CLI stores session tokens in the operating-system Keychain. Project context is written to `.vibe/project.yaml`; access tokens are never stored in the repository. Device codes expire after 10 minutes and are single-use. Access tokens last 30 minutes and refresh automatically into a new 30-day refresh window while the CLI or browser is used; after 30 days without use, logout, revocation, or a server-side session reset, run `vibeplan login` again.

After `vibeplan init`, install the Codex project workflow once with `node apps/cli/dist/index.js install-codex`. After upgrading the CLI, run `node apps/cli/dist/index.js install-codex --force` and restart Codex to apply the latest Vibe Plan Skill; this only replaces the Vibe Plan Skill, not project files. In a Codex conversation, say “把上面的任务加入 Vibe Plan”; Codex directly drafts standard task fields and an editable estimate, then shows a confirmation summary before it runs `vibeplan task:create`. With no schedule, the task is created without a due date; on first start, its end date is calculated from that day and the estimate. To execute a task, provide its ID; Codex reads it with `vibeplan task:show`, asks before starting, and reports changed files and tests when finished. Run `vibeplan start` in the project directory to keep `.vibe/tasks` mirrors and offline updates synchronized; in an interactive terminal, it offers login and continues automatically after approval, then shows live logs. Ctrl-C leaves the log view but keeps synchronization running. Reopen it with `vibeplan logs --follow`, or use `vibeplan logs` for recent output. Use `vibeplan status` and `vibeplan stop` to manage the daemon. Use `vibeplan daemon --foreground` only when you need foreground debugging. The daemon never executes code remotely.

Task execution uses an explicit review loop: `task:report` moves a task to `in_review`, and only `task:accept --decision approved` can move it to `done`. Version numbers are required for every state change; conflicts remain in `.vibe/outbox` for retry and are logged in `.vibe/daemon.log`.

Claude Code 用户在绑定的项目根目录运行 `vibeplan install-claude`，安装项目级 `CLAUDE.md` 规则，然后重启 Claude Code。该命令只更新 `VIBE PLAN CLAUDE MANAGED START/END` 区块；已有自定义内容会保留。没有托管区块的旧 `CLAUDE.md` 默认不覆盖，确认迁移时使用 `vibeplan install-claude --force`，命令会先创建备份。

## Testing

```bash
pnpm lint
DATABASE_URL=postgres://USER@localhost:PORT/vibe_plan_test pnpm test
pnpm build
```

For production, configure `POSTGRES_PASSWORD`, `AUTH_ACCESS_SECRET`, SMTP variables, and the required `ALIPAY_*` billing variables, then run `docker compose -f docker-compose.prod.yml up -d --build`. The production web container serves the SPA and proxies `/api/*` to the API container; migrations run automatically when the API container starts. The current mailer remains console-based during development, so production SMTP delivery still requires replacing `ConsoleMailer` with an SMTP provider.

## Organization subscriptions and billing

VibePlan subscriptions are purchased per organization. Free use permits the owner alone and up to 10 projects across that owner's free organizations; paid organizations have unlimited projects and a plan-specific member limit. Payments are annual, initiated by the owner, and never renew automatically. An expired subscription has a seven-day grace period, followed by read-only access until renewed. No organization data is deleted.

Production uses Alipay Web Pay. Set `BILLING_PROVIDER=alipay` and configure `ALIPAY_APP_ID`, `ALIPAY_PRIVATE_KEY`, `ALIPAY_PUBLIC_KEY`, `ALIPAY_GATEWAY`, `ALIPAY_SELLER_ID`, `ALIPAY_NOTIFY_URL`, and `ALIPAY_RETURN_URL` in the server `.env`. The asynchronous callback must be publicly reachable at `https://vibeplan.szxinjin.cn/api/billing/alipay/notify`; payment success is activated only after server-side signature and amount verification. Never commit or send the private key. Local development uses `BILLING_PROVIDER=manual` and the organization billing page's test-payment confirmation. See [docs/billing.md](docs/billing.md) for the full setup, plans, grace-period rules, and Alipay troubleshooting.

## Platform administration

The same Web application provides a separate `/admin` operations route for platform administrators. It is not an organization-management permission: an organization owner, administrator, or team lead does not receive platform access. Platform authorization is enforced on every `/admin/*` API request; hiding the menu is only a convenience and cannot grant access.

Bootstrap the first platform super administrator on the server by setting one or more registered-account email addresses in the deployment `.env`, then restart the API deployment:

```dotenv
# Comma-separated registered account email addresses. Keep at least one
# recoverable address here for emergency platform access.
PLATFORM_ADMIN_EMAILS=owner@example.com,ops@example.com
```

An address in `PLATFORM_ADMIN_EMAILS` is always a protected `super_admin` while it remains configured. In `/admin`, a super administrator can grant or revoke database-backed `operator` and `super_admin` access for existing users; an operator can only view operations data. Changing the environment list requires an API/container restart and should be treated as a privileged credential change. Do not place this value in browser variables or source control.

The first release provides read-only views for platform overview, users, organizations, subscription orders, and platform administrators. It records administrator data access and administrator-role changes in a server-side audit log. It deliberately does not provide refunds, manual payment confirmation, direct subscription/price changes, user deletion, invoice processing, or personal-data bulk export. See [docs/admin-console.md](docs/admin-console.md) for the permission model, deployment procedure, audit scope, and operational boundaries.

注册邮箱验证由 `EMAIL_VERIFICATION_REQUIRED` 控制，默认值为 `true`。开启时，注册页先发送 6 位验证码，验证码通过后才创建账号；关闭时设置 `EMAIL_VERIFICATION_REQUIRED=false`，填写姓名、邮箱和密码即可直接注册，账号会自动标记为已验证。验证码有效期为 10 分钟且只能使用一次。

登录会话默认采用 30 天滑动有效期：access token 默认 30 分钟，浏览器会在过期后自动使用 refresh token 刷新；每次成功刷新都会重新获得 30 天。通过 `AUTH_REFRESH_TOKEN_TTL=30d` 配置 refresh 窗口，用户连续使用时不需要反复登录；连续 30 天未使用才需要重新登录。


# 重要的事：
- 发布镜像，服务器更新。
- 发布npm,用户更新，并安装skills.
## 镜像部署

镜像构建脚本按腾讯 CCR 的配置方式读取 `scripts/tencent-credentials.env`：

```bash
cp scripts/tencent-credentials.env.example scripts/tencent-credentials.env
# 填写 TENCENT_CCR_USERNAME 和 TENCENT_CCR_PASSWORD
scripts/build-and-push-tencent.sh 0.1.6
```

脚本会推送 `vibe-plan-api:0.1.0`、`vibe-plan-web:0.1.0` 以及对应的 `latest` 标签。服务器部署文件集中在 `deploy/server/`，可直接上传整个目录；服务器执行 `cp .env.example .env`、填写镜像版本和密钥后运行 `./deploy.sh`。如需打包上传目录，可执行 `scripts/package-server-deploy.sh`，它不会把服务器 `.env` 凭据打入压缩包。

## npm CLI 发布 (只要是发布NPM,用户才能更新)

用户安装的是 CLI，不需要安装 API 或 Web 的 npm 包。CLI 依赖的 `@vibeplan/templates` 会由发布脚本先行发布：

```bash
cp scripts/tencent-credentials.env.example scripts/tencent-credentials.env
# 在 scripts/tencent-credentials.env 中填写 NPM_TOKEN (会过期，过期之后，去官方，再拿一下。)
scripts/publish-npm.sh 0.1.9
npm install --global @vibeplan/cli@latest
```

也可以让发布脚本先启动用户名密码登录（会交互式询问用户名、密码、邮箱和验证码）：

```bash
scripts/publish-npm.sh 0.1.0 --login
```

脚本不会读取、打印或保存密码；npm 登录成功后会由 npm 自己管理凭据。启用了 npm 2FA 时，还需要输入一次性验证码。不要在脚本参数中直接写密码。

如果 npm 提示 `This operation requires a one-time password`，使用认证器当前的 6 位验证码重新发布：

```bash
scripts/publish-npm.sh 0.1.0 --otp 123456
```

也可以用隐藏输入设置环境变量，避免把验证码明文写入 shell 历史：

```bash
read -r -s NPM_OTP; export NPM_OTP; scripts/publish-npm.sh 0.1.0
```

验证码只对当前时间窗口有效，两个包连续发布时可能需要重新执行命令并填写新验证码。

如果使用私有 npm Registry，可传入 `--registry` 或设置 `NPM_REGISTRY`。发布脚本会统一两个包的版本、执行完整构建，然后按 `@vibeplan/templates`、`@vibeplan/cli` 的顺序发布。版本号会写回两个 `package.json`，请在发布后提交版本变更。

### npm Token 配置

获取 token：登录 [npmjs.com](https://www.npmjs.com/)，打开头像菜单的 **Access Tokens**，选择 **Generate New Token**。推荐使用 Granular Access Token，只授予本项目两个包的发布权限；自动化发布可使用 Automation Token。token 只显示一次，请立即保存。

本地发布默认读取 `scripts/tencent-credentials.env` 中的 token。真实文件已被 Git 忽略，不能提交到仓库。

设置 token 后，发布脚本会先执行 `npm whoami` 验证 token。token 无效、撤销或过期会在构建前直接停止，并提示更新配置。验证通过后会生成权限为 600 的临时 `.npmrc`，发布结束自动删除。token 不会写入项目目录、`package.json` 或镜像。私有 Registry 可在同一文件设置 `NPM_REGISTRY`，或使用 `--registry <url>`。

也可以用环境变量临时覆盖配置文件：

```bash
NPM_TOKEN=npm_xxxxxxxxxxxxxxxxx scripts/publish-npm.sh 0.1.0
```

如果不使用 token，才使用交互登录（推荐个人电脑）：

   ```bash
   scripts/publish-npm.sh 0.1.0 --login
   ```

不要把 token 提交到 Git、`.env`、Dockerfile 或聊天记录。如果 token 泄露，请在 npm 的 Access Tokens 页面立即撤销并重新生成。

### npm token setup (English)

Sign in at [npmjs.com](https://www.npmjs.com/), open your avatar menu, choose **Access Tokens**, then **Generate New Token**. Prefer a Granular Access Token scoped to the two packages with publish permission. Use an Automation Token for CI/CD. Save the token immediately because it is shown only once.

For local publishing, copy `scripts/tencent-credentials.env.example` to `scripts/tencent-credentials.env` and set `NPM_TOKEN`. The script runs `npm whoami` before building, so an expired, revoked, or invalid token stops the release immediately. It then uses a temporary mode-600 npm config and removes it on exit. For CI/CD, provide `NPM_TOKEN` as a secret. Never commit the token to Git, `.env`, `package.json`, a Docker image, or a shell script. Revoke and rotate it immediately if exposed.

镜像和 npm 一起发布时，显式使用：

```bash
scripts/build-and-push-tencent.sh 0.1.0 --publish-npm
```

默认镜像脚本不会发布 npm，避免仅构建镜像时意外创建公开 npm 版本。使用 `--publish-npm` 时会自动读取并验证 `scripts/tencent-credentials.env` 中的 `NPM_TOKEN`。

如果发布 `@vibeplan/templates` 时出现 `404 Not Found - PUT .../@vibeplan%2ftemplates`，这通常不是 token 过期，而是当前账号没有 `@vibeplan` scope 的发布权，或 `vibeplan` npm 组织尚未创建。请在 npm 网站确认已创建名为 `vibeplan` 的组织、发布账号已加入，并且 token 已授权该组织。
