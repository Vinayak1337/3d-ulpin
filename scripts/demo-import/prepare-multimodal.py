"""Acquire a bounded official NYC multimodal pack; originals are never edited.
Run with the isolated requirements.txt environment. Output stays outside Git.
"""
import argparse, datetime, hashlib, json, math, shutil, urllib.request
from pathlib import Path
import laspy, numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds
from PIL import Image

parser=argparse.ArgumentParser(); parser.add_argument('directory'); args=parser.parse_args()
root=Path(args.directory).resolve(); originals=root/'originals'; upload=root/'upload'
originals.mkdir(parents=True,exist_ok=True);upload.mkdir(exist_ok=True)
bbox=[-74.0125,40.7165,-74.0095,40.719]
receipt={'version':'nyc-multimodal/1','acquiredAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requestedBounds4326':bbox,'coverage':'Bounded lower-Manhattan subset inside ZCTA 10013, not whole postal area','originals':[],'derivatives':[]}
def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
def acquire(url,name):
    path=originals/name
    if not path.exists():
        tmp=path.with_suffix(path.suffix+'.partial')
        with urllib.request.urlopen(url,timeout=60) as response, open(tmp,'wb') as output: shutil.copyfileobj(response,output)
        tmp.rename(path)
    receipt['originals'].append({'name':name,'url':url,'bytes':path.stat().st_size,'sha256':digest(path)})
    return path
lazurl='https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/laz/geoid18/9306/20170504_980200.copc.laz'
laz=acquire(lazurl,'20170504_980200.copc.laz')
acquire('https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/laz/geoid18/9306/metadata_2017_nyc_topobathy.xml','lidar-metadata.xml')
with laspy.open(laz) as reader:
    crs=reader.header.parse_crs(); bounds=transform_bounds('EPSG:4326',crs,bbox[0],bbox[1],bbox[2],bbox[3])
    # Ordinary LAZ crop, not COPC: do not retain stale spatial-index VLRs.
    header=laspy.LasHeader(point_format=reader.header.point_format.id,version=str(reader.header.version))
    header.scales=reader.header.scales;header.offsets=reader.header.offsets;header.add_crs(crs)
    out=upload/'nyc-10013-lidar-2017.laz'; count=0
    with laspy.open(out,mode='w',header=header) as writer:
        for points in reader.chunk_iterator(500000):
            keep=(points.x>=bounds[0])&(points.x<=bounds[2])&(points.y>=bounds[1])&(points.y<=bounds[3])
            selected=points[keep];count+=len(selected);writer.write_points(selected)
    receipt['derivatives'].append({'name':out.name,'role':'point_cloud','format':'laz','sha256':digest(out),'bytes':out.stat().st_size,'count':count,'crs':crs.to_string(),'verticalReference':'NAVD88 height, metres, NOAA GEOID18 distribution','source':lazurl,'recipe':'Bounding-box selection of unchanged point records; no decimation, reconstruction or interpolation','captureYear':2017})
print('LAZ crop',count,flush=True)
demurl='https://gisdata.ny.gov/elevation/DEM/NYC_TopoBathymetric2017/be_NYC_025.tif'
# Read only the native raster window over HTTP ranges; do not fetch a 674 MB tile.
receipt['originals'].append({'url':demurl,'name':'be_NYC_025.tif','bytes':673930486,'retainedLocally':False,'access':'GDAL HTTP byte ranges; unmodified issuer file remains remote'})
with rasterio.Env(GDAL_HTTP_TIMEOUT='45',GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR'), rasterio.open(demurl) as src:
    bounds=transform_bounds('EPSG:4326',src.crs,*bbox)
    window=from_bounds(*bounds,src.transform).round_offsets().round_lengths()
    data=src.read(window=window)
    profile=src.profile.copy();profile.update(width=data.shape[2],height=data.shape[1],transform=src.window_transform(window),compress='deflate')
    out=upload/'nyc-10013-dem-2017.tif'
    with rasterio.open(out,'w',**profile) as dst: dst.write(data);dst.update_tags(**src.tags())
    receipt['derivatives'].append({'name':out.name,'role':'dem','format':'geotiff','sha256':digest(out),'bytes':out.stat().st_size,'count':int(data.size),'crs':str(src.crs),'verticalReference':'Not qualified from raster header; raw sample units are not assumed','source':demurl,'recipe':'Native-grid window copied without resampling or filling nodata','captureYear':2017})
print('DEM crop',data.shape,flush=True)
acquire('https://maps.nyc.gov/tms/1.0.0/photo/2018/service.xml','imagery-service.xml')
z=18;n=2**z
def tile(lon,lat): return int((lon+180)/360*n),int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
x0,y0=tile(bbox[0],bbox[3]);x1,y1=tile(bbox[2],bbox[1]);arr=np.zeros(((y1-y0+1)*256,(x1-x0+1)*256,4),dtype=np.uint8)
for x in range(x0,x1+1):
    for y in range(y0,y1+1):
        path=acquire(f'https://maps.nyc.gov/xyz/1.0.0/photo/2018/{z}/{x}/{y}.png8',f'ortho-2018-{z}-{x}-{y}.png')
        with Image.open(path) as image: pixels=np.asarray(image.convert('RGBA'))
        if pixels.shape!=(256,256,4): raise ValueError('Unexpected imagery tile dimensions')
        arr[(y-y0)*256:(y-y0+1)*256,(x-x0)*256:(x-x0+1)*256]=pixels
if np.unique(arr[:,:,:3]).size<16 or not np.any(arr[:,:,3]): raise ValueError('Imagery appears empty')
span=2*math.pi*6378137; resolution=span/n/256
out=upload/'nyc-10013-ortho-2018.tif'
with rasterio.open(out,'w',driver='GTiff',width=arr.shape[1],height=arr.shape[0],count=4,dtype='uint8',crs='EPSG:3857',transform=from_origin(-span/2+x0*256*resolution,span/2-y0*256*resolution,resolution,resolution),compress='deflate') as dst: dst.write(arr.transpose(2,0,1))
receipt['derivatives'].append({'name':out.name,'role':'imagery','format':'geotiff','sha256':digest(out),'bytes':out.stat().st_size,'count':arr.shape[0]*arr.shape[1],'crs':'EPSG:3857','verticalReference':None,'source':'https://maps.nyc.gov/tiles/','recipe':'Exact XYZ tile mosaic; PNG palette expanded to RGBA, georeferenced using Web Mercator tile grid; no resampling','captureYear':2018})
receipt['permission']={'lidar':'NOAA publicly distributed NYC survey; retained issuer metadata governs use','dem':'NYS public download of NYC survey; no broader redistribution licence inferred','imagery':'NYC official public tile service; no broader redistribution licence inferred','scope':'Local development/demo; no public redistribution enabled'}
receipt['limitations']=['No verified drone acquisition','Different survey vintages; no claim of contemporary ground truth','DEM vertical unit/datum not qualified; no LiDAR minus DEM height calculation','Imagery and point-cloud evidence do not create ownership, units or new building geometry']
(root/'manifest.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt['derivatives'],indent=2),flush=True)
