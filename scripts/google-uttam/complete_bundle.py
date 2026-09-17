"""Finish attribution and retain every detection in the selected block as a file."""
from pathlib import Path
from shapely.geometry import shape
from acquire import OUTPUT, load, save, now

bundle=OUTPUT/"google-block-inputs"
boundary=shape(load(bundle/"block-boundary.geojson")["features"][0]["geometry"])
all_features=[f for f in load(OUTPUT/"uttam-nagar-neighbourhood-google-v3.geojson")["features"] if boundary.covers(shape(f["geometry"]).centroid)]
for path in bundle.glob("*.geojson"):
    content=load(path)
    for feature in content["features"]:
        props=feature["properties"]
        props["attribution"]="Google Research Open Buildings V3; OpenStreetMap contributors (boundary/roads)" if 'google_' in str(props) else "OpenStreetMap contributors; authored synthetic scenario where explicitly marked DEMO"
        props["license"]="ODbL-1.0"
    save(path,content)
save(bundle/"00-all-google-detections.geojson",{"type":"FeatureCollection","notice":"All model detections whose centroid lies inside the selected street block. The main imported layer applies the documented confidence threshold; this complete unfiltered block extract is retained for inspection.","attribution":"Google Research Open Buildings V3; OpenStreetMap contributors (selection boundary)","license":"ODbL-1.0","features":all_features})
report=load(bundle/"selection-report.json")
report["allDetectionsInBlock"]=len(all_features)
report["belowSelectedConfidence"]=sum(f["properties"]["confidence"]<report["confidenceThreshold"] for f in all_features)
report["filteredDetectionsRetainedSeparately"]=True
report["bundleCompletedAt"]=now()
save(bundle/"selection-report.json",report)
print(f"Complete block source: {len(all_features)} detections; {report['buildings']} selected at threshold {report['confidenceThreshold']}; {report['belowSelectedConfidence']} lower-confidence detections retained separately")
