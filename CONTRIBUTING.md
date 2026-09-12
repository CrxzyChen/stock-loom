# 参与开发

欢迎提交 Issue 和 Pull Request。问题报告请包含应用版本、Windows 版本、复现步骤及预期行为；请先移除 Token、API Key、私人会话和持仓信息。

修改前参照 README 配置本地开发环境。提交前运行与变更相关的测试以及 `npm run typecheck`。接口变更应更新共享 schema，运行 `node scripts/generate-contracts.mjs` 和 `.venv312/Scripts/python.exe scripts/contract-coverage.py`，检查生成结果。

数据服务测试应使用独立测试目录和固定样例，不依赖开发者真实账号或持仓。新增依赖请保留许可证和分发来源；不要提交 `.runtime`、构建输出、凭证或个人数据。

提交贡献即表示同意以项目 MIT 许可证分发该贡献。

## 数据源与恢复

新增接口先阅读 [数据源扩展指南](DATA-SOURCES.md)。涉及存储、升级或发布时，参照 [兼容与恢复边界](COMPATIBILITY.md)。固定样例与真实接口验证分别记录，不能互相替代。

## 可复现构建

`npm ci` 使用 package-lock.json；Python 构建依赖固定在 requirements-build.txt。源码开发和发行打包要求不同：打包脚本还校验具体 Python、OpenSSL、SQLite 及第三方许可来源，环境不符应停止，不跳过检查。

构建使用独立输出目录，`build/service-current.json` 和 `build/package-current.json` 指向本次产物。不要根据旧 release 文件名认定它来自当前源码。贡献者无需真实 Token 即可运行固定样例测试；真实供应商与安装验收另行执行并保留授权边界。
