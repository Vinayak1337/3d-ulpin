"""Generate synthetic originals for the connected neighbourhood. No computed results."""
import csv, json
from pathlib import Path
from generate import rectangle, feature, make_plan
from reportlab.pdfgen.canvas import Canvas
ROOT=Path(__file__).resolve().parent/'registry'
ROOT.mkdir(exist_ok=True)
frame={'id':'LOCAL-NANDAN-DEMO','horizontalUnit':'m','verticalUnit':'m','benchmark':'BM-NANDAN-SYNTHETIC'}
features=[feature('PA','Parcel A','parcel',rectangle(0,0,12,16)),feature('PB','Parcel B','parcel',rectangle(12,0,24,16))]
levels=[]
for building,x in [('A',2),('B',12)]:
    features.append(feature(building,f'Building {building}','building',rectangle(x,2,x+10,12)))
    for f in range(2):
        for suffix,left,right,kind in [('01',0,4,'unit'),('02',6,10,'unit'),('C',4,6,'common')]:
            alias=f'{building}-{f+1}{suffix}'
            features.append(feature(alias,f'{"Apartment" if kind=="unit" else "Common hall"} {alias}',kind,rectangle(x+left,2,x+right,12),f'{building} / {"Ground" if f==0 else "Upper"}'))
            levels.append([alias,f*3,(f+1)*3,'m',frame['benchmark'],'Synthetic authored level schedule'])
features.extend([feature('BASE','Shared basement','basement',rectangle(2,2,22,12),'Shared basement'),feature('UTIL','Utility corridor','basement',rectangle(0,13,24,15),'Underground corridor')])
levels.extend([['BASE',-3,0,'m',frame['benchmark'],'Synthetic authored level schedule'],['UTIL',-5,-4,'m',frame['benchmark'],'Synthetic authored level schedule']])
(ROOT/'spatial.json').write_text(json.dumps({'profile':'parcel-local-json-v1','frame':frame,'features':features},indent=2)+'\n')
with (ROOT/'levels.csv').open('w') as f:
    w=csv.writer(f);w.writerow(['alias','lower','upper','unit','benchmark','method']);w.writerows(levels)
make_plan(ROOT,'Nandan block',features,(0,0,24,16),[('CP01',0,0),('CP02',24,0)])
c=Canvas(str(ROOT/'rights.pdf'),pagesize=(612,792));c.setFont('Helvetica-Bold',17);c.drawString(45,748,'Nandan block | SYNTHETIC RIGHTS SCHEDULE')
c.setFont('Helvetica',10);c.drawString(45,725,'Fictional parties and claims for software demonstration. No legal or survey authority.')
y=692
for alias,*_ in levels:
    if alias=='BASE': text='BASE: Nandan Residents Association - shared use for buildings A and B.'
    elif alias=='UTIL': text='UTIL: Nandan Utility Cooperative - easement across parcels PA and PB.'
    elif alias.endswith('C'): text=f'{alias}: Nandan Residents Association - shared use.'
    else: text=f'{alias}: Household {alias} - fictional ownership claim.'
    c.drawString(45,y,text);y-=27
c.drawString(45,y-10,'Each row identifies a record alias; boundaries are in spatial.json and levels.csv.')
c.save()
(ROOT/'README.md').write_text('# Nandan block — synthetic originals\n\nGenerated teaching inputs in LOCAL-NANDAN-DEMO metres; no geographic or legal claim.\nRun `python fixtures/generate_registry.py` with Pillow and ReportLab installed.\nThe seed uploads these originals, waits for inspection, builds with Python and records a reviewed snapshot.\n')
print('Generated spatial, levels, plan PNG/PDF and rights PDF originals.')
