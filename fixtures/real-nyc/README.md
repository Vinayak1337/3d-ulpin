# NYC public building demo

See [DEMO_DATA.md](../../DEMO_DATA.md) for provider links, attribution, the
conversion recipe and the full UI walkthrough.

- `original.geojson`: unchanged public API response, OTI/DOITT **353927**.
- `spatial.json`: derived local-metre geometry accepted by this app.
- `levels-r1.csv`: relative base and converted reported roof height.
- `provenance.json`: original SHA-256, source URL/date, coordinate origin,
  reference systems, conversion factors and independent expected quantities.

This is a real public footprint with a derived constant-height envelope.
There are no interior floors, rooms, parcel rights or invented floor heights.
Use **Property volumes** to display the computed envelope. The original GeoJSON
requires the documented conversion; the app does not directly ingest arbitrary
GeoJSON files. All data is attributed to NYC Office of Technology and Innovation
and remains subject to the linked NYC Open Data terms.
