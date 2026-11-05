# 总览 Tabs 与滚动隔离实施记录

用户已明确要求并授权：工作台与今日工作改为两个 Tab；右侧任何内容滚动不得带动左侧导航。

根因：workspace-layout 及 sidebar 只有 min-height:100vh；workspace-page 内容撑高整个文档，因此窗口滚动连带移动侧栏。教程已有独立 article 滚动，本次保留其现有实现和其他未提交修改。

## 决策

- 整体 shell 固定 100dvh，禁止其溢出；侧栏占满可用高度，主内容 flex:1/min-height:0/overflow:auto，右侧独立滚动。侧栏自身超长时仅菜单列表滚动，品牌、个人菜单和展开按钮保留。
- 手机保持上方导航、下方内容的结构，两者同样独立；主内容高度随动态视口变化。
- overview 增加工作台/今日工作两个可访问 Tab，同一时刻只展示一个面板；两个面板保持挂载，切换保留今日工作的分类和展开状态。
- 当前 Tab 写入 /overview?tab=today，支持刷新、前进后退；默认工作台。页内切换重置右侧滚动位置；侧栏导航切换页面同样重置右侧滚动。
- 保持教程正文、大纲、代码和任务看板内部滚动；不改 API/数据库，不将此展示需求混入教程云端任务。

## 清单

- [x] 先写总览 Tab 的真实组件集成测试，确认旧实现失败。
- [x] 添加 OverviewTabs 组件及局部样式，接入 WorkspacePage。
- [x] 修正全局 shell、侧栏、移动端尺寸与溢出规则；移除今日工作独立面板的顶部多余分隔。
- [x] 浏览器真实滚轮验证左右隔离、Tab切换、菜单弹层、教程及任务看板，在桌面和手机检查；执行 Web 测试、类型检查和构建。

验证使用虚构演示数据；保留既有 styles.test.ts 字符串断言失败，不修改无关任务目录样式。完成后记录真实结果，不自动提交或发布。

## 交付与验证结果

实现已完成，等待用户页面验收。本需求未绑定云端任务，未变更其他任务状态。

涉及文件：
- apps/web/src/workspace/OverviewTabs.tsx：总览 Tab、URL、键盘切换和面板状态保留。
- apps/web/src/workspace/OverviewTabs.css：顶部吸附 Tab 与局部间距。
- apps/web/src/workspace/OverviewTabs.test.tsx：真实 WorkspacePage 集成测试，覆盖切换、历史记录、键盘及面板关联。
- apps/web/src/workspace/WorkspacePage.tsx：接入 Tab 与主内容滚动位置重置；保留既有教程等未提交修改。
- apps/web/src/styles.css：视口高度 shell、主内容独立滚动、侧栏菜单局部滚动、移动端上下布局与任务看板高度约束。额外验证发现 360px 高度下个人菜单底部被 shell 裁切，已限定弹层最大高度并允许其自身滚动，复测通过。

实际检查：
- RED：新增总览 Tab 集成测试在旧代码上 3 项失败，缺少 Tab。
- 最终相关回归：`pnpm exec vitest run apps/web/src/workspace/OverviewTabs.test.tsx apps/web/src/workspace/TodayWork.test.tsx apps/web/src/workspace/usage-guide apps/web/src/workspace/ProfileMenu.test.tsx apps/web/src/workspace/WorkItemBoard.test.tsx --exclude '.worktrees/**'`：33 项通过，exit 0。
- 完整 Web：`pnpm exec vitest run apps/web/src --exclude '.worktrees/**'`：159 项通过、1 项既有失败，exit 1。失败是 styles.test.ts:35 精确匹配 task-tree-copy 字符串；原有 container-type 修改导致断言不匹配，与本次改动无关。未将完整套件标记为通过。
- `pnpm --filter @vibeplan/web exec tsc --noEmit`：exit 0。
- 最终 `pnpm --filter @vibeplan/web build`：exit 0。
- `vibeplan check`：exit 0。
- `git diff --check`：exit 0。
- Chromium 实际滚轮（虚构 30 个项目与 30 个任务）：工作台右侧滚动 1400px、今日工作滚动 1269px，window.scrollY 均为 0，侧栏顶部保持 0。
- Chromium 1440/375/320px：项目列表主内容、教程正文与大纲跳转、任务看板列滚动正常，文档宽高保持在视口内；个人菜单与资料弹窗可操作，无 pageerror。
- Chromium 1440×360：侧栏列表可局部滚动，底部展开/收起按钮仍可见；个人菜单高度 190px，底部位于 341px，未被裁切。
- 临时验证脚本：/tmp/verify-workspace-scroll-short-menu.mjs；桌面/窄屏截图 /tmp/vibeplan-tabs-1440.png、/tmp/vibeplan-tabs-375.png，已目视检查。

剩余问题：上述既有样式字符串测试失败。本次未提交、推送或发布。用户可在 http://localhost:5173/overview 验收。
