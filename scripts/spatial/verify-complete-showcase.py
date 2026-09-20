"""Independent file readers verify the generated source bundle; no application writes."""
from pathlib import Path
import json,hashlib,io,zipfile
import numpy as np
import rasterio,laspy,fiona
from rasterio.io import MemoryFile
from shapely.geometry import shape
from pypdf import PdfReader
from docx import Document
root=Path(__file__).resolve().parents[2];folder=root/'design/reference-map-v5/data/lake-view-complete'
with zipfile.ZipFile(root/'apps/web/public/reference/lake-view-complete.zip') as archive:
 files={name:archive.read(name) for name in archive.namelist()}
manifest=json.loads(files['manifest.json']);assert len(manifest['files'])==len(files)-1
for row in manifest['files']:
 data=files[row['path']];assert len(data)==row['bytes'];assert hashlib.sha256(data).hexdigest()==row['sha256']
parcels=json.loads(files['parcels.geojson'])['features'];buildings=json.loads(files['buildings.geojson'])['features']
with fiona.open(folder/'lake-view-parcels.gpkg') as source:
 rows=list(source);assert len(rows)==len(parcels);assert 'LOCAL-LAKE-VIEW' in source.crs_wkt
 for row in rows:
  original=next(f for f in parcels if f['properties']['parcel_id']==row['properties']['parcel_id']);assert shape(row['geometry']).equals_exact(shape(original['geometry']),1e-9)
with fiona.open(folder/'gnss-cors-survey-control.gpkg') as source:assert len(source)==9
las=laspy.read(io.BytesIO(files['lidar/lake-view-pointcloud.las']));laz=laspy.read(io.BytesIO(files['lidar/lake-view-pointcloud.laz']))
assert str(las.header.version)=='1.4' and las.header.point_format.id==7
assert np.array_equal(las.xyz,laz.xyz);assert np.array_equal(las.classification,laz.classification)
for kind in ['dem','dsm']:
 with MemoryFile(files[f'elevation/lake-view-{kind}.tif']) as memory:
  with memory.open() as dataset:
   assert dataset.bounds==(-26,-26,194,204);assert dataset.res==(1,1);assert dataset.height==230;assert dataset.width==220
   assert dataset.tags()['classification']=='synthetic'
   if kind=='dem':assert np.all(dataset.read(1)==0)
   else:
    roof_points=las.xyz[np.asarray(las.classification)==6]
    sampled=np.array([v[0] for v in dataset.sample(roof_points[:,:2])]);assert np.allclose(sampled,roof_points[:,2],atol=.001)
with MemoryFile(files['imagery/lake-view-orthomosaic.tif']) as memory:
 with memory.open() as dataset:assert dataset.count==3 and dataset.bounds==(-26,-26,194,204)
pdfs={p:PdfReader(io.BytesIO(b)) for p,b in files.items() if p.endswith('.pdf')}
assert len(pdfs)==8
for path,pdf in pdfs.items():assert len(pdf.pages)>0 and (pdf.pages[0].extract_text() or '').strip(),path
assert 'DEMO-3D-ANCHOR-B01:1' in pdfs['plans/B01-level-1.pdf'].pages[0].extract_text()
assert 'fictional' in '\n'.join(p.text for p in Document(io.BytesIO(files['Lake_View_3D_ULPIN_Dataset_Report.docx'])).paragraphs).lower()
source_assets=json.loads(files['normalized/source_assets.json'])['assets']
for record in source_assets:assert hashlib.sha256(files[record['sourceFile']]).hexdigest()==record['sha256']
observed=json.loads((root/'scripts/spatial/provided-v1-fields.json').read_text())
for name,contract in observed.items():
 payload=json.loads(files['normalized/'+name]);assert payload['schema']==contract['schema'];assert set(contract['topFields']).issubset(payload)
 rows=payload.get('records',payload.get('assets',payload.get('relationships')))
 for row in rows:assert set(contract['rowFields']).issubset(row),(name,set(contract['rowFields'])-row.keys())
print(json.dumps({'status':'pass','files':len(files),'geometry':'49 GeoPackage parcel shapes equal source GeoJSON','pointCount':len(las.points),'lasLazCoordinates':'equal','rasterCoordinates':'same extent, frame and reference elevations','readablePDFs':len(pdfs),'sourceCatalogHashes':len(source_assets)}))
