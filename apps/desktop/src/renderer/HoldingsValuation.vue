<script setup lang="ts">
import UiButton from './UiButton.vue';
import type {Holding,HoldingsSummary,HoldingValuation} from '../../../../packages/contracts/generated';
defineProps<{summary:HoldingsSummary|null,busy:boolean}>();
defineEmits<{edit:[holding:Holding],open:[id:string]}>();
function format(value:string|null|undefined){if(value==null)return '—';const [whole,part='']=value.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+part.padEnd(2,'0')}
function reason(row:HoldingValuation){return {closed:'已清仓',missingPrice:'缺少行情',priceBeforeHolding:'价格早于持仓日期',dataError:'行情校验失败',valued:''}[row.status]}
</script>
<template><section v-if="summary" class="valuation" aria-label="持仓估值">
  <p>项目手动持仓 · 人民币 · 未录入现金</p>
  <div class="totals"><div><small>持仓市值（元）</small><strong>{{format(summary.marketValue)}}</strong></div><div><small>浮动盈亏（元）</small><strong>{{format(summary.floatingProfit)}}</strong></div><div><small>已估值部分（元）</small><strong>{{format(summary.pricedMarketValue)}}</strong></div></div>
  <p v-if="summary.missingPriceCount||summary.missingCostCount">{{summary.missingPriceCount}} 项缺少有效价格，{{summary.missingCostCount}} 项已估值持仓缺成本。汇总不完整的项目显示 —。</p>
  <p>按各股最新已存未复权收盘价估值，不是实时资产。占比仅以已估值持仓为分母，不含现金。浮盈＝市值－录入成本，不含分红、费用及已实现收益。</p>
  <div class="table-scroll"><table><thead><tr><th>股票 / 持仓日期</th><th>股数 / 成本价</th><th>收盘价 / 日期</th><th>市值（元）</th><th>浮动盈亏（元）</th><th>已估值占比</th><th/></tr></thead><tbody>
    <tr v-for="row in summary.items" :key="row.holding.instrumentId"><td><UiButton icon="chevron" @click="$emit('open',row.holding.instrumentId)">{{row.holding.name}}</UiButton><small>{{row.holding.instrumentId}} · {{row.holding.asOf}}</small></td><td>{{row.holding.quantity}}<small>{{row.holding.costPrice===null?'成本未知':format(row.holding.costPrice)+' 元'}}</small></td><td>{{format(row.price)}}<small>{{row.priceDate??'无行情'}}{{row.provider?' · Tushare':''}}</small><small v-if="reason(row)">{{reason(row)}}</small></td><td>{{format(row.marketValue)}}</td><td>{{format(row.floatingProfit)}}<small v-if="row.profitPercent!==null">{{row.profitPercent}}%</small></td><td>{{row.pricedHoldingsPercent===null?'—':row.pricedHoldingsPercent+'%'}}</td><td><UiButton icon="edit" icon-only :disabled="busy" @click="$emit('edit',row.holding)">编辑</UiButton></td></tr>
  </tbody></table></div>
</section></template>
<style scoped>
.totals{display:flex;flex-wrap:wrap;gap:28px;padding:12px 0 18px;border-bottom:1px solid var(--line)}.totals div{display:grid;gap:6px}.totals strong{font-size:1.692308rem;font-variant-numeric:tabular-nums}.valuation p,.valuation small{color:var(--muted)}.valuation p{line-height:1.6;font-size:0.923077rem}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums;white-space:nowrap}td small{display:block;margin-top:4px;font-size:0.846154rem}
</style>
