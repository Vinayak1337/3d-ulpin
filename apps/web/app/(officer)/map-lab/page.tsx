import MapLab from "@/features/spatial/lab/MapLab";
export const metadata = { title: "3D Property Explorer · 3D ULPIN" };
export default async function MapLabPage({searchParams}:{searchParams:Promise<{area?:string;world?:string}>}) {
  const query=await searchParams;
  const areaId=typeof query.area==="string"&&/^[a-f0-9-]{36}$/i.test(query.area)?query.area:undefined;
  const world=query.world==="observed"||query.world==="planned"||query.world==="hypothetical"?query.world:"synthetic";
  return <MapLab areaId={areaId} world={world}/>;
}
