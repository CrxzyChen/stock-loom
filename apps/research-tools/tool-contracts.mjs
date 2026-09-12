import {z} from 'zod';
  const instrumentId=z.string().regex(/^\d{6}\.(SH|SZ|BJ)$/);
  const report=z.object({summary:z.string().min(1).max(6000),claims:z.array(z.object({text:z.string().min(1).max(3000),factIds:z.array(z.string().max(150)).min(1).max(20),values:z.array(z.object({factId:z.string().max(150),value:z.number().finite(),unit:z.string().max(100),date:z.string().max(30)}).strict()).min(1).max(20)}).strict()).max(50),limitations:z.array(z.string().min(1).max(2000)).max(30)}).strict();
export const researchTools=[
    ['search_instruments','搜索本次研究允许的股票。',z.object({query:z.string().max(80)}).strict()],
    ['get_daily_bars','读取固定快照的日线，每页最多 500 条。',z.object({instrumentId,adjustment:z.enum(['none','forward','backward']),offset:z.number().int().min(0).max(6000)}).strict()],
    ['get_financials','读取本次研究固定的财务数据，保留缺失和修订信息。',z.object({instrumentId,endpoint:z.enum(['income','balancesheet','cashflow','daily_basic'])}).strict()],
    ['compute_indicators','获取由确定性程序预先计算并带有事实 ID 的指标。',z.object({instrumentId}).strict()],
    ['create_chart','从本次研究固定快照生成前复权收盘价和成交量图，返回产物标识。',z.object({instrumentId}).strict()],
    ['screen_stocks','按同一数据日期筛选本次研究允许的股票，不扩大至全市场；缺失值和非正 PE 排除。',z.object({date:z.string().regex(/^\d{8}$/),conditions:z.array(z.object({field:z.enum(['close','amount','volume','ma5','ma20','ma60','pe','pb','total_mv']),operator:z.enum(['gt','gte','lt','lte']),value:z.number().finite()}).strict()).min(1).max(10)}).strict()]
    ,['save_report','校验并保存报告草稿；尚未发布。运行结束后的最终输出必须与此草稿相同，宿主核对用量及状态后才发布。',z.object({report}).strict()]
  ];

export const toolInputSchemas=new Map(researchTools.map(([name,,schema])=>[name,schema]));
