function monthDays(year,month){return [31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][month-1]}
function parts(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('请选择完整的开始和结束日期。');
  const [year,month,day]=value.split('-').map(Number);
  if(year<1||month<1||month>12||day<1||day>monthDays(year,month))throw Error('日期无效，请检查年月日。');
  return {year,month,day};
}
export function yearsBefore(value,years){
  const {year,month,day}=parts(value),target=year-years;
  if(!Number.isInteger(years)||years<0||target<1)throw Error('年份范围无效。');
  return [String(target).padStart(4,'0'),String(month).padStart(2,'0'),String(Math.min(day,monthDays(target,month))).padStart(2,'0')].join('-');
}
export function syncDateRange(start,end){
  parts(start);parts(end);
  if(start>end)throw Error('开始日期不能晚于结束日期。');
  return {start:start.replaceAll('-',''),end:end.replaceAll('-','')};
}
