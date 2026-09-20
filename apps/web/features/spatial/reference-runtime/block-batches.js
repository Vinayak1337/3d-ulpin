import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Disposable block view: bake only render transforms, never source geometry. */
export function createBlockBatches(entry) {
  const group=new THREE.Group(), bins=new Map(), pickables=[], owned=[];
  group.name=`${entry.object.id}/block-batches`;
  entry.group.updateMatrixWorld(true);
  const inverse=new THREE.Matrix4().copy(entry.group.matrixWorld).invert();
  for(const segment of entry.segments)segment.group.traverse(mesh=>{
    if(!mesh.isMesh||Array.isArray(mesh.material))return;
    const key=mesh.material.uuid+(mesh.isInstancedMesh?`/${mesh.geometry.uuid}`:'/surface');
    if(!bins.has(key))bins.set(key,[]);bins.get(key).push(mesh);
  });
  for(const meshes of bins.values()){
    let combined;
    if(meshes[0].isInstancedMesh){
      const count=meshes.reduce((n,m)=>n+m.count,0),colored=meshes.some(m=>m.instanceColor);
      combined=new THREE.InstancedMesh(meshes[0].geometry,meshes[0].material,count);
      let index=0;const local=new THREE.Matrix4(),instance=new THREE.Matrix4(),color=new THREE.Color();
      for(const mesh of meshes){local.multiplyMatrices(inverse,mesh.matrixWorld);for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,instance);combined.setMatrixAt(index,instance.premultiply(local));
        if(colored){color.set('#ffffff');if(mesh.instanceColor)mesh.getColorAt(i,color);combined.setColorAt(index,color);}index++;
      }}
      combined.instanceMatrix.needsUpdate=true;if(combined.instanceColor)combined.instanceColor.needsUpdate=true;
    }else{
      const parts=meshes.map(mesh=>mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld)));
      const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());if(!geometry)continue;
      owned.push(geometry);combined=new THREE.Mesh(geometry,meshes[0].material);
    }
    combined.castShadow=meshes[0].castShadow;combined.receiveShadow=true;
    combined.userData={objectId:entry.object.id,displayRole:'batched_source_exterior'};
    group.add(combined);pickables.push(combined);
  }
  // One visible roof outline per building; hidden storey outlines stay in the register.
  const top=entry.segments.reduce((a,b)=>!a||b.base+b.height>a.base+a.height?b:a,null);
  if(top)top.group.traverse(line=>{if(!line.isLine)return;const copy=line.clone();copy.geometry=line.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,line.matrixWorld));copy.position.set(0,0,0);copy.rotation.set(0,0,0);copy.scale.set(1,1,1);owned.push(copy.geometry);group.add(copy);entry.outline.push(copy);});
  group.visible=false;entry.group.add(group);
  return {group,pickables,dispose(){group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});owned.forEach(g=>g.dispose());group.clear();}};
}
