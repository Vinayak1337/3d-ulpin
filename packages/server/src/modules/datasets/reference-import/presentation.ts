import {z} from 'zod';

const point=z.tuple([z.number(),z.number()]);
const color=z.string().regex(/^#[a-fA-F0-9]{6}$/);
const style=z.object({palette:z.number().int().min(0).max(4).optional(),wallColor:color.optional(),frontEdge:z.number().int().min(0).max(255).optional(),frontEdges:z.array(z.number().int().min(0).max(255)).max(256).optional(),roofCore:z.boolean().optional(),hasBalconies:z.boolean().optional(),waterTank:z.boolean().optional(),serviceEquipment:z.boolean().optional()});
const tree=z.union([point,z.object({position:point,heightM:z.number().positive().max(40).optional(),radiusM:z.number().positive().max(20).optional()})]);
const decoration=z.object({
  classification:z.literal('synthetic_visual_decoration'),
  urbanForm:z.enum(['dense_plotted','open_block']).optional(),ground:z.enum(['paved','grass']).optional(),plotWalls:z.boolean().optional(),
  trees:z.array(tree).max(500).optional(),cars:z.array(z.object({position:point,heading:z.number().min(-360).max(360).optional()})).max(100).optional(),
  parkPaths:z.array(z.object({path:z.array(point).min(2).max(100),widthM:z.number().positive().max(20)})).max(100).optional(),
  buildingStyles:z.record(z.string(),style).optional(),
  architecture:z.object({roofEquipment:z.object({maxHeightAboveRoofM:z.number().min(0).max(3)}).optional(),maxHeightAboveRoofM:z.number().min(0).max(3).optional()}).optional(),
  camera:z.object({focusOffset:z.tuple([z.number().min(-60).max(60),z.number().min(-30).max(30),z.number().min(-60).max(60)]).optional(),distanceM:z.number().min(10).max(3000).optional(),direction:z.tuple([z.number().min(-10).max(10),z.number().min(.05).max(10),z.number().min(-10).max(10)]).optional()}).optional(),
});
export interface PresentationSidecar {
  schemaVersion:'ulpin-presentation/1';
  canonicalSnapshotDigest:string;
  classification:'synthetic_visual_decoration';
  decoration:z.infer<typeof decoration>;
}

/** Whitelisted display options only; rights, dimensions and computed findings never enter this sidecar. */
export function normalizePresentation(value:unknown,digest:string,extent:readonly number[],objectIds:ReadonlySet<string>):PresentationSidecar|undefined{
  if(value==null)return undefined;
  const result=decoration.parse(value);
  const bounded=(p:readonly number[])=>{if(p[0]<extent[0]-100||p[0]>extent[2]+100||p[1]<extent[1]-100||p[1]>extent[3]+100)throw new Error('Display asset lies outside the scene extent.');};
  for(const t of result.trees??[])bounded(Array.isArray(t)?t:t.position);
  for(const car of result.cars??[])bounded(car.position);
  for(const path of result.parkPaths??[])path.path.forEach(bounded);
  for(const id of Object.keys(result.buildingStyles??{}))if(!objectIds.has(id))throw new Error(`Display style references an unknown object: ${id}`);
  return {schemaVersion:'ulpin-presentation/1',canonicalSnapshotDigest:digest,classification:'synthetic_visual_decoration',decoration:result};
}
export function normalizeObjectAppearance(value:unknown){return value==null?undefined:style.parse(value);}
