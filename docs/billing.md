# VibePlan 订阅与支付宝支付

## 套餐

| 套餐 | 年费 | 成员上限 | 项目额度 |
| --- | ---: | ---: | --- |
| 个人免费 | ¥0 | 所有者本人 | 同一所有者全部免费组织合计 10 个 |
| 团队 10 人 | ¥480 | 10 | 不限 |
| 团队 30 人 | ¥1,280 | 30 | 不限 |
| 团队 100 人 | ¥3,680 | 100 | 不限 |
| 企业协作 | ¥8,800 | 1,000 | 不限 |
| 定制企业 | 联系我们 | 超过 1,000 | 合同约定 |

订阅按组织购买。同一个成员加入一个组织的多个团队时只计一个成员席位；付费权益不会转移到该账号的其他组织。

免费组织可以创建团队和项目，但组织成员只能是所有者。免费项目额度按同一个所有者旗下的所有免费组织合并计算。免费组织不能发送、接受或审批成员邀请和加入请求。

## 年度续费、宽限期与降级

- 所有套餐均为用户主动按年付款，VibePlan 不自动扣款或自动续费。
- 到期后有 7 天宽限期，宽限期内原有付费权益继续有效。
- 宽限期结束后组织变为只读。数据保留且已授权成员仍可查看，但不能新建、编辑或删除项目和任务，也不能邀请、添加、移除或调整成员。
- 支付成功后写入权限会立即恢复。
- 降级会保存为下一次续费的套餐选择，不会自动扣款或自动开通新周期。当前付费周期结束后，组织照常进入宽限期和只读；所有者主动按降级后的套餐付款后才恢复写入。若续费后成员数高于新套餐上限，现有成员不会被删除，但邀请和写入会暂停，直至人数回到额度内或升级套餐。
- 升级立即生效。系统按当前周期未使用的旧套餐价值抵扣新套餐年度价，支付后开始一个新的完整年度；抵扣不能兑换现金或跨组织使用。

第一版不提供发票，只保留组织、购买套餐、金额、订单号、支付宝交易号、付款时间和订阅有效期，供组织所有者查看。

## 服务器支付宝配置

在服务器部署目录中复制环境示例：

```bash
cp .env.example .env
chmod 600 .env
```

在服务器 `.env` 写入支付宝生产应用配置：

```dotenv
BILLING_PROVIDER=alipay
ALIPAY_APP_ID=你的支付宝应用AppId
ALIPAY_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
ALIPAY_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_SELLER_ID=你的支付宝卖家ID
ALIPAY_NOTIFY_URL=https://vibeplan.szxinjin.cn/api/billing/alipay/notify
ALIPAY_RETURN_URL=https://vibeplan.szxinjin.cn/organizations/ORGANIZATION_ID/billing/return
```

`ALIPAY_PRIVATE_KEY` 是商户应用私钥；`ALIPAY_PUBLIC_KEY` 是支付宝公钥，不是商户公钥。若密钥以多行 PEM 形式保存，使用双引号和 `\n`，或在部署系统支持的 secret 管理界面将其作为多行机密变量写入。

这些值不得提交到 Git、写进 Dockerfile、写进浏览器环境变量或通过聊天发送。仅将 `.env.example` 中的字段名提交到仓库。

## 回调与 Traefik

支付宝异步通知地址必须能从公网以 HTTPS 访问：

```text
https://vibeplan.szxinjin.cn/api/billing/alipay/notify
```

现有 Traefik 应将整个 `vibeplan.szxinjin.cn` 域名流量转发给 Web Nginx；Web Nginx 会将 `/api/*` 反向代理给 API 容器。回调无需登录，但服务端会校验 RSA2 签名、`app_id`、卖家 ID、订单号、金额和交易状态。浏览器回跳页不代表付款成功，页面会查询服务端订单状态，等待异步通知确认。

发布前先在支付宝沙箱验证：创建订单、付款、回调、重复回调、金额不匹配和签名不匹配。真实生产环境确认无误后才设置 `BILLING_PROVIDER=alipay`。

## 本地开发

本地使用：

```dotenv
BILLING_PROVIDER=manual
```

模拟支付只能用于本地和自动化测试。生产 API 拒绝在 `manual` 模式下确认付款。不要用模拟支付给真实组织开通套餐。

## 故障排查

- `PAYMENT_CONFIGURATION_INVALID`：检查所有 `ALIPAY_*` 配置，重启 API 后再建订单。
- 页面一直显示“等待付款确认”：确认 `notify_url` 可从公网访问，查看 API 日志中的验签错误，并在支付宝平台检查通知记录。
- `PAYMENT_VERIFICATION_FAILED`：通常是支付宝公钥、AppId、卖家 ID、金额或回调地址配错；不要通过关闭验签绕过。
- `subscription_read_only`：组织已超过 7 天宽限期或降级后成员超额；续费、升级或减少组织成员后恢复。
- `free_project_limit_reached`：同一所有者在免费组织内已合计达到 10 个项目；升级其中一个组织即可解除该组织的项目上限。
