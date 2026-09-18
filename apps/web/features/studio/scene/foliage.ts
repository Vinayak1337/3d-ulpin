import * as THREE from 'three';

let cached:{geometry:THREE.BufferGeometry;texture:THREE.CanvasTexture}|undefined;
/** Small three-dimensional leaf clusters, instead of large intersecting billboards. */
export function foliageAssets(){
  if(cached)return cached;
  let seed=75917;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d')!;
  for(let i=0;i<17;i++){
    const angle=i*2.39996,radius=Math.sqrt(random())*38,x=64+Math.cos(angle)*radius,y=64+Math.sin(angle)*radius;
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);
    const gradient=ctx.createLinearGradient(-13,0,14,0);gradient.addColorStop(0,'#b9c8a8');gradient.addColorStop(.48,'#f0f1cf');gradient.addColorStop(1,'#a6b98f');
    ctx.fillStyle=gradient;ctx.beginPath();ctx.ellipse(0,0,10+random()*8,4+random()*3,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#85986d';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(-11,0);ctx.lineTo(11,0);ctx.stroke();ctx.restore();
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices=[0,1,2,0,2,3];
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]],uv=[[0,0],[1,0],[1,1],[0,1]];
  for(let i=0;i<104;i++){
    const a=i*2.399963,z=1-2*(i+.5)/104,r=Math.sqrt(1-z*z),radius=.58+random()*.45;
    const centre=new THREE.Vector3(Math.cos(a)*r*radius,z*radius,Math.sin(a)*r*radius);
    const normal=centre.clone().normalize(),axis=Math.abs(normal.y)>.9?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
    const tangent=new THREE.Vector3().crossVectors(axis,normal).normalize(),bitangent=new THREE.Vector3().crossVectors(normal,tangent),scale=.26+random()*.18;
    const verts=corners.map(([x,y])=>centre.clone().addScaledVector(tangent,x*scale).addScaledVector(bitangent,y*scale));
    for(const n of indices){positions.push(...verts[n].toArray());normals.push(...normal.toArray());uvs.push(...uv[n]);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeBoundingSphere();
  cached={geometry,texture};return cached;
}
