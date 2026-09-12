"""Inventory literal RPC dispatch branches; this does not certify semantic coverage."""
import ast
import json
import pathlib
import sys

root=pathlib.Path(__file__).resolve().parents[1]
tree=ast.parse((root/'apps/data-service/main.py').read_text(encoding='utf-8'))
store=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Store')
dispatch=next(n for n in store.body if isinstance(n,ast.FunctionDef) and n.name=='dispatch')
methods=set()
for node in ast.walk(dispatch):
    if not isinstance(node,ast.Compare) or not isinstance(node.left,ast.Name) or node.left.id!='method':continue
    if len(node.ops)!=1:raise ValueError('Unsupported dispatch comparison')
    value=ast.literal_eval(node.comparators[0])
    if isinstance(node.ops[0],ast.Eq) and isinstance(value,str):methods.add(value)
    elif isinstance(node.ops[0],ast.In) and isinstance(value,(tuple,list)) and all(isinstance(x,str) for x in value):methods.update(value)
    else:raise ValueError('Unsupported dispatch comparison')
schema=json.loads((root/'packages/contracts/schema.json').read_text(encoding='utf-8'))
requests=schema.get('x-rpc-requests',{});responses=schema.get('x-rpc-responses',{})
if (set(requests)|set(responses))-methods:raise ValueError('Mapped method missing from dispatch')
rows=[{'method':m,'request':requests.get(m),'response':responses.get(m)} for m in sorted(methods)]
complete=sum(bool(r['request'] and r['response']) for r in rows)
missing=[r['method'] for r in rows if not r['request'] or not r['response']]
if missing:raise ValueError('RPC methods require request and response contracts: '+', '.join(missing))
result={'scope':'Python Store.dispatch RPC only; does not include Electron IPC or Agent tools','methods':len(rows),'bothMapped':complete,'rows':rows}
content=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
file=root/'packages/contracts/coverage.json'
if '--check' in sys.argv:
    if not file.exists() or file.read_text(encoding='utf-8')!=content:raise ValueError('RPC coverage inventory is stale; run scripts/contract-coverage.py')
else:file.write_text(content,encoding='utf-8')
print(f'RPC inventory: {complete}/{len(rows)} mapped for both request and response; structural mapping only, not semantic certification')
