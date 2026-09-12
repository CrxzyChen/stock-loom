"""No process launch or termination: regression for stale Windows parent PID records."""
from probe_process_identity import select_descendants
rows=[{'pid':2,'parent':1},{'pid':3,'parent':2},{'pid':4,'parent':2},{'pid':5,'parent':4},{'pid':6,'parent':1},{'pid':7,'parent':6}]
times={1:100,2:110,3:120,4:90,5:130,6:None,7:140}
selected=select_descendants(rows,1,times.get)
assert [row['pid'] for row in selected]==[2,3]
assert [row['createdFileTime'] for row in selected]==[110,120]
assert [row['pid'] for row in select_descendants(rows,1,times.get,115)]==[2]
try:select_descendants(rows,99,times.get)
except AssertionError:pass
else:raise AssertionError('Missing root identity accepted')
print('PASS: valid descendants retained; recycled-parent and unavailable-identity branches excluded; missing root rejected.')
