# Round 4 交付验收记录

2026-09-13 · 18/18项开发与验证完成，待用户验收。

交付版本 [v0.2.0-beta.6](https://github.com/CrxzyChen/stock-loom/releases/tag/v0.2.0-beta.6)，源码 `e144f2b05749404de06e8c8cd786834c991ce690`。安装器327063523字节，SHA256 `61b92520a79cf64ed383fe87466e35c4d313640f8fd601d269bc803fa08f2beb`；独立Ed25519清单验证通过，GitHub资产digest一致。仅支持当前schema 10。后续提交仅更新交付文档。

## 逐项核验

| 项目 | 实现与验证 | 证据（validation目录，除特别注明） |
| --- | --- | --- |
| U-01 | 发布基线、原始版本首次手动引导、完整保留范围已记录 | docs/round4-update-baseline.md |
| U-02 | 固定公钥验证仓库绑定清单；坏签名、未知密钥、降级及坏包拒绝；发布私钥不打包 | round4-beta6-artifacts.json；tests/node/update-signatures.test.mjs、installer-signature.test.mjs |
| U-03 | 真实Beta.4从公开发布源完整下载Beta.6并验签；此前备份失败保留旧程序，可重试 | round4-update-ui-download-beta6.json；旧失败round4-update-ui-install.json |
| U-04 | 应用内备份退出安装，NSIS完成，实际安装Beta.6启动；原数据离线比对与账户可用 | round4-update-ui-install-beta6.json、round4-update-backup-beta6.json、round4-installed-after.json、round4-preservation-after.json |
| W-01 | Playwright MCP 0.0.80独立Edge：读取、输入、点击、下载以及公开网页读取 | round4-browser-probe.json；docs/round4-browser-selection.md |
| W-02 | 开关持久化、独立profile、原生Codex发现、停止重连与包内进程生命周期 | round4-browser-ui.json、round4-browser-native.json、round4-browser-packaged.json |
| W-03 | 可见浏览器人工接管流程、重启登录态、拒绝访问保留资料、重复下载恢复、停止 | round4-browser-login.json（受控登录样例，未自动化真实认证）；项目skill及测试 |
| W-04 | 真实模型两轮：访问巨潮披露，写来源/笔记，再次从本地读取；未新增agent编排 | round4-model-browser.json、round4-web-research-source.json、round4-model-links.json |
| R-01 | 普通文件、相对链接与来源字段；路径边界、符号链接拒绝 | docs/round4-project-artifacts.md；tests/node/project-artifacts.test.mjs |
| R-02 | Markdown/图片/PDF/CSV/TSV/XLSX只读预览；分页、损坏及大文件处理；窄屏无外溢 | round4-documents-ui.json、round4-packaged-pdf.json（实际230页年报） |
| R-03 | 点击引用复用Tab，不自动抢焦点；更新、删除、外部链接区分 | round4-copilot-links.json、round4-model-links.json |
| R-04 | 缓存日期、采集时间、缺失/权限错误；按需增量、去重和退避 | round4-freshness-ui.json；tests/python/test_demand_data.py；reference-permissions.json、announcement-permissions.json |
| R-05 | 自选爱仕达进入详情，20260911行情日期一致；打开来源、笔记及回链 | round4-stock-journey.json（用户库只读副本、真实回答回放，模型实际执行另见W-04） |
| D-01 | CSV映射预览、校验、原子提交、重复去重；UI/MCP共用账本 | round4-trade-import-ui.json、round4-trade-import-broker.json |
| D-02 | 未知现金不作零；入出金、费用及交易影响、已实现/浮动盈亏；最终冻结服务重启和恢复 | round4-cash-ui.json、round4-packaged-cash.json、round3-packaged-ledger.json |
| D-03 | 恢复合并、不重叠、重试、关联会话、提醒去重及偏好；退出停止、后台运行 | round4-scheduler-desktop.json、round4-scheduler-notices-ui.json；tests/node/task-scheduler.test.mjs |
| D-05 | 本应用登录账户原生额度接口；窗口比例/重置/缓存失效，设置与状态栏展示 | round4-account-usage-live.json、round4-account-usage-ui.json、round4-installed-after.json |
| D-04 | 三条旅程、最终资产与源码、依赖许可、版本及限制已核对 | 本文、round4-beta6-artifacts.json、round4-dependency-delta.json、round4-regression.json |

## 数据保留与回归

真实升级新增归档含136文件，ZIP及各文件哈希通过。升级后实际界面账户额度ready、2个桶，模型列表6个，自选1组、持仓1项、布局值一致。正常退出后核对10张数据表、11项目文件、25会话正文、2凭证文件及既有配置一致，股票数据库完整性通过。Chromium LevelDB文件会正常重写，布局使用实际存储语义比对。凭证不包含在股票归档中，其可用性和原文件保留另行验证。

清理后199项Node测试通过；Python共207项，206通过、1项因创建符号链接权限跳过，重解析点拒绝另有测试。类型检查、桌面构建、最终Windows打包与包内真实Codex MCP探针通过。最终发布包服务SHA256 `de697d2eeec1c48d790a2b4833ebaa7f04f270a911f3ea5611452e5735f48371`，持仓与现金计算、幂等、重启及备份恢复再次通过。

新增/变更生产依赖72项、未变原生库21项复核通过；不把增量许可复核扩大为所有历史二进制来源已得到独立证明。细节见round4-dependency-review.md与对应证据。

## 明确边界

- 仅一份本地Codex索引观察到SQLite读取错误，根因未确定；副本重建可读25会话，真实索引未改动。升级保留会话正文，不声称该错误已修复或每个历史会话均可打开。此个例单独记录。
- 按用户维护策略，早期非正式schema与旧独立API模式不再迁移；schema 10继续可用，不支持格式明确拒绝且不改写原文件。历史报告文件保留，旧研究/复盘执行链移除。
- 浏览器使用独立Edge profile，不继承Codex Desktop私有浏览器，也不默认连接用户已有浏览器。登录流程使用受控样例验证；真实网站认证由用户操作。
- 调度桌面验证使用模拟时间/电源事件，未执行真实OS休眠。系统通知已提交，不声称用户已看到通知。
- 盈利前无Windows商业代码签名；独立更新清单签名保留。不绕过系统安全提示。
- 异机安装测试按用户要求暂缓。行情为接口可用快照，权限不足明确反馈；不提供券商下单。


## 交付后发现：schema 9 启动失败无提示

用户报告0.2.0-beta.6遇到schema 9数据服务拒绝后直接退出。此前真实升级验证的数据为schema 10，不覆盖schema 9；早期格式不迁移是既定维护策略，但静默退出属于缺陷。源码现通过health RPC传递启动域错误，主程序停止失败服务后显示错误及发行页入口，用户确认后退出。不会删除数据库、修改user_version或自动切换空资料。12项针对性Node测试与类型检查通过，其中schema 9启动拒绝且数据库字节不变。此修复尚未进入已发布Beta.6安装包。
