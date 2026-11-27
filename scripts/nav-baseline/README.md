# 插件导航的改前测量

两份测量包都从已核验的 `6725193cfe6f34e8f15f40f3be0e6c5f775e0d4e` 私有 ZIP 生成。`control` 保留全部原导航程序字节，仅增加测量按钮。`counted` 还在相同旧程序的读取、转换、树、DOM 和定位路径计数。两包使用独立扩展身份，Reader 指向本机测试地址。导航无需连接 Reader。

## 在真实对话中记录

1. 在测试浏览器配置的扩展管理页，用「加载已解压的扩展程序」选 `control` 文件夹。一次只启用一份 Chat Reader。打开一段获准测试、超过 **100 个问答轮次** 的真实 ChatGPT 对话，刷新后停在正文中间。保持相同浏览器、缩放、窗口大小、对话分支和起始轮次。
2. 点左下角「开始测量」，立即打开插件导航。在目录读取时尝试滚动正文、点击一个已显示的轮次。读完后依次定位末轮、首轮、中间轮次、长回答中的二级及三级章节，再快速点两个不同轮次。每次观察实际落点和最终高亮。可在同次测量结束前搜索远处的词、从独立附件列表定位远处附件。若出现卡住、中断、目标不对或没有可点的轮次，保留该次结果。
3. 点「结束并下载指标」。禁用对照包，在同一测试配置加载 `counted` 文件夹，刷新同一对话、回到同一处，重复上述动作。为判断缓存和重测波动，可交换两包顺序再各跑一次。若对话切换、生成中、或测试途中标签页转入后台，保留并标注这次记录。
4. 回传 `reader-nav-control-*.json` 和 `reader-nav-counted-*.json`，加一句读取期间是否能滚动和点击、哪些落点吻合或偏离。截图可只保留导航结构和状态，遮住标题、正文、头像和地址栏。不需要发送对话链接、账号、浏览器跟踪文件或网络日志。

## 指标口径

| 字段 | 计量范围 |
| --- | --- |
| `responseBytes`、`completedSourcePages` | 来源响应流交给读取器的正文载荷字节及完整页。传输编码、请求头及其他网页流量不计入。 |
| `scannerBytes`、`decodedJsonBytes` | 本地结构扫描读取的流字节、实际送入 JSON 解码器的区间字节。重复读计入各自项，两项与来源响应互有重叠。 |
| `converterInputs`、`visibleBodyCalls`、`markdownHeadingParses`、`sectionNodes` | 实际交给完整转换器的记录、可见正文转换调用、Markdown 标题解析调用、章节树节点构造。包括重复计算和被可见性判定过滤的转换输入。 |
| `messageDomScans`、`revisionSamples`、`revisionSampleElements`、`domTextWalks` | 消息适配器全局枚举次数、版本检查次数、各次检查收到的挂载元素累计数量、可见文字遍历调用次数。 |
| `mountedOutline`、`sourceOutline` | 从首次相关读取开始到局部挂载目录、来源完整目录渲染的毫秒与轮数。只有 `sourceOutline` 可用于判断已核实轮数。中途停读时可为空。 |
| `longTasksMs`、`inputDispatchLagMs`、`eventDelayMsOver16msDuration` | 页面观察到的主线程长任务、可信按下事件到捕获监听器的时间、浏览器 Event Timing 返回的输入等待时间。后者请求 16 ms 事件时长门槛。测量导航所在顶层页和其 Shadow DOM。 |
| `wheelEvents`、`scrollEvents`、`wheelDuringRead`、`inputDuringRead` | 滚轮输入与滚动事件分开计数。滚动事件可由程序产生，手感、实际到达位置和点击是否生效需要人工观察。 |
| `tabHeapBytes` | 浏览器可提供的近似 JS 堆起点、1 秒抽样峰值与结束值。包含网页和其他同堆代码，采样可能错过短峰。 |
| `jumpAttempts`、`jumpOutcomes`、`jumps` | 发起次数和已返回结果。保留前 64 次的类型、耗时；成功须经过原插件的身份、可见性和稳定性验证。附件落到所属消息单列 `fallback`。结束时尚在定位的操作保留在尝试总数中。 |

`null` 表示浏览器不支持、该构建未计数或尚未观察到。有观测能力但没有样本时次数为零、最大值为 `null`。对照测量也有观察器开销。需要未加测量按钮的参考读数时，可用原桌面包在浏览器 Performance 面板手工读取同一场景，只记录数字。

## 重建与复核

使用仓库既有 Node 依赖，在项目批准的任务临时目录中执行。第二个参数须是新目录。

```text
node scripts/nav-baseline/build.cjs <已核验的0.3.0私有ZIP> <新输出目录>
node scripts/nav-baseline/verify.cjs <同一ZIP>
```

两份 ZIP 的 SHA-256 写入输出目录的 `checksums.json`。离线验证使用合成消息检查安装包差异、探针和导出边界。真实网页验收须保留人工操作的两份指标。
