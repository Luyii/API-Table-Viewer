# 开发与架构

## 环境与命令

清单声明 Chrome 114+，用于 Manifest V3、MAIN world 内容脚本与扩展会话存储。开发检查需要 Node.js 18+ 和 Python 3，预览生成检查与打包只使用 Python 标准库，没有 npm 依赖。

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
| `response-editor.js` | 响应草稿、精确格式化、JSON 校验与有界字段对比 |
| `response-mock.js` | 面板会话内的替换规则、DevTools 通信、命中状态和刷新前注入 |
| `mock-page.js` | 自包含页面拦截器，处理 Fetch / 异步 XHR、单次消费与超时释放 |
| `field-mock.js` | 原位编辑、字段标记、修改清单、定位、单项恢复与退出 |
| `field-patch-core.js` | 精确数值、标量补丁、稳定数组定位与类型验证 |
| `field-mock-background.js` | 标签页 / origin 会话存储与串行更新 |
| `field-mock-bridge.js` | 隔离世界与 MAIN world 的配置桥接 |
| `field-mock-page.js` | 启动阶段 Fetch / XHR 包装与真实响应补丁 |
| `tests/` | 回归测试与静态加载检查 |
| `scripts/package.py` | 白名单打包、清单与 ZIP 完整性检查 |

## 数据流和状态

1.5.0 的默认调试路径是原位标量编辑。`field-mock.js` 将表格、数据树与查看器中的值绑定到 Worker 路径；提交时只请求 `patchTarget`，取得原值、类型、字段路径和数组行标识。修改以补丁保存，不调用整份响应编辑器，也不运行整份 JSON diff。Worker 中的捕获记录保持原样。

`field-patch-core.js` 在 Worker、面板、后台与 MAIN world 复用路径、类型验证和精确整数逻辑。数组对象优先通过唯一 ID / UUID / key 定位；缺少唯一标识时使用不超过 64 KiB 的完整行内容匹配，内容变化或重复时跳过。多字段补丁先在原响应上完成定位，再统一应用；后端排序改变时重新找行，标识缺失 / 重复或字段类型改变时跳过。单字段 64 KiB，响应载入仍为 20 MiB；规则配置最多 30 个接口、每接口 200 个字段、合计 1 MiB。

`field-mock-background.js` 将规则写入 `chrome.storage.session`，按标签页 ID 和页面 origin 分组，串行处理同一标签页的读写。隔离世界的 `field-mock-bridge.js` 仅向当前 origin 传递配置，网页不能经由桥接写入扩展存储。关闭标签页时删除对应会话，重启浏览器或重新加载扩展也会清除。

MAIN world 的 `field-mock-page.js` 在 `document_start` 安装 Fetch / XHR 包装器。启动请求等待规则初始化，3 秒异常超时后回退真实请求。请求正常抵达后端，响应正文解析后应用标量补丁，再交给网页；方法与完整 URL 精确匹配，不按请求体区分。Fetch 保留状态和可用响应属性，调整已失效的长度 / 编码 / 校验头；XHR 支持异步文本与 JSON。退出或更新规则时，尚未交付的旧规则不会继续修改响应。重复初始化配置保持规则引用稳定，避免错误取消启动中的替换。

编辑不直接改变 Vue / React 的状态。页面需要再次请求或刷新才能展示变化；退出也只影响后续响应。原始响应的导出和 Network 核对不被补丁覆盖。未修改字段使用最新后端数据，但响应仍需解析 / 序列化，因此字段补丁不意味着大响应处理零开销。

`response-editor.js`、`response-mock.js` 和 `mock-page.js` 是此前整份替换实验的保留模块与回归基线，可见入口已隐藏，不属于 1.5.0 默认操作流程。其测试验证独立引擎的旧行为，不代表字段 Mock 绕过真实后端。

执行 `npm run preview` 后访问 http://localhost:8766，可用示例数据打开真实面板与 Worker；只有 DevTools 的宿主接口被替代。此预览不验证扩展安装或网页响应替换。`python3 tests/preview/build-preview.py /absolute/path/preview.html` 可生成同一面板的独立预览，不生成扩展 ZIP。

DevTools 的请求完成事件以及初始 `getHAR` 补录读取响应正文，面板将原文交给 Worker。Worker 持有解析结果与原始响应，用请求 ID 读取当前路径、表格页、搜索结果或导出内容。普通浏览优先传摘要及分页数据，完整复制和导出按操作请求。

面板与 Worker 使用带序号的消息匹配 Promise。选择请求、搜索词变化、弹框导航和字符串分段各有状态版本，异步结果应用前检查当前上下文，避免旧结果覆盖新视图。修改相应逻辑时保留这些检查。

大数据查看器的 Worker 任务分步遍历生成扁平节点索引；面板只请求窗口附近的行。关闭、导航或收起时释放索引及 ResizeObserver。虚拟渲染减少 DOM 数量，并不消除全部解析对象和节点索引的内存开销。

## 关键约束

- 面板多个经典脚本共享顶层作用域，新增变量需避免命名冲突并保持 `panel.html` 加载顺序。
- Worker 使用 `importScripts`，共享 JSON codec 必须先于数据逻辑加载。
- 用户字段和值必须作为文本渲染，路径只允许自有字段访问；不使用 `window.eval`、动态函数、远程脚本或内联事件属性。仅响应替换通过 DevTools 官方 `inspectedWindow.eval` 运行固定本地代码与序列化配置。
- 不使用普通 `JSON.stringify` 序列化可能含 BigInt 的数据，应使用 `stringifyJson`。
- 只有普通整数字面量可自动精确保留；小数、指数形式仍为 Number。原始文本另行保留。
- 新功能需考虑缓存淘汰、请求切换、弹框关闭以及无响应读取方法的 HAR 项。
- localStorage 保存布局、保留导航记录和页大小等偏好，不保存响应历史。

## 发布

1. 功能变更同步 `manifest.json`、`package.json` 与更新记录。
2. 运行 `npm test`，再按 Chrome 操作流程完成 [发布检查](TESTING.md)。
3. 运行打包脚本，从 `dist` 取 ZIP。脚本只包含运行资源与面向使用者的说明，不包含测试、开发工具或 Git 数据。
4. 再确认解压根目录有 `manifest.json`，用解压后的包加载扩展。
5. 上传源码仓库前检查是否意外加入响应数据、HAR、Cookie 或密钥。


## 1.5.1 浏览与捕获约束

- 请求捕获的状态和注册函数必须位于顶层；DOMContentLoaded 后启动，禁止放进 activateTab 等视图函数。回归覆盖不切换视图时捕获 localhost JSON、HAR 正文、BOM 和有限重试取消。
- 标量单击复制使用 valueText；可编辑标量经 FieldMock 的单击延迟隔离双击编辑。对象 / 数组标签不绑定复制，复制按钮阻断事件冒泡，读取完整 value JSON。
- 数组批量展开保存独立 scope，不从行的可见性推断按钮状态；退出批量模式恢复直接子节点。
- 内嵌扁平区域不建立独立滚动口，监听最近的 .tree / .modal-content；由容器与展开区域的相对位置计算虚拟窗口，顶部与底部占位维持内容高度。释放时移除各自监听及观察器，不覆盖其他展开区的滚动处理。
