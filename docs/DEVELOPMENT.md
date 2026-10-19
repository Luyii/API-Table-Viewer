# 开发与架构

## 环境与命令

运行扩展只需支持 Manifest V3 的 Chrome；当前未声明经过验证的最低 Chrome 版本。开发检查需要 Node.js 18+，打包使用 Python 3 标准库，没有 npm 依赖。

```sh
npm test
node tests/regression.cjs
node tests/package-check.cjs
python3 scripts/package.py
```

源码目录可直接在 Chrome 加载。修改后在扩展管理页重新加载，并重开目标页 DevTools。无需开发服务器或网络构建步骤。

## 模块职责

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | MV3 清单与 DevTools 入口 |
| `devtools.html` / `devtools.js` | 创建 API Table 面板 |
| `panel.html` / `style.css` | 界面结构和样式 |
| `panel.js` | 面板状态、网络捕获、Worker 请求分发、树 / 表格与原文入口 |
| `worker.js` | 解析与缓存、路径读取、排序筛选、搜索、子树遍历和虚拟列表数据 |
| `json-codec.js` | 精确整数解析与 JSON 序列化；在面板和 Worker 复用 |
| `viewer.js` | JSON 弹框、普通树、搜索、导航和分段 |
| `viewer-expanded.js` | 大数据全量遍历任务、可见区渲染、观察器与释放 |
| `table-ui.js` | 列宽估算、拖动和会话宽度状态 |
| `developer.js` | 请求详情、cURL、偏好、列显隐、路径解析及下载 |
| `layout.js` | 左侧列表折叠与尺寸调整 |
| `shortcuts.js` | 上下文搜索与匹配快捷键 |
| `tests/` | 回归测试与静态加载检查 |
| `scripts/package.py` | 白名单打包、清单与 ZIP 完整性检查 |

## 数据流和状态

DevTools 的请求完成事件以及初始 `getHAR` 补录读取响应正文，面板将原文交给 Worker。Worker 持有解析结果与原始响应，用请求 ID 读取当前路径、表格页、搜索结果或导出内容。普通浏览优先传摘要及分页数据，完整复制和导出按操作请求。

面板与 Worker 使用带序号的消息匹配 Promise。选择请求、搜索词变化、弹框导航和字符串分段各有状态版本，异步结果应用前检查当前上下文，避免旧结果覆盖新视图。修改相应逻辑时保留这些检查。

大数据查看器的 Worker 任务分步遍历生成扁平节点索引；面板只请求窗口附近的行。关闭、导航或收起时释放索引及 ResizeObserver。虚拟渲染减少 DOM 数量，并不消除全部解析对象和节点索引的内存开销。

## 关键约束

- 面板多个经典脚本共享顶层作用域，新增变量需避免命名冲突并保持 `panel.html` 加载顺序。
- Worker 使用 `importScripts`，共享 JSON codec 必须先于数据逻辑加载。
- 用户字段和值必须作为文本渲染，路径只允许自有字段访问；不得引入 `eval`、远程脚本或内联事件属性。
- 不使用普通 `JSON.stringify` 序列化可能含 BigInt 的数据，应使用 `stringifyJson`。
- 只有普通整数字面量可自动精确保留；小数、指数形式仍为 Number。原始文本另行保留。
- 新功能需考虑缓存淘汰、请求切换、弹框关闭以及无响应读取方法的 HAR 项。
- localStorage 保存布局、保留导航记录和页大小等偏好，不保存响应历史。

## 发布

1. 功能变更同步 `manifest.json`、`package.json` 与更新记录。
2. 运行 `npm test`，再在真实 Chrome 完成 [发布检查](TESTING.md)。
3. 运行打包脚本，从 `dist` 取 ZIP。脚本只包含运行资源与面向使用者的说明，不包含测试、开发工具或 Git 数据。
4. 再确认解压根目录有 `manifest.json`，用解压后的包加载扩展。
5. 上传源码仓库前检查是否意外加入响应数据、HAR、Cookie 或密钥。

自动化检查通过不等同于 Chrome 内端到端验证通过。
