# 今日工作布局实施计划

**Goal:** 实现用户已批准的推荐条、分类切换和通栏任务列表，改善移动阅读与刷新体验。

**Architecture:** 沿用 TodayWork 的 my-work 请求和 onOpenTask 回调。组件按组织标记数据快照，忽略过期请求；刷新保留已加载快照，组织变更隐藏旧快照。独立 TodayWork.css 限定样式影响范围。

**Tech Stack:** React、TypeScript、lucide-react、Vitest、Testing Library、Playwright。

基线：7ea0d949ab5922ee35d09aedb2ec0a3e04e89caa。当前工作区包含其他功能的修改，全部保留；不提交、不推送、不新建云端任务。本需求未绑定教程任务，不混入教程的执行报告。

## 文件范围

- TodayWork.tsx：四个分类、唯一推荐条、带项目/优先级/截止日期的列表、六条展开、阻塞原因和加载状态。
- TodayWork.css：局部样式与手机响应式；styles.css 仅删除旧 today-work 专用规则，保留其他工作区修改。
- TodayWork.test.tsx：真实组件交互测试，API 为边界测试替身。

## 执行清单

- [x] 1. 先补充失败测试：分类计数与默认项、推荐任务回调、项目归属、六条展开、阻塞详情、键盘切换、无组织/空队列/失败重试、刷新保留数据与分类、组织切换和迟到响应。
  - 命令：pnpm exec vitest run apps/web/src/workspace/TodayWork.test.tsx --exclude '.worktrees/**'
  - 预期旧组件因没有分类切换、项目名称和新错误状态而失败。
- [x] 2. 在 TodayWork 内实现状态与展示，保留服务端排序，使用服务端提供的 next，不改变状态或创建接口。分类优先顺序 inProgress、inReview、blocked、ready；选择后同组织刷新不抢回默认分类。使用 tablist/tab/tabpanel，左右键和 Home/End 导航。
  - 快照结构：{ organizationId, data }；请求状态包含 organizationId、loading、error；仅当前组织快照参与渲染。
  - 刷新使用请求清理标记忽略旧响应。自动更新延续原来的 60 秒与 window focus。无组织不请求，切换组织取消旧请求且立即隐藏旧数据。
- [x] 3. 使用局部 CSS 完成设计。#2f657d 用于当前分类与入口，#244454 用于标题，#71808a 用于辅助信息，#d8e0e5 用于边框，#f3f5f7 用于背景。标题 16px，任务 13px，辅助 12px；数字使用 tabular-nums。手机项目/优先级/日期移到次行，分类局部滚动；长任务标题两行，阻塞原因展开查看全文。
- [x] 4. 跑测试、类型检查和 Web 构建；用 Playwright 虚构演示数据在 1440px/375px/320px 验证，不使用真实账号数据。验证首次失败/重试、刷新保留列表、组织切换与任务跳转。保存桌面手机截图并查看；运行 Web 全量测试并如实区分既有 styles.test.ts 基线失败。

## 当前记录

实现完成，等待用户在本地页面检查。没有提交或部署。

## 实际改动

- TodayWork.tsx：推荐条、四类切换、列表、项目信息、逾期提示、六项展开、阻塞详情、键盘导航、组织隔离和刷新保留内容。
- TodayWork.css：新增局部样式；styles.css 只移除旧今日工作规则，原任务目录 container-type 修改保留。
- TodayWork.test.tsx：11 项测试，含每分钟自动刷新和卸载清理。
- 本计划及设计文档：记录授权、方案、验证与剩余问题。

## 实际验证（2026-11-04）

| 检查 | 实际结果 |
| --- | --- |
| 测试先行 | 旧实现运行初始 10 项测试：9 项因缺失新功能失败、1 项通过，exit 1。实现后初始 10 项全部通过，exit 0。 |
| 今日工作最终测试 | Web 最终全量运行中 11 项 TodayWork 测试全部通过，含新增自动刷新/卸载测试。 |
| `pnpm --filter @vibeplan/web exec tsc --noEmit` | exit 0。 |
| `pnpm --filter @vibeplan/web build` | exit 0，Vite 构建成功。 |
| `pnpm exec vitest run apps/web/src --exclude '.worktrees/**'` | exit 1；最终 156 项通过，1 项既有样式测试失败。日志 /tmp/vibeplan-today-work-web-tests-final.log。 |
| `node /tmp/vibeplan-today-work-browser.mjs` | exit 0；演示数据验证分类、展开/收起、阻塞全文、刷新中/失败保留列表、分类保持、任务深链。1440/375/320px 页面宽度等于视口宽度，今日工作自身无横向溢出；无运行时页面错误。 |
| `vibeplan check` | exit 0。 |
| `git diff --check` | exit 0。 |

已查看桌面与手机截图：/tmp/vibeplan-today-work-desktop.png、/tmp/vibeplan-today-work-mobile.png。截图使用虚构任务，未使用账号数据。

## 剩余问题与交接

全量 Web 测试仍有 `styles.test.ts` 的旧字符串断言失败：要求 `.task-tree-copy` 在 `min-width: 0;` 后立即结束，而用户已有样式追加了 `container-type: inline-size;`。此处与今日工作无关，保留用户改动和测试，不宣称全量通过。首次全量运行期间还发现并行工作新增的父任务日期提示用例失败；最终重跑该用例已通过，本次未修改 API client 或其测试。

已完成本需求全部布局与交互验证。可在 http://localhost:5173/overview 查看。用户检查视觉效果后可提出同范围调整；不以本地实现或测试结果替代云端任务人工验收。
