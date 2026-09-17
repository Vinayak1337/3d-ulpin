"""Extract only public highway geometry from a bounded OSM API map download."""
from xml.etree import ElementTree
from acquire import DOWNLOADS, now, save, digest

source = DOWNLOADS / "uttam-nagar-osm-map.xml"
document = ElementTree.parse(source).getroot()
assert document.tag == "osm", "Unexpected source document"
nodes = {node.attrib["id"]:{"lon":float(node.attrib["lon"]),"lat":float(node.attrib["lat"])} for node in document.findall("node")}
ways=[]
for way in document.findall("way"):
    tags={tag.attrib["k"]:tag.attrib["v"] for tag in way.findall("tag")}
    if "highway" not in tags or tags.get("area") == "yes":
        continue
    refs=[node.attrib["ref"] for node in way.findall("nd")]
    assert all(ref in nodes for ref in refs), "Incomplete highway node references"
    # Do not retain contributor profiles or unrelated POI/contact data in the
    # road derivative. The immutable raw response remains available locally.
    keep={key:value for key,value in tags.items() if key in {"highway","name","width","lanes","oneway","surface","bridge","tunnel","layer"}}
    ways.append({"type":"way","id":int(way.attrib["id"]),"version":int(way.attrib["version"]),"timestamp":way.attrib["timestamp"],"nodes":[int(ref) for ref in refs],"geometry":[nodes[ref] for ref in refs],"tags":keep})
assert ways, "No public highway lines"
provenance={"sourceUrl":"https://api.openstreetmap.org/api/0.6/map?bbox=77.053,28.615,77.069,28.629","processedAt":now(),"sourceSha256":digest(source),"licence":"ODbL-1.0","attribution":"OpenStreetMap contributors","sourceBounds":document.find("bounds").attrib,"method":"Select highway ways, exclude area=yes, resolve all referenced nodes; preserve source coordinates and selected tags","notice":"Community map centrelines; not surveyed road widths or legal rights of way"}
save(DOWNLOADS/"uttam-nagar-roads-osm.json",{"provenance":provenance,"elements":ways})
print(f"OSM roads: {len(ways)} ways from {len(nodes)} nodes; source hash {provenance['sourceSha256']}",flush=True)
