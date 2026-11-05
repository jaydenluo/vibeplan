# Markdown 使用教程执行计划

任务：88c7dbaa-c814-4a08-b581-79fd2a671c76
Git 基线：7ea0d949ab5922ee35d09aedb2ec0a3e04e89caa
来源：用户已确认 docs/superpowers/specs/2026-11-04-usage-tutorial-design.md，并授权开始实现。

## 范围与决策

复用根目录 user-guide.md，增加 /guide 阅读页及待办审批后的菜单入口。仓库文件直接编辑；开发热更新，线上重新构建发布。无需网页编辑、上传接口或数据库变更。保留工作区中原有修改，不自动提交或发布。

沿用现有蓝灰色：正文 #20252b，标题 #244454，主色 #2f657d，背景 #f3f5f7，边框 #d8e0e5。正文采用现有系统字体，命令使用等宽字体。布局为阅读正文与细竖线章节导航；只在命令块使用深蓝底，强调实际操作。独立 CSS 避免覆盖用户修改的全局样式。

## 实施步骤

1. 先增加阅读与导航测试，观察缺失功能失败。
2. 添加 react-markdown、remark-gfm、rehype-highlight；同一 AST 流程生成唯一中文锚点和目录；限制 HTML 与协议。代码块支持标签、复制、回退；图片与仓库文档链接正确解析。
3. 接入惰性加载页面及失败重试，目录点击、滚动高亮、hash 定位；桌面右侧导航，窄屏折叠。
4. 补充 user-guide.md 的快速上手与维护说明、无隐私的流程示意图（明确标注示意而非截图）。已有截图含项目数据，不直接公开复用。
5. 运行 Web 测试、全项目类型检查与构建、vibeplan check；浏览器检查桌面、手机、直接路由与生产资源。
6. 更新计划和进度，提交真实报告，保持 in_review 等待人工验收。

## 文件与依赖

- WorkspacePage.tsx：菜单和路由。
- UsageGuidePage.tsx、usage-guide/：Markdown 渲染、目录逻辑、样式和测试。
- 独立导航集成测试：无组织可访问、前进后退。
- apps/web/package.json、pnpm-lock.yaml：Markdown 依赖。
- user-guide.md、apps/web/public/guide/images/：唯一正文与配图；docs/usage-guide-maintenance.md：维护约定。

## 验收映射与验证

1–2：导航集成测试和浏览器直达/刷新/前进后退。3：原文导入与维护说明。4：GFM 和图片测试、生产资源 HTTP 检查。5：中文/重复/行内代码标题与 hash、滚动测试。6：高亮/复制/未知语言测试。7：安全协议/HTML 测试与手机无整页溢出检查。8：pnpm exec vitest run apps/web/src --exclude '.worktrees/**'；pnpm lint；pnpm build；vibeplan check。

## 风险与当前状态

工作区有其他任务的未提交修改，严格限定本任务文件；user-guide.md 只追加/局部补充，保留原内容。目录和标题必须来自同一 AST，避免不一致。代码与表格局部滚动。当前：已完成方案和仓库检查，下一步测试与实现；无阻塞。
