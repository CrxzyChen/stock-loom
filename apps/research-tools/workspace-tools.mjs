import {z} from 'zod';
const instrumentId=z.string().min(1).max(30),endpoint=z.enum(['income','balancesheet','cashflow','daily_basic']);
const date=z.string().regex(/^\d{8}$/),stockCode=z.string().regex(/^\d{6}\.(SH|SZ|BJ)$/);
const range={start:date,end:date};
const syncNote='提交后台同步任务，使用应用保存的 Tushare 凭证。返回任务 ID 不代表成功；用 get_sync_job 查询状态，成功后再读取快照。会消耗数据接口额度；勿重复提交或高频轮询。日期格式 YYYYMMDD，日线不是实时行情。';
const ledgerDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/),money=z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,8})?$/);
const ledgerEvent=z.union([z.object({kind:z.enum(['buy','sell']),date:ledgerDate,quantity:z.number().int().positive().max(1000000000),price:money,fee:money}).strict(),z.object({kind:z.literal('balance'),date:ledgerDate,quantity:z.number().int().nonnegative().max(1000000000),price:money.nullable()}).strict()]);
export const workspaceTools=[
  ['list_reference_datasets','列出可同步和读取的公司基础资料、风险名单与经营信息。包含字段及单位。','reference.catalog',z.object({}).strict()],
  ['read_reference_data','读取本地公司资料快照，分页50行；日期和股票须与同步请求一致。历史管理层不代表现任，空结果不代表没有风险。','reference.read',z.object({endpoint:z.enum(["stock_company","namechange","stk_managers","stk_rewards","stk_premarket","stock_st","st","stock_hsgt","bse_mapping","new_share","bak_basic","forecast","express","fina_indicator","fina_mainbz"]),instrumentId:z.string().max(30),...range,offset:z.number().int().min(0).max(10000).default(0)}).strict()],
  ['sync_reference_data','同步公司资料、曾用名、管理层、薪酬、ST、沪深股通、代码对照、IPO、历史列表、预告快报、财务指标及产品主营。daily/connect模式取end日；rewards取end报告期；history/company/mapping不按日期过滤；new_share/bse_mapping可用空股票代码读取整体名单；最多四年，达到上限拒绝覆盖。'+syncNote,'reference.sync',z.object({endpoint:z.enum(["stock_company","namechange","stk_managers","stk_rewards","stk_premarket","stock_st","st","stock_hsgt","bse_mapping","new_share","bak_basic","forecast","express","fina_indicator","fina_mainbz"]),instrumentId:z.string().max(30),...range}).strict()],
  ['read_industry_overview','读取与市场页相同的申万2021一级行业指数收盘行情、涨跌幅、成交额（元）和当前成分数量。官方指数收益，不是成分平均涨跌；带数据日期。','sectors.summary',z.object({}).strict()],
  ['read_industry_members','分页读取当前申万一级行业成分股，每页50条，collectedAt是成分采集时间，不代表历史成分。','sector.members',z.object({sectorId:z.string().regex(/^\d{6}\.SI$/),offset:z.number().int().min(0).max(10000).default(0)}).strict()],
  ['read_industry_history','读取申万行业指数日线快照。成交量为股、成交额为元，日线非实时；无缓存返回null。','sector.history',z.object({sectorId:z.string().regex(/^\d{6}\.SI$/)}).strict()],
  ['sync_industries','同步指定交易日申万一级行业行情与当前成分，sw_daily需要5000积分。'+syncNote,'sectors.sync',z.object({date}).strict()],
  ['sync_industry_history','同步指定申万行业指数历史日线。'+syncNote,'sector.history.sync',z.object({sectorId:z.string().regex(/^\d{6}\.SI$/),...range}).strict()],
  ['list_scheduled_tasks','查看当前项目的定时任务及运行记录。应用退出后不会执行。','scheduler.list',z.object({}).strict()],
  ['save_scheduled_task','仅在用户要求定时执行时创建或修改任务。应用运行或驻留托盘时生效，退出期间不补跑。工作日是周一至周五，不保证交易日。id 省略时新建，修改时保留原 id。使用当前模型连接；默认请求批准。秒或分钟间隔用 frequency=interval、intervalSeconds（30–86400），例如每30秒为30，每5分钟为300。灵活日历调度用 frequency=cron、cron 字符串，支持5字段（分时日月周）或6字段（秒分时日月周），每30秒为 */30 * * * * *，按 timezone 解释。无需把高频请求改成每小时；上轮未结束会跳过重叠触发。','scheduler.save',z.object({id:z.string().uuid().optional(),name:z.string().min(1).max(80),prompt:z.string().min(1).max(10000),frequency:z.enum(['daily','weekdays','hourly','interval','cron']),cron:z.string().min(1).max(200).optional(),intervalSeconds:z.number().int().min(30).max(86400).optional(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('00:00'),timezone:z.string().min(1).max(100),enabled:z.boolean(),permissionMode:z.literal('ask').default('ask')}).strict()],
  ['delete_scheduled_task','按用户要求删除定时任务，不删除已产生的会话。','scheduler.remove',z.object({id:z.string().uuid()}).strict()],
  ['sync_stock_catalog','同步股票目录。'+syncNote,'catalog.sync',z.object({exchange:z.enum(['SSE','SZSE','BSE']),status:z.enum(['L','D','P'])}).strict()],
  ['sync_trade_calendar','同步指定年交易日历。'+syncNote,'calendar.sync',z.object({exchange:z.enum(['SSE','SZSE']),year:z.number().int().min(1990).max(2100)}).strict()],
  ['sync_stock_bars','同步一只股票指定日期范围的日线。'+syncNote,'bars.sync',z.object({instrumentId:stockCode,...range}).strict()],
  ['sync_stock_financials','同步一只股票指定范围的财报或每日估值。'+syncNote,'financials.sync',z.object({instrumentId:stockCode,endpoint,...range}).strict()],
  ['sync_index','同步指数日线。'+syncNote,'index.sync',z.object({indexId:z.enum(['000001.SH','399001.SZ','399006.SZ','000300.SH']),...range}).strict()],
  ['sync_market_statistics','同步交易所板块统计。'+syncNote,'market.sync',z.object({marketId:z.enum(['SH_A','SZ_A','SH_STAR','SZ_GEM','SZ_STOCK']),...range}).strict()],
  ['get_sync_job','查询同步任务状态、结果或接口失败原因。queued/running 尚未完成；仅 succeeded 表示成功；失败时保留已有快照并说明原因。','jobs.get',z.object({id:z.string().min(1).max(100)}).strict()],
  ['read_index','读取与市场页面相同的指数日线快照，含截至日期、来源、保存时间。点位不是股票价格；成交量为股、成交额为元，不能替代全市场成交。无本地快照返回 null。','index.read',z.object({indexId:z.enum(['000001.SH','399001.SZ','399006.SZ','000300.SH']),snapshotId:z.string().min(1).max(200).optional()}).strict()],
  ['read_market_statistics','读取与市场页面相同的交易所板块统计快照。SH_A沪市A股、SZ_A深市A股、SH_STAR科创板、SZ_GEM创业板、SZ_STOCK深圳全部股票（含A/B股），endpoint字段注明来源；范围可能重叠，不加总或推算全市场。股本/成交量为股，市值/成交额为元，成交笔数为笔，tr为百分数、pe为倍数。缺失保持null，无快照返回null。','market.read',z.object({marketId:z.enum(['SH_A','SZ_A','SH_STAR','SZ_GEM','SZ_STOCK']),snapshotId:z.string().min(1).max(200).optional()}).strict()],
  ['get_portfolio','读取手动持仓、账本成本、已实现盈亏、行业分布及最新未复权收盘价估值，与持仓界面相同。priceDates注明混合日期；行业采用当前申万成分，缺失保留未分类。已实现盈亏仅涵盖已记录交易。保留价格/持仓日期和缺失；占比分母仅为有有效价格的持仓，不含现金，不是完整账户仓位。','holdings.summary',z.object({}).strict()],
  ['search_stocks','搜索本地股票目录；结果与软件界面共用。','instruments.search',z.object({query:z.string().max(80),offset:z.number().int().nonnegative().default(0)}).strict()],
  ['list_watchlists','查询用户当前自选分组。','watchlists.list',z.object({}).strict()],
  ['create_watchlist','按用户要求创建自选分组。添加自选时若没有分组，可直接创建“默认自选”，再添加股票，无需让用户手动操作。只修改项目自选，不下单。','watchlists.create',z.object({name:z.string().trim().min(1).max(40)}).strict()],
  ['add_watchlist_member','将股票加入指定自选分组，与软件我的股票面板共用数据。先搜索确认股票代码并查询分组；没有分组时创建默认自选。只修改本地自选，不购买股票。返回更新后的分组成员，核对目标代码后再报告成功。','watchlists.add',z.object({listId:z.string().min(1).max(100),instrumentId:stockCode}).strict()],
  ['remove_watchlist_member','按用户要求从指定自选分组移除股票，不改变持仓，不卖出股票。','watchlists.remove',z.object({listId:z.string().min(1).max(100),instrumentId:stockCode}).strict()],
  ['rename_watchlist','按用户要求重命名自选分组，保留其成员。','watchlists.rename',z.object({listId:z.string().min(1).max(100),name:z.string().trim().min(1).max(40)}).strict()],
  ['get_watchlist','读取当前自选组的全部股票。','watchlists.members',z.object({listId:z.string().max(100)}).strict()],
  ['read_position_ledger','读取本地持仓账本、修订号及买卖/调整历史。active 为当前有效记录；包含被更正或作废的历史。不是券商成交。','ledger.read',z.object({instrumentId:stockCode}).strict()],
  ['write_position_ledger','按用户要求记录本地买卖或余额调整，不下单。先 read_position_ledger 取得 revision；buy/sell 的 quantity 是本次股数，price、fee 为十进制字符串，缺少数量或费用应询问，不能猜测。balance 是调整总股数和每股成本，不是交易。新操作使用唯一 requestId（8至100位字母数字下划线或短横线），重试同一操作保留全部参数和 requestId，修改内容需新 ID。新增 supersedes=null、voided=false；更正指定当前有效记录 ID；作废指定 ID、event=null、voided=true。冲突重新读取，不盲目覆盖。成功后核对余额再报告。','ledger.write',z.object({instrumentId:stockCode,requestId:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),revision:z.number().int().nonnegative(),event:ledgerEvent.nullable(),supersedes:z.string().nullable(),voided:z.boolean()}).strict()],
  ['save_holding','按用户要求创建或更新本地手动持仓，不是券商交易，不会买入或卖出。quantity 是更新后的总股数，不是增量；缺少股数时必须询问用户，不得猜测。先用 get_holdings 读取已有记录；新记录 revision=0，修改使用读取到的 revision，冲突时重新读取，不盲目覆盖。costPrice 是每股成本的十进制字符串，未知为 null；asOf 为 YYYY-MM-DD。用户要求按某日收盘价记录时用 read_bars 的 none（未复权）核对对应交易日，不能把假设成本说成实际成交价。quantity=0 仅用于用户明确要求清仓。返回保存后的记录后再报告成功。','holdings.save',z.object({instrumentId:stockCode,quantity:z.number().int().min(0).max(1000000000),costPrice:z.string().regex(/^(0|[1-9]\d{0,7})(\.\d{1,8})?$/).nullable(),asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),revision:z.number().int().nonnegative()}).strict()],
  ['get_holdings','读取用户手动记录的持仓，含日期、股数、可空成本价和修订号。数量0表示清仓，不代表实时券商持仓。','holdings.list',z.object({}).strict()],
  ['list_bar_snapshots','查询某股票已保存的日线快照及数据时间。','bars.versions',z.object({instrumentId}).strict()],
  ['read_bars','按快照读取日线；这是历史日线数据，不是实时行情。','bars.read',z.object({snapshotId:z.string().max(200),adjustment:z.enum(['none','forward','backward']),offset:z.number().int().nonnegative().default(0)}).strict()],
  ['read_financials','读取本地财务或估值数据，保留数据来源及缺失信息。','financials.read',z.object({instrumentId,endpoint,snapshotId:z.string().max(200).optional()}).strict()],
  ['list_financial_snapshots','查询财务数据版本。','financials.snapshots',z.object({instrumentId,endpoint}).strict()],
  ['compute_bar_indicators','计算指定日线快照最后一个交易记录的收盘价、MA5/20/60和相邻记录涨跌幅。返回日期、复权口径、来源及不足；不是实时报价或投资回报率。',null,z.object({snapshotId:z.string().min(1).max(200),adjustment:z.enum(['none','forward','backward'])}).strict()]
];
