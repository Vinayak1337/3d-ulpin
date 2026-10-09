import {z} from 'zod';

export const CanonicalValueKindSchema=z.enum(['text_literal','number_unit','date','enum','geometry','key']);
export const CanonicalOperationKindSchema=z.enum(['copy','enum_lookup','unit_convert','parse_literal','link_parent_key']);
export const CanonicalUnitFamilySchema=z.enum(['none','count','length','area']);
export const CanonicalTargetDefinitionSchema=z.strictObject({
  valueKind:CanonicalValueKindSchema,allowedOperations:z.array(CanonicalOperationKindSchema).min(1),
  unitFamily:CanonicalUnitFamilySchema,modelMayPropose:z.boolean(),displayLabel:z.string().min(1),meaning:z.string().min(1),
});
type Definition=z.infer<typeof CanonicalTargetDefinitionSchema>;
const literal=(displayLabel:string,meaning:string,identifier=false):Definition=>({valueKind:identifier?'key':'text_literal',
  allowedOperations:identifier?['copy']:['copy','parse_literal'],unitFamily:'none',modelMayPropose:!identifier,displayLabel,meaning});
const quantity=(displayLabel:string,meaning:string,unitFamily:Definition['unitFamily']):Definition=>({valueKind:'number_unit',
  allowedOperations:['copy','unit_convert','parse_literal'],unitFamily,modelMayPropose:true,displayLabel,meaning});
const enumeration=(displayLabel:string,meaning:string):Definition=>({valueKind:'enum',allowedOperations:['copy','enum_lookup'],
  unitFamily:'none',modelMayPropose:true,displayLabel,meaning});
const parent=(displayLabel:string,meaning:string):Definition=>({valueKind:'key',allowedOperations:['copy','link_parent_key'],
  unitFamily:'none',modelMayPropose:true,displayLabel,meaning});

/** Selection proposes a source-column interpretation, never a value or an official issuance. */
export const CANONICAL_TARGETS={
  'building.sourceKey':literal('Building source key','Identifier copied verbatim from the issuing source; not an allocated application ID.',true),
  'building.name':literal('Building name','Building name as stated in the source.'),
  'building.addressLiteral':literal('Address','Unresolved address text as written; not a geocoded location.'),
  'building.use':enumeration('Building use','Source-stated use, not a legal-use determination.'),
  'building.storeyLabel':literal('Storey expression','Literal storey expression; G+41 is not automatically a count.'),
  'building.storeyCount':quantity('Storey count','Explicit source count; never derived from a floor label.','count'),
  'building.heightM':quantity('Building height','Source height in metres; vertical reference still needs separate evidence.','length'),
  'building.footprint':{valueKind:'geometry',allowedOperations:['copy'],unitFamily:'none',modelMayPropose:true,
    displayLabel:'Footprint',meaning:'Retained source polygon in its source CRS; no reprojection or ground/roof role is inferred.'} as Definition,
  'parcel.khasra':literal('Khasra number','Literal khasra identifier, including slashes and local-script digits.',true),
  'parcel.plot':literal('Plot number','Literal plot identifier; not a building identifier.',true),
  'parcel.survey':literal('Survey number','Literal survey identifier with its source formatting.',true),
  'parcel.ulpinAnchor':literal('Official parcel ULPIN assertion','A source-copied official parcel-anchor assertion, never issuance or verification.',true),
  'parcel.area':quantity('Parcel area','Source-stated parcel area with declared units; not polygon-derived title area.','area'),
  'unit.unitNo':literal('Unit number','Literal unit identifier as written in the source.',true),
  'unit.floorLabel':literal('Unit floor label','Literal floor label; does not establish integer level or unit extent.'),
  'unit.type':enumeration('Unit type','Source-stated unit category.'),
  'unit.carpetArea':quantity('Carpet area','Only source-declared carpet area; generic room area is not statutory carpet area.','area'),
  'unit.builtUpArea':quantity('Built-up area','Source-declared built-up area, distinct from carpet area.','area'),
  'unit.balconyArea':quantity('Balcony area','Source-declared balcony area, kept separate from carpet area.','area'),
  'level.label':literal('Level label','Literal level label; G, UGF, Stilt and B1 never become integers.'),
  'level.kind':enumeration('Level kind','Source-stated level category; no inferred floor schedule.'),
  'level.lowerM':quantity('Level lower elevation','Source lower elevation in metres; requires a separate vertical reference.','length'),
  'level.upperM':quantity('Level upper elevation','Source upper elevation in metres; requires a separate vertical reference.','length'),
  'space.name':literal('Space name','Literal room or space name; a room is not automatically a legal unit.'),
  'space.kind':enumeration('Space kind','Source-stated space category.'),
  'space.area':quantity('Space area','Source-stated space area; not statutory unit carpet area.','area'),
  'document.registrationNo':literal('Registration number','Literal source registration number; no new registration is allocated.',true),
  'document.sanctionNo':literal('Sanction number','Literal source sanction number; not proof of current validity.',true),
  'document.date':{valueKind:'date',allowedOperations:['copy','parse_literal'],unitFamily:'none',modelMayPropose:true,
    displayLabel:'Document date',meaning:'Unambiguous source date with the original literal retained.'} as Definition,
  'document.issuer':literal('Document issuer','Issuer named in the source; no authority is inferred.'),
  'document.status':enumeration('Document status','Source-declared document status, not an application review decision.'),
  // Parent references are source keys checked against supplied parent rows, not allocated identifiers.
  'building.parentSourceKey':parent('Building parent key','Source-backed parent key; linkage requires referential-integrity checking.'),
  'unit.parentSourceKey':parent('Unit parent key','Source-backed parent building key; does not infer a unit-floor relation.'),
  'level.parentSourceKey':parent('Level parent key','Source-backed parent building key.'),
  'space.parentSourceKey':parent('Space parent key','Source-backed parent level or unit key; relationship meaning needs review.'),
  unknown:{...literal('Unknown field','Retain the source field without assigning unsupported canonical meaning.'),allowedOperations:['copy']} as Definition,
} as const satisfies Record<string,Definition>;
export const CanonicalTargetSchema=z.enum(Object.keys(CANONICAL_TARGETS) as [keyof typeof CANONICAL_TARGETS,...(keyof typeof CANONICAL_TARGETS)[]]);
export type CanonicalTarget=z.infer<typeof CanonicalTargetSchema>;
/** Two legacy names are already canonical; geometry is the only renamed target. */
export const LEGACY_TARGET_ALIASES={'building.sourceKey':'building.sourceKey','building.name':'building.name',
  'building.geometry':'building.footprint'} as const;
export const MappingTargetSchema=z.enum([...CanonicalTargetSchema.options,'building.geometry']);
export type MappingTarget=z.infer<typeof MappingTargetSchema>;
export const canonicalTarget=(target:MappingTarget):CanonicalTarget=>target==='building.geometry'?'building.footprint':target;
export const LegacyMappingTargetSchema=z.enum(['building.sourceKey','building.name','building.geometry']);
