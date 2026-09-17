"""Select one bounded street block and author an explicitly synthetic companion.

Public Google geometry is not repaired or moved. Invented heights, interiors,
residents and road-width assumptions belong only to the synthetic companion.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from shapely.affinity import rotate
from shapely.geometry import Point, LineString, Polygon, box, mapping, shape
from shapely.ops import polygonize, transform, unary_union

from acquire import ROOT, OUTPUT, DOWNLOADS, load, save, now, digest

TO_METRES = Transformer.from_crs(4326, 32643, always_xy=True).transform
TO_GEO = Transformer.from_crs(32643, 4326, always_xy=True).transform
NOTICE = "SYNTHETIC DEMO ONLY: no actual resident, title, surveyed interior, measured height or road reservation is asserted."


def fc(features, **metadata):
    return {"type": "FeatureCollection", **metadata, "features": features}


def parts(geometry, kind):
    if geometry.is_empty:
        return []
    if geometry.geom_type == kind:
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [p for child in geometry.geoms for p in parts(child, kind)]
    return []


def inscribed_rectangle(polygon):
    """Return an authored rectangular layout contained in a source polygon."""
    if polygon.geom_type != "Polygon" or polygon.interiors or not 55 <= polygon.area <= 650:
        return None
    rectangle = polygon.minimum_rotated_rectangle
    p = list(rectangle.exterior.coords)
    edge = np.asarray(p[1]) - np.asarray(p[0])
    angle = float(np.degrees(np.arctan2(edge[1], edge[0])))
    centre = polygon.centroid
    flat = rotate(polygon, -angle, origin=(centre.x, centre.y))
    x0, y0, x1, y1 = flat.bounds
    for inset in np.arange(.45, min((x1-x0), (y1-y0)) / 3, .2):
        proposed = box(x0+inset, y0+inset, x1-inset, y1-inset)
        if proposed.area < 40:
            break
        if flat.covers(proposed) and min((x1-x0)-2*inset, (y1-y0)-2*inset) >= 4.5:
            return {"angle": angle, "origin": (centre.x, centre.y), "bounds": list(proposed.bounds), "area": proposed.area}
    return None


def selected_block():
    plan = load(ROOT / "source-plan.json")
    buildings = load(OUTPUT / "uttam-nagar-neighbourhood-google-v3.geojson")["features"]
    raw_roads = load(DOWNLOADS / "uttam-nagar-roads-osm.json")
    if raw_roads.get("remark") or "elements" not in raw_roads:
        raise RuntimeError("OSM road extraction is incomplete or has no elements")
    centre = Point(*TO_METRES(plan["uttamNagar"]["longitude"], plan["uttamNagar"]["latitude"]))
    roads = []
    skipped_roads = []
    for row in raw_roads["elements"]:
        coords = [(item["lon"], item["lat"]) for item in row.get("geometry", [])]
        if row.get("type") != "way" or len(coords) < 2:
            skipped_roads.append(row.get("id")); continue
        line = transform(TO_METRES, LineString(coords))
        if line.is_empty or not line.is_valid or line.length < .1:
            skipped_roads.append(row.get("id")); continue
        roads.append((row, line))
    if not roads:
        raise RuntimeError("No road line geometry available")
    valid, rejected = [], []
    threshold = float(plan["tiles"][0]["threshold"]["confidence_threshold_80%_precision"])
    for feature in buildings:
        g = shape(feature["geometry"])
        if not g.is_valid or g.is_empty:
            rejected.append({"id": feature["properties"]["source_id"], "reason": "Invalid source geometry; no repair performed"}); continue
        if feature["properties"]["confidence"] < threshold:
            continue
        metric = transform(TO_METRES, g)
        valid.append((feature, metric, inscribed_rectangle(metric)))
    candidates = []
    for polygon in polygonize(unary_union([line for _, line in roads])):
        if not 4000 <= polygon.area <= 50000 or polygon.distance(centre) > 700:
            continue
        contained = [item for item in valid if polygon.covers(item[1].centroid)]
        good = [item for item in contained if item[2]]
        if 12 <= len(contained) <= 180 and len(good) >= 3:
            candidates.append((polygon.distance(centre) + abs(len(contained)-45)*2, polygon, contained))
    method = "Street-enclosed polygon generated from intersecting OpenStreetMap road centrelines; not an official cadastral or administrative block"
    if candidates:
        _, boundary, chosen = min(candidates, key=lambda item: item[0])
    else:
        boundary = box(centre.x-140, centre.y-140, centre.x+140, centre.y+140)
        chosen = [item for item in valid if boundary.covers(item[1].centroid)]
        method = "Explicit 280 by 280 metre analysis window centred on the OSM Uttam Nagar place node; not a street-enclosed or official block"
        if not 3 <= len(chosen) <= 400 or len([item for item in chosen if item[2]]) < 3:
            raise RuntimeError("No bounded block with sufficient valid source footprints; inspect rather than fabricate")
    chosen.sort(key=lambda item: item[0]["properties"]["source_id"])
    bundle = OUTPUT / "block-inputs"
    if bundle.exists():
        raise RuntimeError("Prepared bundle already exists; preserve it and use a new output directory")
    bundle.mkdir()
    roads_out, demo_roads = [], []
    clipping_window = boundary.buffer(25)
    for row, line in roads:
        for index, segment in enumerate(parts(line.intersection(clipping_window), "LineString")):
            if segment.length < .2:
                continue
            source_id = f"osm-way-{row['id']}-part-{index+1}"
            tags = row.get("tags", {})
            properties = {"source_id": source_id, "osm_way_id": str(row["id"]), "name": tags.get("name", f"OSM {tags.get('highway','road')} {row['id']}"), "highway": tags.get("highway", "unknown"), "width": tags.get("width"), "lanes": tags.get("lanes"), "source_notice": "OSM road centreline clipped to analysis area; legal road-land boundary and surveyed width not supplied"}
            roads_out.append({"type":"Feature", "geometry":mapping(transform(TO_GEO, segment)), "properties":properties})
            # No supplied legal width is inferred. This independent scenario uses
            # the same explicit 6 m assumption for every display road.
            scenario = segment.buffer(3, cap_style=2, join_style=2)
            if not scenario.is_valid:
                raise RuntimeError("Invalid generated display road")
            demo_roads.append({"type":"Feature", "geometry":mapping(transform(TO_GEO, scenario)), "properties":{**properties, "source_id":"DEMO-"+source_id, "name":"DEMO 6 m road corridor / " + properties["name"], "assumed_width_m":6, "source_notice":NOTICE+" Assumed 6 m corridor about an OSM centreline; NOT the measured road surface or right of way."}})
    if not roads_out:
        raise RuntimeError("Selected block has no retained road geometry")
    public_buildings = []
    demo_buildings = []
    details = []
    detailed_candidates = sorted([item for item in chosen if item[2]], key=lambda item: (-item[2]["area"], item[0]["properties"]["source_id"]))[:3]
    detail_keys = {item[0]["properties"]["source_id"]: "ABC"[index] for index,item in enumerate(detailed_candidates)}
    for index, (feature, metric, layout) in enumerate(chosen):
        props=feature["properties"]
        public_buildings.append(feature)
        key=detail_keys.get(props["source_id"], f"X{index+1:03}")
        floors={"A":3,"B":4,"C":2}.get(key, 2+index%3)
        demo_props={**props, "source_id":"DEMO-"+props["source_id"], "reference_source_id":props["source_id"], "name":f"DEMO UN-{key} / fictional {floors}-storey building", "demo_height_m":floors*3.0, "demo_floors":floors, "source_notice":NOTICE+" Public outline copied as a scenario reference; all vertical dimensions invented."}
        demo_buildings.append({"type":"Feature", "geometry":feature["geometry"], "properties":demo_props})
        if key in "ABC":
            x0,y0,x1,y1=layout["bounds"]
            hall_width=min(1.2,(y1-y0)*.2)
            mid=(x0+x1)/2
            flat_rooms=[("R1","Demo apartment 1",box(x0,y0,mid-.10,y1-hall_width-.10)),("R2","Demo apartment 2",box(mid+.10,y0,x1,y1-hall_width-.10)),("COMMON","Demo shared access",box(x0,y1-hall_width,x1,y1))]
            rooms=[]
            for alias,name,flat in flat_rooms:
                g=rotate(flat,layout["angle"],origin=layout["origin"])
                if not metric.buffer(1e-6).covers(g):
                    raise RuntimeError("Authored interior must remain within its reference outline")
                rooms.append({"alias":alias,"name":name,"area_m2":g.area,"utm_geometry":mapping(g)})
            details.append({"key":key,"source_id":demo_props["source_id"],"reference_source_id":props["source_id"],"floors":floors,"floor_height_m":3.0,"benchmark":"DEMO-UTTAM-NAGAR","rooms":rooms,"layout_method":"Authored inset rectangle, two demo apartments plus common corridor per floor; not extracted from real building plans"})
    details.sort(key=lambda item:item["key"])
    target=next(item for item in chosen if item[0]["properties"]["source_id"]==details[0]["reference_source_id"])[1]
    x0,y0,x1,y1=target.bounds
    cy=target.representative_point().y
    crossing=box(x0-1,cy-1.2,x1+1,cy+1.2)
    expected=target.intersection(crossing).area
    if expected<=0:
        raise RuntimeError("Synthetic crossing fixture has no positive overlap")
    scenario_feature={"type":"Feature","geometry":mapping(transform(TO_GEO,crossing)),"properties":{"source_id":"DEMO-UN-CROSSING","name":"DEMO proposed road reservation / intentionally crosses UN-A","source_notice":NOTICE+" Authored conflict test; no such public reservation is claimed.","expected_target_overlap_m2":expected}}
    meta={"createdAt":now(),"selectionMethod":method,"licence":"ODbL-1.0; Google Research Open Buildings V3 and OpenStreetMap contributors","sourceDateNotice":"Google inference May 2023; OSM retrieved in this session; these are not a shared survey epoch"}
    save(bundle/"01-google-building-footprints.geojson",fc(public_buildings,**meta))
    save(bundle/"02-osm-road-centrelines.geojson",fc(roads_out,**meta))
    save(bundle/"03-DEMO-building-envelopes.geojson",fc(demo_buildings,notice=NOTICE,**meta))
    save(bundle/"04-DEMO-road-corridors.geojson",fc(demo_roads,notice=NOTICE,**meta))
    save(bundle/"05-DEMO-road-conflict.geojson",fc([scenario_feature],notice=NOTICE,**meta))
    save(bundle/"block-boundary.geojson",fc([{"type":"Feature","geometry":mapping(transform(TO_GEO,boundary)),"properties":{"name":"Uttam Nagar selected analysis block","method":method}}],**meta))
    save(bundle/"synthetic-interior-spec.json",{"notice":NOTICE,"details":details})
    for detail in details:
        image=Image.new("RGB",(1400,1050),"white")
        draw=ImageDraw.Draw(image)
        font=ImageFont.load_default(size=23)
        title_font=ImageFont.load_default(size=32)
        draw.rectangle((0,0,1400,135),fill="#1e4540")
        draw.text((35,25),f"UN-{detail['key']} | FICTIONAL INTERIOR LAYOUT",font=title_font,fill="white")
        draw.text((35,80),"NOT A SURVEY - NOT A REAL RESIDENT OR OWNERSHIP REGISTER",font=font,fill="white")
        shapes=[shape(room["utm_geometry"]) for room in detail["rooms"]]
        bounds=unary_union(shapes).bounds
        scale=min(1120/(bounds[2]-bounds[0]),610/(bounds[3]-bounds[1]))
        def pixel(x,y):
            return (140+(x-bounds[0])*scale,800-(y-bounds[1])*scale)
        for index,(room,g) in enumerate(zip(detail["rooms"],shapes)):
            points=[pixel(x,y) for x,y in g.exterior.coords]
            draw.polygon(points,fill=["#d7e7de","#dbe7f0","#eee5ce"][index],outline="#304d48",width=4)
            at=pixel(g.centroid.x,g.centroid.y)
            label=f"{room['alias']} | {room['area_m2']:.1f} m2"
            draw.text(at,label,font=font,anchor="mm",fill="#172927")
        draw.text((35,855),f"Assumed floors: {detail['floors']} | floor height: 3.0 m | repeated authored layout",font=font,fill="black")
        draw.text((35,897),"Geometry reference: Google Open Buildings V3 (predicted outline, May 2023 inference).",font=font,fill="black")
        draw.text((35,940),"Room boundaries, levels and occupants are synthetic demonstration assumptions only.",font=font,fill="black")
        image.save(bundle/f"UN-{detail['key']}-SYNTHETIC-plan.png")
    report={**meta,"centreWgs84":list(transform(TO_GEO,boundary.centroid).coords)[0],"boundsWgs84":list(transform(TO_GEO,boundary).bounds),"areaM2":boundary.area,"buildings":len(chosen),"roads":len(roads_out),"confidenceThreshold":threshold,"precisionQualification":"Tile-wide estimated 80% precision threshold, not a probability guarantee for this block or any feature","sourceCacheRows":len(buildings),"sourceGeometriesRejected":rejected,"streetCandidates":len(candidates),"roadWaysFetched":len(raw_roads["elements"]),"roadWaysSkipped":skipped_roads,"interiorBuildings":len(details),"demoFloors":sum(d["floors"] for d in details),"demoSpaces":sum(d["floors"]*len(d["rooms"]) for d in details),"syntheticCrossingExpectedM2":expected,"osmAcquisition":raw_roads.get("provenance"),"publicSourceHashes":{"roadsRaw":digest(DOWNLOADS/"uttam-nagar-osm-map.xml"),"roadsDerivative":digest(DOWNLOADS/"uttam-nagar-roads-osm.json"),"googleNeighbourhood":digest(OUTPUT/"uttam-nagar-neighbourhood-google-v3.geojson")}}
    save(bundle/"selection-report.json",report)
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)


if __name__=="__main__":
    selected_block()
