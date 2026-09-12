"""Deterministic, inert SVG artifacts bound to a research context."""
import hashlib
import html
import json
import os
import uuid
import math
from provider import ProviderError


class ResearchCharts:
    def create_research_chart(self,p):
        if set(p)!={'runId','instrumentId'}:raise ProviderError('INVALID_PARAMS','图表参数无效。')
        context=self.research_context({'runId':p['runId']})
        item=next((x for x in context['instruments'] if x['id']==p['instrumentId']),None)
        if not item:raise ProviderError('INSTRUMENT_SCOPE','股票不在本次研究范围内。')
        snapshot=item.get('barSnapshotId')
        if not snapshot:raise ProviderError('NO_DATA','本次研究没有日线快照。')
        first=self.read_bars({'snapshotId':snapshot,'adjustment':'forward','offset':0})
        page=self.read_bars({'snapshotId':snapshot,'adjustment':'forward','offset':max(0,first['total']-120)})
        bars=page['items']
        if not bars:raise ProviderError('NO_DATA','图表没有可用日线。')
        prices=[x['close'] for x in bars];volumes=[x['volume'] for x in bars]
        low,high=min(prices),max(prices);spread=high-low or max(abs(high)*.02,1)
        low-=spread*.05;high+=spread*.05
        if not math.isfinite(low) or not math.isfinite(high) or not math.isfinite(high-low):raise ProviderError('CHART_RANGE','图表数值超出可绘制范围。')
        xs=[64+i*788/max(1,len(bars)-1) for i in range(len(bars))]
        ys=[270-(x-low)/(high-low)*204 for x in prices]
        points=' '.join(f'{x:.2f},{y:.2f}' for x,y in zip(xs,ys))
        volume_max=max(volumes) or 1
        columns=''.join(f'<rect x="{x-2:.2f}" y="{352-v/volume_max*54:.2f}" width="4" height="{v/volume_max*54:.2f}" fill="#477384"/>' for x,v in zip(xs,volumes))
        title=html.escape(item['id']+' · forward adjusted close')
        svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="410" viewBox="0 0 900 410" role="img" aria-label="{title}">
<rect width="900" height="410" fill="#0d1118"/>
<g fill="#c9d1d9" font-family="Segoe UI, sans-serif" font-size="13"><text x="64" y="30">{title}</text>
<text x="12" y="70">{high:.2f}</text><text x="12" y="270">{low:.2f}</text>
<text x="64" y="292">Volume (shares)</text><text x="64" y="379">{bars[0]['date']}</text><text x="784" y="379">{bars[-1]['date']}</text></g>
<path d="M64 66H852M64 270H852M64 352H852" stroke="#303846" fill="none"/>
<polyline points="{points}" fill="none" stroke="#49cddd" stroke-width="2"/>{columns}
<text x="64" y="402" fill="#96a4b5" font-family="monospace" font-size="10">Snapshot {snapshot}</text></svg>'''
        artifact={'runId':p['runId'],'instrumentId':item['id'],'snapshotId':snapshot,'asOf':bars[-1]['date'],'adjustment':'forward','anchor':page['anchor'],'rows':len(bars),'mimeType':'image/svg+xml','svg':svg}
        encoded=json.dumps(artifact,ensure_ascii=False,sort_keys=True,allow_nan=False).encode('utf8')
        digest=hashlib.sha256(encoded).hexdigest();folder=self.root/'runs'/p['runId']/'charts';folder.mkdir(exist_ok=True)
        target=folder/(digest+'.json')
        if not target.exists():
            temporary=folder/(str(uuid.uuid4())+'.pending')
            with temporary.open('xb') as f:f.write(encoded);f.flush();os.fsync(f.fileno())
            os.replace(temporary,target)
        elif target.read_bytes()!=encoded:raise ProviderError('CORRUPT_CHART','既有图表校验失败。')
        return {'artifactId':digest,**artifact}
