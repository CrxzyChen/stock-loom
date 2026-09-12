import {randomBytes,timingSafeEqual} from 'node:crypto';
import {toolInputSchemas} from '../research-tools/tool-contracts.mjs';
import {matchesContract,matchesRpcResponse} from '../../packages/contracts/generated-runtime.mjs';
import {screenContext} from './screen-context.mjs';
import {validateDerivedResult} from '../research-tools/derived-results.mjs';

export class RunToolBroker{
  constructor({context,callService,maxCalls=32,ttlMs=180000,now=()=>Date.now()}){
    if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>100||!Number.isFinite(ttlMs)||ttlMs<1||ttlMs>600000)throw Error('Invalid tool budget');
    this.context=structuredClone(context);this.callService=callService;this.maxCalls=maxCalls;this.now=now;this.expires=now()+ttlMs;
    this.token=randomBytes(32).toString('hex');this.calls=0;this.revoked=false;this.audit=[];
  }
  revoke(){this.revoked=true}
  async checkedService(method,params){
    const result=await this.callService(method,params);
    if(this.revoked||this.now()>=this.expires)throw Error('工具会话已撤销或过期。');
    if(!matchesRpcResponse(method,result))throw Error('工具返回的数据格式不正确。');
    if(method==='bars.read'&&(result.snapshotId!==params.snapshotId||result.adjustment!==params.adjustment||result.offset!==params.offset))throw Error('工具返回的数据不属于请求范围。');
    if(method.startsWith('research.')&&result.runId!==params.runId)throw Error('工具返回的数据不属于请求范围。');
    if(method==='research.chart'&&result.instrumentId!==params.instrumentId)throw Error('工具返回的数据不属于请求范围。');
    return result;
  }
  async call(request){
    if(!request||Object.keys(request).sort().join(',')!=='arguments,runId,token,tool'||typeof request.token!=='string'||! /^[0-9a-f]{64}$/.test(request.token)||!timingSafeEqual(Buffer.from(request.token),Buffer.from(this.token))||request.runId!==this.context.runId||this.revoked||this.now()>=this.expires)throw Error('工具会话无效或已过期。');
    if(this.calls>=this.maxCalls)throw Error('工具调用次数已达上限。');
    if(!request.arguments||typeof request.arguments!=='object'||Array.isArray(request.arguments)||Buffer.byteLength(JSON.stringify(request.arguments))>(request.tool==='save_report'?180000:12000))throw Error('工具参数无效。');
    this.calls++;const entry={tool:request.tool,at:this.now(),state:'started'};this.audit.push(entry);
    try{
      const schema=toolInputSchemas.get(request.tool);
      if(!schema)throw Error('工具不在允许列表内。');
      if(!schema.safeParse(request.arguments).success)throw Error('工具参数无效。');
      const p=request.arguments;let result;
      if(request.tool==='search_instruments'){
        if(Object.keys(p).join(',')!=='query'||typeof p.query!=='string'||p.query.length>80)throw Error('搜索参数无效。');
        result=this.context.instruments.filter(x=>x.id.includes(p.query)||x.name.includes(p.query)).map(({id,name,exchange})=>({id,name,exchange}));
      }else if(request.tool==='screen_stocks'){
        result=screenContext(this.context,p);
      }else if(request.tool==='save_report'){
        if(Object.keys(p).join(',')!=='report'||!p.report||typeof p.report!=='object')throw Error('报告参数无效。');
        result=await this.checkedService('research.draft.save',{runId:this.context.runId,report:p.report});
      }else{
        const item=this.context.instruments.find(x=>x.id===p.instrumentId);if(!item)throw Error('股票不在本次研究范围内。');
        if(request.tool==='get_daily_bars'){
          if(Object.keys(p).sort().join(',')!=='adjustment,instrumentId,offset'||!['none','forward','backward'].includes(p.adjustment)||!Number.isInteger(p.offset)||p.offset<0||p.offset>6000)throw Error('日线参数无效。');
          if(!item.barSnapshotId)throw Error('本次研究缺少日线快照。');
          result=await this.checkedService('bars.read',{snapshotId:item.barSnapshotId,adjustment:p.adjustment,offset:p.offset});
        }else if(request.tool==='get_financials'){
          if(Object.keys(p).sort().join(',')!=='endpoint,instrumentId'||!['income','balancesheet','cashflow','daily_basic'].includes(p.endpoint))throw Error('财务参数无效。');
          const exists=Object.hasOwn(item.financials,p.endpoint);
          result=exists?item.financials[p.endpoint]:{manifest:null,items:[]};
          const contract={income:'ResearchIncome',balancesheet:'ResearchBalance',cashflow:'ResearchCashflow',daily_basic:'ResearchValuation'}[p.endpoint];
          if(!matchesContract(exists?contract:'EmptyFinancialData',result))throw Error('工具返回的财务数据格式不正确。');
          if(exists&&(result.manifest.instrumentId!==item.id||result.manifest.endpoint!==p.endpoint||result.items.some(row=>row.ts_code!==item.id)))throw Error('工具返回的财务数据不属于请求范围。');
        }else if(request.tool==='compute_indicators'){
          if(Object.keys(p).join(',')!=='instrumentId')throw Error('指标参数无效。');
          result=this.context.facts.filter(x=>x.instrumentId===item.id);
        }else if(request.tool==='create_chart'){
          if(Object.keys(p).join(',')!=='instrumentId')throw Error('图表参数无效。');
          const chart=await this.checkedService('research.chart',{runId:this.context.runId,instrumentId:item.id});
          if(chart.snapshotId!==item.barSnapshotId)throw Error('工具返回的数据不属于固定快照。');
          const {svg,...metadata}=chart;result=metadata;
        }else throw Error('工具不在允许列表内。');
      }
      validateDerivedResult(request.tool,result,p,this.context);
      if(this.revoked||this.now()>=this.expires)throw Error('工具会话已撤销或过期。');
      if(Buffer.byteLength(JSON.stringify(result))>256000)throw Error('工具结果超过大小限制。');
      entry.state='completed';return structuredClone(result);
    }catch(error){entry.state='failed';throw error}
  }
}
