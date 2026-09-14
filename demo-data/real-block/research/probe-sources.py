import urllib.request,urllib.parse,json,hashlib,datetime,concurrent.futures
out=[]
base='https://onemapdepts.gmda.gov.in/server/rest/services/'
for name,bbox in [('islampur',[77.019,28.428,77.025,28.434]),('wazirabad',[77.060,28.428,77.066,28.434]),('farrukhnagar',[76.822,28.445,76.828,28.451])]:
 for layer in [1,2,3]:
  params={'f':'json','where':'1=1','geometry':','.join(map(str,bbox)),'geometryType':'esriGeometryEnvelope','inSR':'4326','spatialRel':'esriSpatialRelIntersects','returnCountOnly':'true'}
  out.append((name,base+f'svamitav_Prod/MapServer/{layer}/query?'+urllib.parse.urlencode(params)))
for p in ['GPRSurvey/Layers/MapServer/7?f=pjson','Sewerage/Manhole_GMDA/FeatureServer/0?f=pjson']:
 out.append(('utility_metadata',base+p))
out.append(('pune_report_catalog','https://opendataapi.pmc.gov.in/reports/search?page=0&size=10&title=Storm'))
def f(item):
 name,url=item;r={'probe':name,'url':url,'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  x=urllib.request.urlopen(url,timeout=20);b=x.read(2*1024*1024);j=json.loads(b);r.update(httpStatus=x.status,bytes=len(b),sha256=hashlib.sha256(b).hexdigest())
  if 'returnCountOnly' in url:r['result']=j
  elif name=='utility_metadata':r['metadata']={k:j.get(k) for k in ['name','description','copyrightText','geometryType','hasZ','hasM','extent']};r['fields']=[i['name'] for i in j.get('fields',[])]
  else:r['result']=j
 except Exception as e:r['error']=str(e)[:200]
 return r
results=list(concurrent.futures.ThreadPoolExecutor(max_workers=6).map(f,out))
open('demo-data/real-block/research/probe-results.json','w').write(json.dumps({'scope':'Aggregate count and schema inspection only. No GMDA feature values/geometries downloaded; reproduction permission pending.','probes':results},indent=2))
for r in results:
 print(json.dumps({k:v for k,v in r.items() if k in ['probe','httpStatus','result','error','metadata']}))
