# 更新签名恢复：beta.7

原 stockloom-2026 私钥按丢失处理。beta.7 改信任 stockloom-2026-r2；无法通过新签名使旧客户端自动信任新公钥。beta.6 用户需从 GitHub 发布页手动下载安装 beta.7，不删除原资料。数据库仍为 schema 10。

新在线发布密钥使用 Windows CurrentUser DPAPI，保存在发布用户 LocalAppData/StockLoomRelease/update-2026-r2.dpapi.json。不得提交仓库或上传发布资产。

独立恢复材料通过 scripts/backup-update-key.mjs 创建：PKCS#8 AES-256-CBC 加密备份与随机恢复口令分别放在仓库外不同目录。恢复时无需原 DPAPI 身份；已用保存的备份和口令重新加载密钥并完成签名/验签。未执行异机安装测试。

维护者应把加密备份另存至离线介质或可靠备份服务，把恢复口令放入独立密码管理器。目前两份材料仍位于本机，不能声称已具备整机丢失后的恢复能力。不得把二者一起公开、发入对话或提交版本控制。

后续发布固定使用 stockloom-2026-r2 及现有私钥，不重新生成。发布前检查备份存在，清单签名使用客户端公钥复验，安装包哈希必须与清单一致。
