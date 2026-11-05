# 项目详情任务加载状态

状态：实现与验证完成，等待用户页面验收。用户明确授权修复项目详情中任务目录、甘特图两处初始空提示；未绑定或修改云端任务。

## 需求与决定

- 两个区域首次获取任务时显示旋转圆环，下方一行“加载中…”，各自在所在区域水平居中。
- 成功返回空数组后才显示既有空提示；失败显示“任务加载失败，请重试。”及重试按钮。
- 保留路由指定的项目 ID，即使项目列表元数据尚未返回。请求按项目和 generation 隔离；旧项目响应不得结束当前项目加载。卸载后使旧请求失效。
- 后台刷新保留已加载任务及甘特图实例，避免闪屏及丢失选择/缩放状态。尊重减少动画的系统设置。

## 文件

- apps/web/src/workspace/ProjectManagementPage.tsx：任务请求状态、双区加载/错误展示、项目与请求隔离。
- apps/web/src/workspace/ProjectTaskLoading.tsx：共用加载与失败提示。
- apps/web/src/workspace/ProjectTaskLoading.css：圆环动画、图文纵向排列、水平居中及减少动画支持。
- apps/web/src/workspace/ProjectTaskLoading.test.tsx：初始及元数据等待、成功空响应、失败重试、切换项目旧请求和后台刷新回归测试。

## 验证

- RED：新增测试在旧实现上 4 项失败、1 项既有刷新行为通过；失败原因为缺少两处加载状态。日志 /tmp/vibeplan-project-loading-red.log。
- `pnpm exec vitest run apps/web/src/workspace/ProjectTaskLoading.test.tsx apps/web/src/workspace/ProjectTaskNavigation.test.tsx apps/web/src/app.test.tsx --exclude '.worktrees/**'`：58 项通过，exit 0。
- `pnpm --filter @vibeplan/web build`：最终 exit 0，包含 TypeScript 检查。首次发现测试误用 Testing Library 不支持的 exact 选项，移除后重新执行通过。
- `vibeplan check`：exit 0。
- `git diff --check`：exit 0。
- Chromium 人为挂起任务接口：两处加载可见，空提示不可见；圆环 computed transform 随时间变化，文字在圆环下方，圆环及文字与父区域水平中心误差小于 1px。
- Chromium 切换任务详情/甘特图、响应成功、失败及重试、成功空数组和 reduced-motion 均验证通过，无 pageerror。
- 临时浏览器脚本 /tmp/vibeplan-project-loading-browser.mjs。截图 /tmp/vibeplan-project-loading-desktop.png、/tmp/vibeplan-project-loading-mobile.png 已目视检查。

本次没有未解决的加载状态问题；未运行完整 Web 套件（上次存在无关样式字符串断言失败），没有提交或发布。原有窄屏项目头部横向溢出的排版不属于本次加载状态修改。
