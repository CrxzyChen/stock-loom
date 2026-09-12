import fs from 'node:fs/promises';
import path from 'node:path';

export const stockProjectInstructions=`# 股票项目

这是用户的股票工作目录。用户可以直接编辑本文件补充投资理念、关注范围和工作习惯。

## 数据与工具

- 工具可用性以本轮实际提供的工具清单为准，不沿用历史对话中“接口不存在”的判断。直接使用提供的工具名称及参数，不自行拼接命名空间或试探一串猜测的接口名。unsupported call 仅说明该次调用名称无效，不能据此断言没有写入能力。
- 手动持仓写入工具为 save_holding：先 get_holdings 读取 revision；新记录 revision=0。quantity 是持仓总股数，用户未提供时只询问股数，不猜数量。按指定交易日价格录入时核对未复权日线。成功后读取核对，不能把本地记账称为实际成交。
- 自选写入工具为 create_watchlist、add_watchlist_member、remove_watchlist_member、rename_watchlist。

- 数据过期或缺失时，使用 sync_stock_bars、sync_stock_financials、sync_index、sync_market_statistics 等工具提交同步，再用 get_sync_job 核对成功状态和结果。提交不等于同步成功；保留接口错误、截止日期和缺失，不把 shell 抓取被拒绝归因为全部数据源不可用。
- 股票 MCP 读取软件正在使用的数据服务。需要自选和持仓时查询工具，不要根据当前打开的页面猜测。
- 持仓是用户手动记录，检查持仓日期、股数及成本缺失。数量为 0 表示清仓记录。
- 日线、财务及估值数据可能滞后或缺失。保留快照标识、资料日期和来源，不将日线当作实时行情。
- read_index 和 read_market_statistics 读取与市场页面相同的本地快照；可按 snapshotId 重读引用版本。指数是点位，板块统计范围可能重叠，不能直接相加为全市场；缺失与无本地快照不代表零。按工具说明识别单位。

## 项目资料

- 对用户希望保留、后续需要复用的资料和分析，保存为本项目中的普通文件，按内容组织到 sources/ 或 notes/ 等清楚的目录。
- 保存分析时注明问题、数据来源及日期、主要发现和资料不足；区分原始材料、计算结果与推断。不强制输出模板。
- 继续已有问题时先查阅相关项目资料，核对是否过期，再决定是否补充查询。
- 用户的想法可以直接写入本文件或普通 Skill；不需要创建另一套隐藏的行动指南或记忆系统。
`;

export async function initializeStockProject(folder){
  await fs.mkdir(folder,{recursive:true});
  try{await fs.writeFile(path.join(folder,'AGENTS.md'),stockProjectInstructions,{flag:'wx'});return {created:true}}
  catch(error){if(error.code==='EEXIST')return {created:false};throw error}
}
