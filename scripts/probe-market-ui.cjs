const {app}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]||'');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Isolated fixture required');
const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json')));assert.equal(fixture.synthetic,true);
app.setPath('userData',directory);app.disableHardwareAcceleration();const record={synthetic:true,passed:false};let started=false;
const timer=setTimeout(()=>finish('timeout'),25000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=s=>win.webContents.executeJavaScript(s);
    const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(${s}){clearInterval(timer);resolve(true)}else if(++n>100){clearInterval(timer);reject(Error('UI wait timeout'))}},50)})`);
    await wait(`document.querySelector('.connection.ready')`);
    const previousPalette={canvas:'#090b10',surface:'#0d1118',raised:'#111721',overlay:'#151c27',line:'rgba(255,255,255,.075)','line-strong':'rgba(255,255,255,.13)',text:'#c9d1d9',muted:'#96a4b5',faint:'#465361',accent:'#49cddd','accent-soft':'rgba(73,205,221,.1)',success:'#64d98b',warning:'#e7b85d',danger:'#f0737e'};
    record.palette=await js(`(()=>{const expected=${JSON.stringify(previousPalette)},result={};const sample=document.createElement('span');document.body.append(sample);for(const [name,value] of Object.entries(expected)){sample.style.color=value;const before=getComputedStyle(sample).color;sample.style.color='var(--'+name+')';result[name]={expected:before,actual:getComputedStyle(sample).color}}sample.remove();return result})()`);
    for(const value of Object.values(record.palette))assert.equal(value.actual,value.expected,'Product palette changed');
    await js(`(async()=>{const input=document.querySelector('#market-query');input.value='000001.SZ';input.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();input.form.requestSubmit()})()`);
    await wait(`document.querySelector('.stock-matches button')`);await js(`document.querySelector('.stock-matches button').click()`);
    const wideMa=process.argv.includes('--wide-ma');
    await wait(`document.querySelector('.quote')?.textContent.includes('收 ${wideMa?'10.00':'11.10'}')`);
    const candles=`document.querySelectorAll('.chart-shell svg>g[stroke][fill]').length`;
    if(wideMa){
      await js(`{const select=document.querySelector('.chart-controls select');select.value='60';select.dispatchEvent(new Event('change',{bubbles:true}))}`);
      await wait(`${candles}===60`);
      record.maBounds=await js(`Array.from(document.querySelectorAll('.chart-shell svg>path'),p=>{const r=p.getBBox();return {y:r.y,height:r.height}})`);
      assert.equal(record.maBounds.length,3);for(const r of record.maBounds){assert.ok(r.y>=35&&r.y+r.height<=310)}
      const axis=await js(`Array.from(document.querySelectorAll('.chart-shell svg>g>text'),e=>Number(e.textContent))`);
      assert.ok(axis[0]>98.5);assert.ok(axis.at(-1)<9);record.axis=axis;record.fullHistoryMaVisible=true;
      win.setContentSize(1280,800);await js(`document.querySelector('.chart-shell').scrollIntoView()`);await new Promise(r=>setTimeout(r,100));
      fs.writeFileSync(path.join(directory,'ma-extent.png'),(await win.webContents.capturePage()).toPNG());finish();return;
    }
    assert.equal(await js(candles),120);
    assert.equal(await js(`Array.from(document.querySelectorAll('.chart-shell svg>path')).filter(p=>p.getAttribute('d')).length`),3);
    record.maPathsPresent=true;
    for(const [mode,close] of [['backward','22.20'],['forward','11.10']]){
      await js(`{const select=Array.from(document.querySelectorAll('.market-controls select')).find(s=>s.querySelector('option[value="none"]'));select.value='${mode}';select.dispatchEvent(new Event('change',{bubbles:true}))}`);
      await wait(`document.querySelector('.quote')?.textContent.includes('收 ${close}')`);
    }
    assert.ok(await js(`document.querySelector('.source-note').textContent.includes('前复权锚定')`));record.adjustmentQuotes=true;
    await js(`{const select=document.querySelector('.chart-controls select');select.value='60';select.dispatchEvent(new Event('change',{bubbles:true}))}`);
    await wait(`${candles}===60`);
    await js(`{const select=document.querySelector('.chart-controls select');select.value='10000';select.dispatchEvent(new Event('change',{bubbles:true}))}`);
    await wait(`${candles}===130`);record.rangeCounts=true;
    await js(`document.querySelector('.chart-shell svg').focus()`);
    for(const [key,day,close] of [['Home',fixture.first,'5.10'],['End',fixture.last,'11.10']]){
      win.webContents.sendInputEvent({type:'keyDown',keyCode:key});win.webContents.sendInputEvent({type:'keyUp',keyCode:key});
      await wait(`document.querySelector('.quote')?.textContent.includes('${day}')&&document.querySelector('.quote')?.textContent.includes('收 ${close}')`);
    }
    record.keyboardFirstLast=true;
    assert.ok(await js(`Array.from(document.querySelectorAll('.chart-shell svg text')).every(t=>getComputedStyle(t).stroke==='none')`));record.labelsWithoutIconStroke=true;
    assert.ok(await js(`document.querySelector('.quote').textContent.includes('成交量 200 股')&&document.querySelector('.quote').textContent.includes('成交额 3,000 元')`));record.units=true;
    record.layouts=[];
    for(const layout of [{name:'1440',width:1440,height:900,zoom:1},{name:'1280',width:1280,height:800,zoom:1},{name:'1024',width:1024,height:768,zoom:1},{name:'860',width:860,height:600,zoom:1},{name:'zoom125',width:1280,height:800,zoom:1.25},{name:'zoom150',width:1280,height:800,zoom:1.5}]){
      win.setContentSize(layout.width,layout.height);win.webContents.setZoomFactor(layout.zoom);
      await js(`document.querySelector('.chart-shell').scrollIntoView()`);await new Promise(resolve=>setTimeout(resolve,100));
      const geometry=await js(`(()=>{const svg=document.querySelector('.chart-shell svg'),r=svg.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,chartWidth:r.width,chartHeight:r.height,renderedLabelPx:parseFloat(getComputedStyle(svg.querySelector('text')).fontSize)*Math.min(r.width/920,r.height/450)}})()`);
      assert.equal(geometry.scrollWidth,geometry.width);assert.ok(geometry.renderedLabelPx>=10.9&&geometry.renderedLabelPx<=11.1);
      const screenshot=path.join(directory,layout.name+'.png');fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
      record.layouts.push({...layout,...geometry,screenshot});
    }
    finish();
  })().catch(e=>finish(String(e.stack||e))));
});
require(path.resolve('dist/main/main.cjs'));
