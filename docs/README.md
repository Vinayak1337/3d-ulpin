# Documentation

The published documents for BhuAayam are listed here. Everything else under `docs/` is a working record of the team's plans and evidence and is not part of the public description of the product.

## Start here

| Document | Read it to |
| --- | --- |
| [API guide](api/README.md) | Connect a client: endpoints, events, tiles, limits |
| [OpenAPI contract](api/openapi.json) | Generate or check a client against the exact API |
| [Identifiers and exchange](usp-agent-handoffs/26-identifiers-and-standard-exchange.md) | Understand the proposed 3D identity, the Location line and CityJSON export |
| [Source catalogue](api/real-sources.md) | See where every dataset came from and what it can and cannot support |
| [SQL guide](../database/README.md) | Read the schema and migration order |
| [Design system](design-system/README.md) | Use the tokens, components and map styling |

## How the pieces fit

1. **Sources** are described in the source catalogue. Each one keeps its issuer, hashes, licence and stated limits.
2. **Ingestion** stores every original unchanged, profiles it and converts it through tested mappings. The API guide covers the routes and the event stream.
3. **Records** carry a proposed identity and their evidence. The identifiers document defines the code, the Location line and the exchange profile.
4. **Screens** are built from the design system and read every value from the API contract.
