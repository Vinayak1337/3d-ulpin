"""Measured evidence fusion for the fixed NYC upload profile, never new registry facts."""
from pathlib import Path
import hashlib
import laspy
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds
from pyproj import Transformer
from shapely import points, STRtree
from shapely.ops import transform


def fuse(layers, valid, output_dir):
    """Return source reports and per-vector observations. No vertical datum inference."""
    reports=[]; observations={}; buildings=[v for v in valid if v[0]['layer']=='building']
    for layer in layers:
        path=Path(layer['path'])
        report={k:layer.get(k) for k in ('sourceId','name','layer','format','sha256','url','captureYear','verticalReference','recipe')}
        report['originalUrl']=f"/api/v1/sources/{layer['sourceId']}/file"
        report['rendered']=False
        report['usage']='Supporting spatial evidence; existing renderer does not display raw rasters or point clouds'
        if layer['format']=='laz':
            with laspy.open(path) as reader:
                crs=reader.header.parse_crs()
                if crs is None: raise ValueError('Point cloud has no CRS')
                horizontal=crs.sub_crs_list[0] if crs.is_compound else crs
                to_source=Transformer.from_crs('EPSG:32618',horizontal,always_xy=True)
                geoms=[transform(to_source.transform,b[4]) for b in buildings]
                tree=STRtree(geoms); classes={}; joined=[[] for _ in buildings]; valid_count=0
                left,bottom=reader.header.mins[:2];right,top=reader.header.maxs[:2]
                cell=2.0;width=int(np.ceil((right-left)/cell))+1;height=int(np.ceil((top-bottom)/cell))+1
                if width*height>1000000: raise ValueError('Point-cloud profile exceeds bounded grid size')
                maximum=np.full(width*height,-np.inf,dtype=np.float32)
                for part in reader.chunk_iterator(250000):
                    cls=np.asarray(part.classification); values,counts=np.unique(cls,return_counts=True)
                    for c,n in zip(values,counts): classes[str(int(c))]=classes.get(str(int(c)),0)+int(n)
                    keep=~np.asarray(part.withheld,dtype=bool)&~np.isin(cls,[7,18])
                    x=np.asarray(part.x)[keep];y=np.asarray(part.y)[keep];z=np.asarray(part.z)[keep]
                    finite=np.isfinite(x)&np.isfinite(y)&np.isfinite(z);x=x[finite];y=y[finite];z=z[finite];valid_count+=len(z)
                    ix=np.floor((x-left)/cell).astype(int);iy=np.floor((top-y)/cell).astype(int)
                    np.maximum.at(maximum,iy*width+ix,z)
                    if geoms:
                        pairs=tree.query(points(x,y),predicate='within')
                        for building_index in np.unique(pairs[1]):
                            joined[int(building_index)].append(z[pairs[0][pairs[1]==building_index]])
                grid=maximum.reshape(height,width); populated=np.isfinite(grid);grid[~populated]=-9999
                output=Path(output_dir)/'lidar-observed-surface.tif'
                with rasterio.open(output,'w',driver='GTiff',width=width,height=height,count=1,dtype='float32',crs=horizontal,transform=from_origin(left,top,cell,cell),nodata=-9999,compress='deflate') as dst: dst.write(grid,1)
                report.update(pointCount=reader.header.point_count,usablePointCount=valid_count,classCounts=classes,crs=horizontal.to_string(),bounds4326=list(transform_bounds(horizontal,'EPSG:4326',left,bottom,right,top)))
                report['derivedSurface']={'name':output.name,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'resolutionM':cell,'populatedCells':int(populated.sum()),'emptyCells':int((~populated).sum()),'recipe':'Maximum measured Z per 2 m cell, excluding withheld and noise classes 7/18; no interpolation or hole filling','verticalReference':layer['verticalReference'],'originalUrl':f"/api/demo/areas/{layer['areaId']}/surface"}
                for b,parts in zip(buildings,joined):
                    if not parts: continue
                    z=np.concatenate(parts)
                    observations.setdefault((b[0]['layer'],b[3]),[]).append({'sourceId':layer['sourceId'],'kind':'point_cloud','pointCount':len(z),'zMinM':float(z.min()),'zMedianM':float(np.median(z)),'zMaxM':float(z.max()),'verticalReference':layer['verticalReference'],'meaning':'Measured returns inside footprint, including mixed surface classes; not a roof height or floor count','captureYear':layer['captureYear']})
                report['matchedBuildings']=sum(bool(p) for p in joined)
        else:
            with rasterio.open(path) as src:
                if not src.crs: raise ValueError('Raster has no CRS')
                report.update(crs=str(src.crs),width=src.width,height=src.height,bands=src.count,bounds4326=list(transform_bounds(src.crs,'EPSG:4326',*src.bounds)),pixelSize=list(src.res))
                data=src.read(1,masked=True); finite=np.asarray(data.compressed());finite=finite[np.isfinite(finite)]
                report['validPixels']=int(len(finite))
                if not len(finite): raise ValueError('Raster contains no valid pixels')
                report['firstBandRange']=[float(finite.min()),float(finite.max())]
                project=Transformer.from_crs('EPSG:32618',src.crs,always_xy=True)
                matched=0
                for b in buildings:
                    p=b[4].representative_point(); x,y=project.transform(p.x,p.y)
                    if not (src.bounds.left<=x<src.bounds.right and src.bounds.bottom<y<=src.bounds.top): continue
                    values=next(src.sample([(x,y)],masked=True))
                    if np.any(np.ma.getmaskarray(values)) or not np.all(np.isfinite(values)): continue
                    if layer['layer']=='imagery' and src.count==4 and values[3]==0: continue
                    observation={'sourceId':layer['sourceId'],'kind':layer['layer'],'captureYear':layer['captureYear'],'sampleLocation4326':list(Transformer.from_crs('EPSG:32618','EPSG:4326',always_xy=True).transform(p.x,p.y))}
                    if layer['layer']=='dem': observation.update(rawGroundSample=float(values[0]),verticalReference=layer['verticalReference'],meaning='Nearest native DEM pixel at footprint interior point; elevation unit/datum unqualified, never used as building height')
                    else: observation.update(rgb=[int(v) for v in values[:3]],meaning='One source pixel at footprint interior point; not a facade material or texture')
                    observations.setdefault((b[0]['layer'],b[3]),[]).append(observation);matched+=1
                report['matchedBuildings']=matched
        reports.append(report)
    return reports,observations
