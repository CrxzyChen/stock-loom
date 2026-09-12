# 数据源扩展指南

本文描述当前工作树的实现，不代表供应商授予的数据使用或再分发权限。界面与 Copilot 共用本地数据服务；新来源应接入这条路径，避免界面与 Agent 各维护一份数据。

## 接入位置

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 传输 | `apps/data-service/provider.py` | HTTPS、凭证、响应限制、错误分类 |
| 领域适配 | `bars.py`、`financials.py`、`sector_data.py`、`announcement_data.py` 等 | 校验、归一化、快照发布与读取 |
| 作业 | 数据服务的任务队列与 `demand_data.py` | 去重、状态、限流恢复、按需更新 |
| 契约 | `packages/contracts/schema.json` | 请求、响应、生成类型与运行时校验 |
| 桌面 | main IPC、preload、`packages/contracts/desktop.ts` | 校验调用边界，界面读取相同服务 |
| Copilot | `apps/research-tools/workspace-tools.mjs` | 工具声明，由 WorkspaceToolBroker 转发 |

先用 `rg --files apps/data-service` 查找对应领域实现。沿用现有 `fetch(token, api, params, fields)` 注入点编写固定响应测试；不要为了测试修改真实账号配置。

## 每个新接口必须说明

1. **鉴权与权限**：凭证由主进程凭证库管理，按请求传给服务，不写入快照。区分无效凭证、接口权限和额度不足。积分门槛不代表所有接口权限；不要在代码里把用户的积分换算为未经验证的权限。
2. **传输与限流**：现有 Tushare 传输仅向固定 HTTPS 地址发送，拒绝重定向，12秒超时，响应上限8 MiB。新来源单独定义允许的主机、超时、大小及重试策略；错误文本不能回显请求或密钥。限流进入可恢复错误，不能紧密循环重试。
3. **分页与截断**：只使用供应商明确支持的分页参数。达到上限且不能证明完整时拒绝发布，保留旧快照。公告目前达到2000条即报截断，不能猜一个 offset 继续请求。
4. **单位**：落库前明确价格、股数、成交额及百分比单位。现有日线、行业与交易所统计接口原始单位不同，不能复制同一乘数。金额记账使用十进制字符串；null 不转为0。
5. **日期**：区分交易日、报告期、公告日、采集时间及复权基准。财务累计值只能和同报告期比较；历史时点查询不能使用当时尚未披露的数据。当前行业成分不能当作历史成分。
6. **校验与发布**：检查股票归属、日期范围、重复行、有限数值及必填字段。全部通过后原子发布带来源、范围和哈希的快照。失败不得清空已有可用数据。明确空响应表示有效空结果还是尚未发布。
7. **缓存与恢复**：读取应校验内容哈希和身份。补充新快照类型的备份校验与恢复测试，不能只验证最新版本而漏掉保留的历史版本。页面自动更新应通过现有按需机制，避免全市场隐式下载。
8. **工具语义**：同步工具返回作业ID不代表完成。说明读取方式、日期、单位与权限；用户数据写入共享版本控制，交易账本保留幂等ID。只读工具与修改工具的 MCP annotations 必须真实。

## 固定样例验证

参考 `tests/python/test_provider.py`、`test_announcements.py`、`test_financials.py` 和 `test_portfolio.py`。至少覆盖正常、空数据、权限失败、限流、畸形字段、截断、错股票/日期、重复记录、旧快照保留、重启及备份恢复。

工具边界参考 `tests/node/workspace-mcp.test.mjs`：真实本地服务通过经过鉴权的 MCP 管道读写，同界面结果比较。固定样例不等于真实供应商验收；真实调用另记录接口、日期、成功/失败及脱敏结果，不提交 token 或个人资料。

契约修改后：

```powershell
node scripts/generate-contracts.mjs
.venv312/Scripts/python.exe scripts/contract-coverage.py
npm run typecheck
npm test
npm run test:python
```

coverage 只证明结构映射齐全，不能代替单位、分页或数值语义测试。
