import * as THREE from 'three';
import type {SurveyAsset} from '../reference-import/survey-assets';

/** One GPU object per source; built only when first requested, disposed with the map. */
export function createSurveyLayers(assets:readonly SurveyAsset[]){
 const group=new THREE.Group(),built=new Map<string,THREE.Object3D>();group.name='Imported survey source layers';group.visible=false;
 function build(asset:SurveyAsset){
  if(asset.kind==='lidar'){
   const positions=new Float32Array(asset.positions!.length);
   for(let i=0;i<positions.length;i+=3){positions[i]=asset.positions![i];positions[i+1]=asset.positions![i+2];positions[i+2]=-asset.positions![i+1];}
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(asset.colors!,3,true));geometry.computeBoundingSphere();
   return new THREE.Points(geometry,new THREE.PointsMaterial({size:2.5,sizeAttenuation:false,vertexColors:true,toneMapped:false}));
  }
  const [dx,,x0,,dy,y0]=asset.affine!,w=asset.width!,h=asset.height!;
  if(asset.kind==='imagery'){
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([x0,0,-y0,x0+w*dx,0,-y0,x0,0,-(y0+h*dy),x0+w*dx,0,-(y0+h*dy)],3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));geometry.setIndex([0,2,1,1,2,3]);
   const texture=new THREE.DataTexture(asset.rgba!,w,h,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;
   return new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false}));
  }
  const positions=new Float32Array(w*h*3),colors=new Float32Array(w*h*3),indices:number[]=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x,z=asset.elevations![i];positions.set([x0+(x+.5)*dx,z,-(y0+(y+.5)*dy)],i*3);
   const t=asset.maximum===asset.minimum?0:(z-asset.minimum)/(asset.maximum-asset.minimum);
   const color=new THREE.Color().setHSL((1-t)*.55,.62,.48);colors.set([color.r,color.g,color.b],i*3);
   if(x<w-1&&y<h-1){const a=i,b=i+1,c=i+w,d=i+w+1;if(asset.valid![a]&&asset.valid![b]&&asset.valid![c])indices.push(a,c,b);if(asset.valid![b]&&asset.valid![c]&&asset.valid![d])indices.push(b,c,d);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,toneMapped:false}));
 }
 return {group,show(id:string){
  const asset=assets.find(a=>a.id===id);group.visible=!!asset;
  if(asset&&!built.has(id)){const object=build(asset);object.name=asset.sourcePath;object.userData={sourceId:asset.sourceId,sourceSha256:asset.sourceSha256,frameId:asset.frameId,role:'source_visualization_not_extracted_building'};group.add(object);built.set(id,object);}
  built.forEach((object,key)=>{object.visible=key===id;});return asset;
 }};
}
