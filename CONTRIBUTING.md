# 参与开发

欢迎提交 Issue 和 Pull Request。问题报告请包含应用版本、Windows 版本、复现步骤及预期行为；请先移除 Token、API Key、私人会话和持仓信息。

修改前参照 README 配置本地开发环境。提交前运行与变更相关的测试以及 `npm run typecheck`。接口变更应更新共享 schema，运行 `node scripts/generate-contracts.mjs` 和 `.venv312/Scripts/python.exe scripts/contract-coverage.py`，检查生成结果。

数据服务测试应使用独立测试目录和固定样例，不依赖开发者真实账号或持仓。新增依赖请保留许可证和分发来源；不要提交 `.runtime`、构建输出、凭证或个人数据。

提交贡献即表示同意以项目 MIT 许可证分发该贡献。
