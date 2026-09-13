# Stock Loom · 观市

本地优先的 A 股信息工作台，把行情、自选、持仓和项目资料放在可自由调整的桌面界面里，右侧由 Codex Copilot 协助研究。

**Windows x64 · Beta · MIT**

[查看发行版本](https://github.com/CrxzyChen/stock-loom/releases) · [版本说明](docs/beta-release.md) · [使用指南](USER-GUIDE.md) · [参与开发](CONTRIBUTING.md) · [数据源扩展](DATA-SOURCES.md) · [兼容与恢复](COMPATIBILITY.md)

已发布 [0.2.0-beta.2 预览版](https://github.com/CrxzyChen/stock-loom/releases/tag/v0.2.0-beta.2)，包含 Round 4 新功能。完整应用内升级与数据保留验收仍在进行，尚未宣布 Round 4 全部完成。

## 能做什么

- 查看市场概览、行业板块、个股日线、财务和估值；读取本地缓存并按需更新。
- 管理自选与手动持仓，在多个标签页中浏览股票和项目文件。
- 通过 Codex Copilot 使用股票 MCP 工具、项目资料和命令行；支持会话、附件、模型选择、权限、Plan 和 Goal 状态。
- 配置本地定时任务：应用打开或托盘后台运行时执行，退出应用后停止。
- 将资料保存在本地项目中，供用户和 Agent 后续查阅。

不连接券商下单。软件不附带行情数据授权、模型额度或 API Key。

## 第一次使用

1. 从 Releases 下载并安装 Windows x64 安装包。当前安装包未签名，Windows 可能提示未知发布者。
2. 在设置中填写自己的 Tushare Token，初始化股票目录和交易日历。
3. 打开市场或添加自选，查看数据；部分数据接口需要对应积分或单独权限。
4. 使用 Copilot 前，在设置中登录 Codex，或配置应用支持的第三方模型服务。

行情以接口返回的交易日和时间为准，目前核心页面使用日线及财务快照，并非实时交易终端。申万行业日线使用 `sw_daily`，需要对应 Tushare 权限；权限要求请以 [Tushare 官方文档](https://tushare.pro/document/2?doc_id=290)为准。

## 本地开发

开发环境：Windows x64、Node.js 22.12+、Python 3.12。安装依赖需要网络。

```powershell
npm ci
node node_modules/electron/install.js
python -m venv .venv312
.venv312\Scripts\python.exe -m pip install -r requirements-build.txt
npm run dev
```

`npm run dev:ui` 仅启动前端预览；数据服务和原生功能需要 Electron。

```powershell
npm run typecheck
npm test
npm run test:python
npm run package:win
```

打包会校验运行时版本与第三方许可来源。当前发布环境固定为 Python 3.12.14、OpenSSL 3.5.8、SQLite 3.53.1，不能用任意 Python 3.12 安装直接替代。更换运行时需要同步更新并验证 `third-party/` 和构建脚本中的清单。首次发布暂不提供跨平台构建保证。

## 项目结构

| 目录 | 用途 |
| --- | --- |
| `apps/desktop` | Electron 主进程和 Vue 界面 |
| `apps/data-service` | Python 数据服务、本地存储及行情同步 |
| `apps/agent-host` | Codex 会话、工具连接和运行管理 |
| `apps/research-tools` | 股票 MCP 工具 |
| `packages/contracts` | 共享接口与生成类型 |
| `tests` | Node 和 Python 验证 |
| `third-party` | 第三方许可与来源记录 |

为兼容开发版已有数据，内部包名和用户数据目录保留 `stock-workshop`。请勿把本地 Token、持仓、会话和数据快照提交到仓库。

## Beta 边界

目前仅发布 Windows x64，未完成异机安装验收。使用前建议备份本地数据。第三方模型兼容性取决于服务支持的协议；定时任务依赖应用进程存活。Beta 当前通过 Releases 手动下载升级；安装包以 Releases 实际资产为准。

项目代码使用 [MIT](LICENSE)；随包第三方组件按各自许可证分发，许可文本和来源清单随安装包提供。Stock Loom 是独立项目，不是 OpenAI 或 Tushare 的官方产品。
