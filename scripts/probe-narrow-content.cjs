const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function(win,selector,directory){
 const js=s=>win.webContents.executeJavaScript(s,true);
 await js(`document.querySelector('[aria-label="收起 Codex"]')?.click()`);
 const results=[];
 for(const [width,zoom] of [[1024,1],[860,1],[1024,1.5]]){
  win.setContentSize(width,768);win.webContents.setZoomFactor(zoom);
  for(let i=0;i<60;i++){if(await js(`Math.abs(innerWidth-${width/zoom})<=1`))break;await new Promise(r=>setTimeout(r,50))}
  assert.ok(await js(`Math.abs(innerWidth-${width/zoom})<=1`),'viewport did not reach requested zoom: '+JSON.stringify({width,zoom,actual:await js('innerWidth'),bounds:win.getContentSize(),factor:win.webContents.getZoomFactor()}));
  const state=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),area=e.closest('.tab-content');return {viewport:innerWidth,contentWidth:r.width,bodyFits:document.documentElement.scrollWidth<=innerWidth,contentFits:area.scrollWidth<=area.clientWidth+1}})()`);
  assert.ok(state.bodyFits,selector+' page overflow');assert.ok(state.contentFits,selector+' content overflow');
  const screenshot=path.join(directory,'narrow-'+width+'-'+zoom+'.png');fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());results.push({width,zoom,...state,screenshot});
 }
 win.webContents.setZoomFactor(1);win.setContentSize(1440,900);return results;
};
