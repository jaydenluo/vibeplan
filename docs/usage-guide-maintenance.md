# 使用教程维护

- 唯一正文来源：仓库根目录 `user-guide.md`。`/guide` 使用 Vite 原文导入，开发保存后热更新；生产需要重新执行 Web 构建并发布。
- 配图：`apps/web/public/guide/images/`；文内使用 `![有意义的说明](/guide/images/name.png)`。网页会为此路径补上 Vite `base`，部署到子目录时也能访问。
- 标题：一个一级标题，二、三级标题自动进入目录。标题中的中文和行内代码会保留为目录文本；重复标题自动加后缀。修改标题会改变对应章节地址。
- 代码：使用 fenced code，可标注 bash、json、js 等常见语言。未知或未标注的语言显示普通代码，保留复制按钮；复制受浏览器权限限制时可手动选择。
- 链接：现有 LICENSE、task-execution、billing 和 admin-console 文件随构建打包，点击可访问对应文件；其他相对文档链接转到项目 GitHub 文件地址。新增需离线可用的文档，在 `usage-guide/markdown.ts` 显式添加资源导入映射。
- 安全：不支持执行 Markdown 中的原始 HTML；禁止 javascript、data 等危险协议。图片建议用仓库静态资源，勿包含账号或客户数据。
- 流程图是示意图；添加产品截图时使用无敏感数据的演示账号，并随界面更新。

验证：`pnpm exec vitest run apps/web/src/workspace/usage-guide --exclude '.worktrees/**'`，`pnpm --filter @vibeplan/web build`。再打开 `/guide` 检查桌面/手机、目录、图片和复制。
