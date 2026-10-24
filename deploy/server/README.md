# Vibe Plan 服务器部署包

这个目录可以整体上传到服务器。服务器只需要安装 Docker Engine 和 Docker Compose Plugin，不需要 Node.js、pnpm 或源码。

默认访问域名是 `https://vibeplan.szxinjin.cn`。请先在腾讯云 DNS 中添加 `A` 记录，将 `vibeplan.szxinjin.cn` 指向服务器公网 IP。服务器上的 Traefik 必须已经连接外部 Docker 网络 `traefik-public`，并使用你提供的 `myresolver` 证书解析器。

本项目推荐 Web 和 API 使用同一个域名：浏览器访问 `/`，Web Nginx 将 `/api/*` 转发到 API 容器。这样只需要一个证书、没有跨域 Cookie 问题，CLI 也统一使用 `https://vibeplan.szxinjin.cn`。不建议当前阶段拆成 `api.vibe.szxinjin.cn`，除非后续需要独立扩缩容或由独立网关管理 API。

服务器部署包中的 `data/postgres/` 是运行时数据目录。`scripts/package-server-deploy.sh` 会自动排除该目录和服务器 `.env`，因此上传新部署包不会覆盖现有数据库。

## 首次部署

```bash
cp .env.example .env
vi .env
chmod +x deploy.sh
./deploy.sh
```

`VIBE_PLAN_VERSION` 必须对应镜像仓库中已经推送的版本，例如 `0.1.0`。浏览器通过 Traefik 访问 `https://vibeplan.szxinjin.cn`，Web 容器不再直接绑定服务器端口。

API 容器首次启动会自动执行数据库迁移。PostgreSQL 数据保存在部署目录的 `data/postgres/` 中，例如 `deploy/server/data/postgres/`；更新镜像或重新创建容器时不会丢失任务数据。该目录不应提交到 Git，也不要在重新部署时删除。

注册邮箱验证默认开启。修改服务器 `.env` 中的 `EMAIL_VERIFICATION_REQUIRED`：设置为 `true` 时，用户先获取并填写邮箱验证码再完成注册；设置为 `false` 时，填写姓名、邮箱和密码即可直接注册。修改后执行 `./deploy.sh` 重启 API 容器。

## 订阅与支付宝支付

组织订阅的生产收款默认使用支付宝。部署前在服务器 `.env` 填写 `ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`ALIPAY_PUBLIC_KEY`、`ALIPAY_SELLER_ID`，并保持：

```dotenv
BILLING_PROVIDER=alipay
ALIPAY_NOTIFY_URL=https://vibeplan.szxinjin.cn/api/billing/alipay/notify
ALIPAY_RETURN_URL=https://vibeplan.szxinjin.cn/organizations/ORGANIZATION_ID/billing/return
```

私钥和支付宝公钥只保存在服务器 `.env`，不能写入镜像、源码或浏览器配置。Traefik 将 `vibeplan.szxinjin.cn` 转到 Web Nginx，Nginx 再将 `/api/*` 转发到 API；因此支付宝异步通知地址无需额外配置第二个 API 域名。付款成功只以 API 对支付宝异步通知的签名与金额校验结果为准。首次上线请先通过支付宝沙箱完成下单、回调、重复回调和验签失败验证，再切换生产应用参数并执行 `./deploy.sh`。

如果服务器之前使用旧版 Docker volume，第一次运行新版 `./deploy.sh` 时会自动停止当前服务，将旧 volume 复制到 `data/postgres/`，并保留旧 volume 作为备份。迁移完成后，数据库以部署目录下的文件为准。

## 更新版本

推荐明确指定要部署的版本。脚本会先拉取镜像，然后重建有变化的服务：

```bash
./deploy.sh 0.1.1
```

如果要拉取并运行最新镜像：

```bash
./deploy.sh latest
```

不带参数时，脚本使用 `.env` 中的 `VIBE_PLAN_VERSION`。因此也可以直接修改 `.env` 后运行 `./deploy.sh`。

## `./deploy.sh` 做了什么

1. 进入部署文件所在目录并检查 Docker、`.env`。
2. 检查并创建 Traefik 使用的外部网络 `traefik-public`。
3. 根据参数或 `.env` 中的 `VIBE_PLAN_VERSION` 确定 API 和 Web 镜像版本。
4. 执行 `docker compose pull` 拉取指定版本镜像。
5. 执行 `docker compose up -d --remove-orphans`，后台启动或重建数据库、API、Web 容器。
6. 等待数据库健康检查通过；API 容器启动时自动执行数据库迁移。
7. 等待 API 健康检查通过后启动 Web 容器，并由 Traefik 自动发现域名 labels。
8. 执行 `docker compose ps` 输出当前容器状态。

部署 Compose 使用 `127.0.0.1:4000/health` 做 API 健康检查，避免 Alpine 将 `localhost` 优先解析为 IPv6；Web 服务通过 Compose `links` 固定解析到本项目的 API 容器，避免 Traefik 外部网络中存在同名 `api` 容器时产生 502。

该脚本不会删除 PostgreSQL 数据目录或旧 volume，也不会清空组织、项目或任务数据。

## 回滚

镜像按版本保留，应用镜像可以指定旧版本启动：

```bash
./deploy.sh 0.1.0
```

数据库迁移不会随镜像回滚自动撤销。本轮仅增加表和字段，旧应用可以忽略新字段；回滚旧 API 会失去幂等、增量同步和结构化报告能力，新 CLI 会提示兼容限制。升级前备份数据库，先在测试环境验证目标版本，避免让旧服务处理需要新能力的报告。

更新完成后，在本地源码目录执行只读部署检查：

```bash
scripts/verify-release.sh VERSION https://vibeplan.szxinjin.cn/api
```

它核对 `/health`、`/version` 的版本与构建提交。业务验证使用独立测试环境的 `pnpm test:e2e`，不会向真实项目创建测试任务。

## 查看日志和停止

```bash
docker compose logs -f api
docker compose ps
docker compose down
```

不要删除 `data/postgres/`，除非确认要删除所有组织、项目和任务数据。数据库运行时使用一致的逻辑备份：

```bash
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > vibe-plan-backup.dump
```

## Upgrade verification and rollback (English)

Run `./deploy.sh VERSION` to pull and recreate the selected application images while retaining database data. From the source checkout, run `scripts/verify-release.sh VERSION https://vibeplan.szxinjin.cn/api` to verify health, version and build commit. Business E2E tests use a dedicated local test database and accounts.

Application rollback does not reverse database migrations. This release adds tables and columns; older applications ignore them but lack idempotency, incremental sync and structured report protection. Back up with the `pg_dump` command above before upgrading, verify the target release in staging, and do not submit reports requiring new capabilities to an older server. Keep the backup and newer image tags until business verification succeeds.

## Traefik 前置检查

Traefik 与本项目必须使用同一个外部网络：

```bash
docker network inspect traefik-public
```

如果不存在，可以手动创建：

```bash
docker network create traefik-public
```

Traefik 已配置的 `myresolver` 会为 `vibeplan.szxinjin.cn` 自动申请证书。请确认腾讯 DNS 的 Secret ID/Key 已配置在 Traefik 容器中，并且服务器 80、443 端口已放行。
