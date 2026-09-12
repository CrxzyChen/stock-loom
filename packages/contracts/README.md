# 共享接口契约

先修改 schema.json，再运行 `node scripts/generate-contracts.mjs` 与 `.venv312/Scripts/python.exe scripts/contract-coverage.py`。不要直接修改 generated.ts、generated-runtime.mjs 或 apps/data-service/generated_contracts.py。桌面和数据服务构建用 `--check` 拒绝过期生成文件。

当前 Store.dispatch 的 71 个 RPC 均有请求与响应映射。ServiceClient 和 Python serve 在公共 RPC 边界执行生成的运行时校验，包括 health 启动握手。覆盖脚本检查映射与实际 dispatch 分支一致，拒绝缺少任何一侧契约的新增方法；CI 文件已配置生成检查、覆盖检查、公共边界专项与类型检查，尚无远程运行记录。

结构映射覆盖不等于全部验收完成。日期/哈希格式、文本长度、引用一致性、状态迁移及幂等等约束继续由领域代码校验。运行时对未知方法保留原有 METHOD_NOT_FOUND 路径；不能把未知方法视为已校验接口。

desktop.ts 重导出已生成类型，并保留尚未迁移的 Electron bridge 声明。统一响应错误与来源元数据、完整 IPC/Agent/MCP 契约以及真实接口验收仍待完成。证据见 ../../validation/contract-health.md 及相关 contract-* 记录。历史记录中的较低覆盖数字对应当时的状态。

health 另返回生成的 CONTRACT_FINGERPRINT，Main 比对成功后才进入 ready。请始终同时构建桌面与数据服务；schema 指纹不是二进制签名。详见 ../../validation/contract-handshake.md。

当前私有 RPC 为 v2，请求与响应使用 requestId；拒绝旧 id/v1，不提供混用兼容。详见 ../../validation/protocol-v2-request-id.md。统一来源元数据尚未完成。

v2 现要求 dataAsOf/sourceVersion（可空），通过 callWithMetadata 读取。来源映射与空值语义见 ../../validation/rpc-source-metadata.md；尚未覆盖所有数据域及上层消费。
