# DATA-11 — official building or cadastral source discovery

**Historical result (26 September):** no source was admitted or acquired. The bounded search found one strong official building-footprint lead (KDMC) and one cadastral service lead (TGRAC), but neither yielded an accessible, rights-qualified original ≤16 MiB. The machine-readable record is [source-check.json](../../../fixtures/usp/D3/official-building-context-v1/source-check.json).

**27 September update:** KDMC access succeeded via `KDMC_BASEMAP_24_04_25/FeatureServer/11`: live count12,242 and100 real footprint polygons downloaded unchanged into private discovery storage. Reuse permission and 3D heights remain unresolved; no admission occurred. See the [current source index](../../api/real-sources.md) for exact retained manifest and limitations. Earlier failed-attempt receipt below remains unchanged.

## Official catalogue first

The four bounded `data.gov.in` searches for Indian building footprints and cadastral parcel geometry surfaced no qualifying downloadable layer. The [Bhuvan Geoportal OGD catalogue record](https://kerala.data.gov.in/catalog/bhuvan-geoportal-nrscisro) identifies NRSC/ISRO contributors and an NDSAP catalogue designation, but its resource area says “No Result Found”; it does not provide a specific vector dataset. The [OGD GIS group](https://www.data.gov.in/dataset-group-name/GIS) search leads inspected were municipal utilities and public-facility locations described as points, plus administrative/statistical datasets. The GIS group page itself returned a redirect-loop error in the web reader.

## Strongest building-footprint lead: KDMC

The KDMC GIS service search metadata lists a `Building_Footprint` group and `Building FootPrint` layer, describes the basemap as GIS-cell prepared, and reports EPSG:32643 and JSON/GeoJSON support. The indexed endpoints are [KDMC_BASEMAP_24_04_2025 MapServer](https://maps.kdmc.gov.in/agserver/rest/services/KDMC_BASEMAP_24_04_2025/MapServer) and [KDMC_BASEMAP_24_04_25 FeatureServer](https://maps.kdmc.gov.in/agserver/rest/services/KDMC_BASEMAP_24_04_25/FeatureServer). They have different service names, so their layer IDs and contents were not treated as interchangeable.

The web reader returned HTTP 502 for both service roots. A bounded direct request to the `FeatureServer/11` metadata URL under the `24_04_2025` service name yielded no captured body or exit code. No feature query was made and no geometry bytes were obtained. A resource-specific reuse statement was not located; indexed FeatureServer metadata showed blank copyright text. This remains a promising issuer-hosted source, not a qualified or admitted source.

## Cadastral lead: TGRAC Bhunaksha service

The [Telangana Bhunaksha MapServer](https://tgrac.telangana.gov.in/arcgis/rest/services/Bhunaksha_Folder/Bhunaksha/MapServer) page lists ULB cadastral layers, EPSG:4326, and JSON/AMF query formats. Its service description is only `t`, its copyright field is blank, and the page supplies no source lineage, dataset version, or licence statement. No parcel feature query was made. It remains unqualified.

## Reproduction and disposition

- Official catalogue and indexed service pages were inspected read-only on 2026-09-26. The source-check receipt records the query strings and access outcomes.
- No source bytes were acquired, transformed, or inspected. No feature values, identifiers, geometry, or owner data were queried.
- No manifest or profile was created, and no existing source index, source receipt, service, database, provider, or frontend was changed.
- A future admission requires an accessible official layer response small enough for the 16 MiB limit, retained unchanged with its URL/hash/date/CRS, and a documented permission scope adequate for the intended test. Until then, the source claim stays unqualified.
