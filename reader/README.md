# Chat Reader 私有版

这是 **Chat Reader 的浏览器入口**，不是原导出器的服务器上传选项。两种扩展独立打包。Reader 版本复用本 Fork 的 `extension/fast-text.js`；本目录提供受限设备客户端、侧面板、主动采集和有内存边界的打包出口。基线 `9069e9c7b8023bc1d1162d94f661e26cd2cc4481`，原 MIT 许可证和第三方声明随包分发；流式 ZIP 使用本地固定的 `fflate` 和其许可证，不加载远程代码。

```powershell
# 固定目标实例；输出必须是全新目录。不需要 npm install 来打包。
node scripts/package-reader.cjs https://reader.example.test E:\chat-reader-temp\reader-private-build
```

在 Chrome / Edge「加载已解压的扩展程序」选择输出目录。稳定内测 ID：`gihbiofiiflkckcmomddkkjkoifkddfi`。只在可信机器上安装可信源码构建，不把公开的扩展 ID 当发布签名。Reader **API 和 worker** 需支持 `reader-chat-v1` 并明确将此 ID 登记到 `READER_EXTENSION_IDS`；生产旧 `v0.1.5` 不支持。完整接入、恢复和权限边界见配套 Reader 仓库的 `docs/system/BROWSER_EXTENSION.md`。

工具栏 → 登录 Reader、确认目的地。任意网页均可查自己的资料；标题打开 Reader 原页。当前 ChatGPT 对话点「保存到 Reader」；对话行可直接导出真正的 `.context.zip`，不会把导出的个人批注/接续笔记送回来源站。断网、缺件、分支变化或实时分享可能要求复核。只读取用户选择的当前对话，不扫描项目/账号清单；不需要 `<all_urls>`、Cookie 权限或浏览记录权限。

**维护：**保留 `retainRaw` 等上游默认行为。Reader 调用使用无调试原包、有限页大小、实际分支索引和私有 OPFS。更新上游时先核对可见消息、隐藏节点、分页、附件与静态交互降级，再运行 `npm ci --ignore-scripts`、`npm test`（Node 24），以及 Reader 的双浏览器／PostgreSQL 验收。缺失的上游私有夹具不是测试成功。网页来源不是稳定的公开 API；不能用合成测试代替平台许可或真人账号验收。
