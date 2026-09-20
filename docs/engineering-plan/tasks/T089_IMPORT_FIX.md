# T089 priority intake routing fix

User reproduced Lake View complete ZIP at Add files being sent to raw GIS inspection, which assumed every ZIP was a Shapefile archive. Add files now inspects container metadata to distinguish manifest-backed dataset packages from raw GIS archives. Dataset intake runs the shared package normalizer, shows counts, then saves through the same server-validated dataset API as Map import. Opens the saved map and sources without discarding other selected files. Raw Shapefiles, GeoJSON, supported documents and GIS inspection retain their existing routes. Invalid packages surface validation errors; no silent fallback to Shapefile after a package manifest is recognized.

Three regression tests cover renamed Lake View/Shiv Vihar ZIPs, Shapefile archives, corrupt ZIP, invalid manifest routing, normal GeoJSON and normalized scenes. TypeScript passed. Browser verification follows the production rebuild.
