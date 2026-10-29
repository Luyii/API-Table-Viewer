# 测试与验证

本文说明自动检查、浏览器验收和版本交付要求。执行命令前进入仓库根目录。

## 环境要求

- Node.js 18+；CI 同时验证 Node.js 18、22、24。
- Python 3，用于预览生成、ZIP 打包和压缩包验证。
- Chrome 114+，用于手工验证扩展安装、真实捕获与网页响应模拟。
- 自动检查无需安装 npm 或 Python 项目依赖。

## 按改动范围执行

日常开发优先运行：

```sh
npm run test:changed
```

默认读取当前工作区相对 HEAD 的已修改、已暂存和未跟踪文件，不重复测试没有修改的干净工作区。比较已提交的变更时显式指定基线：

```sh
npm run test:changed -- --base HEAD~1 --head HEAD
npm run test:changed -- --dry-run --files appearance.js style.css
```

`--dry-run` 仅展示计划；`--files` 用于明确已知修改文件，未指定的文件不会被自动补充。CI 根据推送前提交或 PR 基线识别改动。每次执行先输出选中检查及依赖原因。

| 改动范围 | 执行检查 |
| --- | --- |
| Markdown 文档 | 本地文档链接、锚点和标题检查 |
| 外观生成 | 外观、资源及捕获启动检查 |
| 样式 | 资源及捕获启动检查 |
| 面板、查看器、布局和快捷键 | 主回归、资源及捕获启动检查 |
| Worker 与共享解析 / 补丁模块 | 相应的主回归、接口、字段模拟、捕获及资源检查 |
| 独立测试文件 | 该测试组 |
| 打包脚本 | 资源、构建 ZIP 和解压资源检查 |
| 未知文件、依赖 / 配置变化、无法确定基线 | 回退完整检查 |

目前按模块和测试组选择，主回归共享初始化状态，涉及它时仍整组执行，避免只运行单条用例造成错误结果。界面运行时改动保留一次捕获启动检查，防止遗漏监听注册故障。重复命中的测试组只运行一次。

手动触发 CI 或正式发布执行全量；`npm test` 保留为全量检查入口。CI 测试任务按改动选组，后续 ZIP 验证仍执行，确保实际交付文件完整。选择规则位于 `scripts/test-changed.cjs`，由 `tests/test-selection.cjs` 验证。

## 自动检查

```sh
npm test
```

| 命令 | 当前覆盖范围 |
| --- | --- |
| `npm run test:regression` | 103 项主回归：解析、精度、路径、表格、搜索、导出、缓存、异步状态、捕获启动与虚拟列表 |
| `node tests/display-conversion.cjs` | 数据显示转换、分页、搜索和原始数据检查 |
| `npm run test:selection` | 8 项测试选择规则检查，覆盖范围缩小、依赖扩散、去重与保守回退 |
| `npm run test:docs` | 仓库 Markdown 的本地链接、锚点与一级标题检查 |
| `npm run test:capture` | 10 项捕获启动集成检查：完整 HTML 脚本顺序、DOM 就绪分支、无交互捕获、localhost、重复注册、HAR / 正文失败和清空竞态 |
| `npm run test:package` | MV3 清单、资源路径、HTML ID、CSP、语法和共享作用域 |
| `npm run test:fixtures` | 8 个本地 HTTP / Worker 子案例，另计 1 个父案例 |
| `npm run test:mock` | 18 项旧整份响应替换引擎检查；不是当前字段补丁能力的完整证明 |
| `npm run test:preview` | 3 项预览数据、路由与生成结果检查 |
| `npm run test:fields` | 15 项字段级响应模拟检查：类型、精度、数组定位、Fetch / XHR、会话恢复及隔离 |
| `npm run test:appearance` | 9 项外观检查：预设、单色生成主题、保存恢复、旧配置迁移、非法输入隔离、明暗对比度、焦点和字号 |

数量以实际命令输出为准。Node.js 中的 DOM、XHR 与 DevTools 模拟用于验证状态和逻辑，不能替代真实浏览器验收。

## 捕获启动回归

`tests/capture-startup.cjs` 使用 `tests/helpers/capture-panel.cjs`，从真实 `panel.html` 读取脚本列表并按顺序执行全部面板脚本，使用实际 Worker 引擎。测试不直接调用 `capture` 代替请求监听，而是通过已注册的 DevTools 请求事件送入数据，并验证请求进入列表。

- 分别验证 DOM 仍在加载及已经就绪时的启动，无需切换视图或点击按钮。
- 覆盖 localhost（含端口）、127.0.0.1 与 HTTPS；主题和布局调整后监听仍然有效，重复启动不重复注册。
- 覆盖 HAR 空正文与后续完成事件去重、HAR 获取失败、注册失败提示与重试、清空后历史回调失效。
- 验证正文读取最多重试三次，清空后取消旧重试；非法 JSON 不阻断后续合法响应。
- 故障注入用例刻意把监听启动移到 `activateTab` 后，确认“无交互捕获”断言会失败，防止测试绕过启动路径而误报成功。

本组测试提供模拟 DOM、Chrome API 和可控时钟，未启动真实 Chrome。它强化启动集成覆盖，不等同于扩展安装或真实 Network 事件的端到端验收。单独运行 `npm run test:capture`，全量运行 `npm test`；现有 CI 无需新增任务。

## 持续集成

工作流位于 `.github/workflows/ci.yml`，由分支推送、拉取请求和手动操作触发，不设置路径过滤。

1. Node.js 18、22、24 分别运行 `npm run test:changed -- --ci`；按改动选择测试组，无法确定范围时回退 `npm test`。
2. 测试全部通过后，使用 Node.js 24 和 Python 3.12 打包并验证 ZIP。
3. 测试和打包任务仅申请仓库读取权限，不安装项目依赖；验证通过后上传 ZIP Artifact，保留 30 天。
4. 正式发布仅由 main 上提交消息精确为 `release: publish v<package.json 版本>` 的推送触发；发布任务单独申请 contents: write，复验下载的 ZIP，拒绝覆盖已有标签或 Release。先上传草稿附件，再公开发布。
5. 任一命令失败会使对应任务失败；并发取消和超时规则以工作流文件为准。

检查当前结果：[GitHub Actions](https://github.com/Luyii/API-Table-Viewer/actions/workflows/ci.yml)。

## 浏览器验收

启动本地案例：

```sh
npm run test:manual
```

访问 http://127.0.0.1:8765，在目标页打开 DevTools → API Table，再刷新并触发请求。完整案例见 [浏览器验收指南](CHROME_REPRO.md)。

| 范围 | 预期行为 |
| --- | --- |
| 启动与捕获 | 不切换视图即可捕获 HTTP / HTTPS JSON 请求；验证 localhost、普通站点、历史补录、空正文和错误提示 |
| 编辑与恢复 | 双击 / 悬停 F2 编辑；无改动不提示成功；刷新恢复规则；退出后下次请求恢复真实响应 |
| 复制与行操作 | 标量单击复制；数组 / 对象点行展开；复制按钮不触发行展开，保留完整 JSON |
| 扁平展开 | 与行内展开独立，退出后保留一级；没有重复 Array 根节点；相邻数组互不影响 |
| 统一滚动 | 展开内容撑开主区域；滚动到尾项、窗口缩放、折叠及退出后没有空白窗口或泄漏 |
| 布局与搜索 | 左栏显隐与调整宽度；顶部收起；Ctrl / ⌘+F 浮动搜索与 Esc 关闭 |
| 表格与导出 | 分页、排序、列宽、隐藏列、全数组搜索；导出保留筛选、排序、整数与负数 |
| 外观与异步 | 主题、字号、密度及持久化；快速切换请求、节点和搜索词不覆盖新状态 |

验收记录应包含：提交 SHA、Chrome / 操作系统版本、案例与数据规模、操作步骤、预期 / 实际结果。不得把自动检查结果写成真实 Chrome 验收结果。

## 打包验证

```sh
python3 scripts/package.py
python3 tests/package-archive.py
```

ZIP 验证包括文件白名单、重复条目、完整性、源码一致性和解压后的资源检查。随后在 Chrome 中加载解压目录，验证安装与关键路径。

## 版本交付检查

1. 同步 `package.json` 与 `manifest.json` 版本号。
2. 更新使用说明、版本记录和版本说明。
3. 执行相关自动检查、浏览器验收和 ZIP 验证。
4. 核对提交差异与 CI 结果，再按维护者选择提交或创建拉取请求。
5. 只有明确要求发布时才创建标签或正式 Release；代码上传和生成 ZIP 不等于正式发布。

## v1.5.1 验证记录

- 本地：103 项主回归、其余 `npm test` 检查以及 ZIP 解压资源检查通过。
- CI：[运行 39915059290](https://github.com/Luyii/API-Table-Viewer/actions/runs/39915059290) 的 Node.js 18 / 22 / 24 和打包检查通过，对应提交 `663b5dd`。
- 用户已确认 fix8 测试包完成测试；未留存逐案例 Chrome 版本和结果表，因此不扩展为完整跨平台认证。
- 更早的验证过程见 [历史测试记录](TEST_HISTORY.md) 和 [历史修复报告](../CHECK_REPORT.md)。

## v1.5.1 正式发布复核（2026-10-23）

- 源码基线：`0df3d4115151b77b415818dba4c9a9235c26ff4e`；main 无开放问题，未发现已登记的关键发布阻断项。
- 基线 CI：[运行 39917291861](https://github.com/Luyii/API-Table-Viewer/actions/runs/39917291861) 在 Node.js 18、22、24 上测试和 ZIP 检查成功。
- 本次本地环境：Node.js 24.19.0、Python 3.12.14；`npm test` 全部通过。实际 ZIP 白名单、源码字节一致性、完整性、清单根目录和解压资源检查通过；重复构建字节一致。
- 本次没有执行真实 Chrome 扩展加载、DevTools 捕获、刷新后规则恢复或跨平台手工验收。沿用 fix8 用户验收记录，不能扩展为逐案例认证。
- 发布任务以本次提交 SHA 为标签目标，附件来自该提交成功 CI 的构建产物；最终远端运行及附件状态以 Actions / Release 页面为准。


## v1.5.2 发布验证

完整范围和实机验收限制见 [v1.5.2 版本说明](RELEASE_v1.5.2.md#验证与限制)。发布时必须同步两个版本文件、CHANGELOG 和对应版本说明，无需修改工作流中的版本常量。全量测试、ZIP 检查成功后才允许发布；已有标签或 Release 一律拒绝覆盖。
