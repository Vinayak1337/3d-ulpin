---
category: Engineering
---

# DigColumn

The impact-screening result for a point or trench: every recorded space and utility in that vertical column, top to bottom, with depth ranges and survey quality, then anything within a set distance of it.

- Bands with no survey appear as dashed *Unknown* rows; the header always says this is screening, not a clearance or dig permission.
- Utilities show their APWA colour swatch, size and quality letter (A to D). A quality letter is never turned into a metre buffer; show a positional tolerance only when the source states one, otherwise "tolerance not stated". Test fixtures are labelled.
- The action is **Export screening report**. It is not an official excavation notice and never says "safe to dig".
- The consumer provides the location, depth range and intersecting records.

## Usage

```jsx
<DigColumn range="0 to 20 m" nearbyLabel="Within 3 m of the trench"
  bands={[
    { depth: '0.0 to 0.6 m', color: 'var(--map-road)', label: 'Paving and sub-base' },
    { depth: '0.9 to 1.2 m', color: 'var(--utility-water)', label: <><strong>Water main DN300</strong> · quality B · tolerance not stated</> },
    { depth: '1.2 to 3.0 m', unknown: true, label: <><strong>Unknown</strong> · no utility survey</> },
    { depth: '14.4 to 18.4 m', color: 'var(--rights-public)', label: <><strong>Metro corridor</strong> · Test fixture</> },
  ]}
  nearby={[{ depth: '0.0 to 6.9 m', color: 'var(--soil-top)', label: <><strong>Basements B1, B2</strong> · Lake View Residence, 1.5 m from trench edge</> }]} />
```
