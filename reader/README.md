# Chat Reader 私有版

这是 **Chat Reader 的浏览器入口**，不是原导出器的服务器上传选项。两种扩展独立打包。Reader 版本复用本 Fork 的 `extension/fast-text.js`；本目录提供受限设备客户端、侧面板、主动采集和有内存边界的打包出口。基线 `9069e9c7b8023bc1d1162d94f661e26cd2cc4481`，原 MIT 许可证和第三方声明随包分发；流式 ZIP 使用本地固定的 `fflate` 和其许可证，不加载远程代码。

```powershell
# 固定目标实例；输出必须是全新目录。不需要 npm install 来打包。
node scripts/package-reader.cjs https://reader.example.test E:\chat-reader-temp\reader-private-build --zip
```

分发时提供绑定实际实例的 `chat-reader-0.2.0.zip` 和 **这个安装包**的 SHA-256，而不是示例域名包。用户无需编译：核对运维交付的摘要，解压到长期保留的目录，在 Chrome／Edge 的扩展管理开启开发者模式，加载直接含 `manifest.json` 的目录。扩展 ID 不是签名。

**公开 Fork 的交付：** 不设置、上传或公布私人 Reader 地址。成功的推送 CI 用固定示例地址构建两次，只上传该参考 ZIP 的校验文件，制品名 `reader-reference-<SHA>-<运行 ID>-<尝试>`。运维从**同一仓库、同一提交、同一成功运行及尝试**取这个文件并校验下载的 Actions 制品，然后在对应检出的代码中绑定实际 HTTPS 地址打包：

```powershell
# READER_DISTRIBUTION_ORIGIN 预先从可信部署配置设置；路径为本次新目录和已取得的精确 CI 参考校验文件。
node scripts/package-reader.cjs $env:READER_DISTRIBUTION_ORIGIN "$T\extension" --zip
node scripts/verify-reader-distribution.cjs "$T\chat-reader-0.2.0.zip" "$R\chat-reader-0.2.0.zip.sha256"
```

核验器检查实际 ZIP 是打包器生成的规范字节、配置、主机权限与 CSP 均绑定该实例，再只把这三处绑定还原到示例地址，要求还原后的**整个 ZIP**与 CI 摘要相同。可执行代码、权限、图标或许可文件不符均拒绝。不要用安装包旁自生成的摘要代替 CI 的参考摘要；两个不同地址的 ZIP 摘要本来就不同。只有明确配置 `READER_PUBLIC_ORIGIN` 的**私有仓库**才另在 Actions 中生成实例包。`--test-only` 仅作本地实验，不用于向用户交付。

想把几条消息接到已有 Reader 对话后，在「保存到 Reader」旁的更多菜单选择「选择内容并追加到…」。先在来源本机勾选，再到 Reader 检查目标与当前末尾。只给 Reader 所选消息及相关资源；换来源或取消不会提交已有内容。只在 Reader 中明确确认后追加，竞争时保留勾选、重新显示实际末尾，不覆盖旧正文。需要整条保存时仍然点原主按钮，不走选择器。

在 Chrome / Edge「加载已解压的扩展程序」选择输出目录。稳定内测 ID：`gihbiofiiflkckcmomddkkjkoifkddfi`。只在可信机器上安装可信源码构建，不把公开的扩展 ID 当发布签名。Reader **API 和 worker** 需支持 `reader-chat-v1` 并明确将此 ID 登记到 `READER_EXTENSION_IDS`；生产旧 `v0.1.5` 不支持。完整接入、恢复和权限边界见配套 Reader 仓库的 `docs/system/BROWSER_EXTENSION.md`。

工具栏 → 登录 Reader、首次确认目的地；之后在齿轮中更改或查看最近任务。普通网页只打开原生侧栏：搜索、最近／已置顶、项目筛选；一行一个对话，点标题打开 Reader。附件搜索回到所属对话，`…` 可打开 Reader 文件面板、置顶、移动或导出 `.context.zip`。包只下载，不把批注、笔记或文件发回来源站。

项目内搜不到时，可以保留关键词搜索其他项目；取消仅看置顶不会清空项目。资料读取暂时失败，直接从侧栏重试；项目尚未读出时不允许把默认保存位置误设为「未归类」。

在当前 ChatGPT 对话点击「保存到 Reader」。确认过的完整结果可直接打开；重访且本地最近任务已没有收据时，默认不向 Reader 发送来源 ID。在更多菜单点「查找已存版本」，或在插件齿轮中明确允许本设备自动识别后，才查询当前可见对话的标识，不传正文、不枚举历史或项目。找到仍可访问的绑定时只显示「打开已存版本」，不冒充当前分支/内容已同步；用户要保存当前版本仍须重新走来源比对。缺件是部分保存，分支变化需要明确另存；已存在的记录不会移到新的默认项目。结果来自 Reader 回执，不从标题、消息数量或固定倒计时推断。默认不在此页显示私有项目名。网页与侧栏分用两种授权，不扫描远端项目/账号清单，不需要 `<all_urls>`、Cookie 权限或浏览记录权限。未启用采集时仍可使用已获准的资料操作。旧回执不保证完整，请到 Reader 核对。

在同一个 ChatGPT 标签内切换 Reader 账号，手动找到的旧记录不会变成新账号的「已存」；点击打开时仍按当前身份确认。查找提示不会持久化到浏览历史或另一份文档。

**维护：**保留 `retainRaw` 等上游默认行为。Reader 调用使用无调试原包、有限页大小、实际分支索引和私有 OPFS。更新上游时先核对可见消息、隐藏节点、分页、附件与静态交互降级，再运行 `npm ci --ignore-scripts`、`npm test`（Node 24），以及 Reader 的双浏览器／PostgreSQL 验收。缺失的上游私有夹具不是测试成功。网页来源不是稳定的公开 API；不能用合成测试代替平台许可或真人账号验收。
