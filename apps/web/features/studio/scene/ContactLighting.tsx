import {useEffect,useMemo} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {Mesh,Material,Object3D} from 'three';

/** A short-range visual contact effect; it never changes source shapes or quantities. */
export default function ContactLighting(){
 const {gl,scene,camera,size}=useThree();
 const effect=useMemo(()=>{
  const composer=new EffectComposer(gl),render=new RenderPass(scene,camera),ao=new SSAOPass(scene,camera,1,1,16),output=new OutputPass();
  composer.renderTarget1.samples=Math.min(4,gl.capabilities.maxSamples);composer.renderTarget2.samples=Math.min(4,gl.capabilities.maxSamples);
  ao.kernelRadius=2.2;ao.minDistance=.000015;ao.maxDistance=.0016;
  ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA=0;ao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA=0;
  // Transparent selection volumes and leaf cards must not become solid AO boxes.
  const original=ao.render.bind(ao);
  ao.render=(...args:Parameters<SSAOPass['render']>)=>{const hidden:Object3D[]=[];scene.traverse(o=>{if(!o.visible||!(o instanceof Mesh))return;const ms=Array.isArray(o.material)?o.material:[o.material];if(ms.some((m:Material)=>m.transparent||m.alphaTest>0)){o.visible=false;hidden.push(o);}});try{original(...args);}finally{for(const o of hidden)o.visible=true;}};
  // Deterministic sample pattern, independent of the global random-number source.
  ao.kernel.forEach((v,i)=>{const a=i*2.3999632297,z=(i+.5)/ao.kernel.length,r=Math.sqrt(1-z*z),scale=.1+.9*(i/ao.kernel.length)**2;v.set(Math.cos(a)*r,Math.sin(a)*r,z).multiplyScalar(scale);});
  const noise=ao.noiseTexture!.image.data as Float32Array;for(let i=0;i<noise.length;i++)noise[i]=Math.sin((i+1)*12.9898)*.8;ao.noiseTexture!.needsUpdate=true;
  composer.addPass(render);composer.addPass(ao);composer.addPass(output);
  return {composer,ao,render,output};
 },[gl,scene,camera]);
 useEffect(()=>{effect.composer.setPixelRatio(Math.min(gl.getPixelRatio(),1.5));effect.composer.setSize(size.width,size.height);},[effect,gl,size.width,size.height]);
 useEffect(()=>()=>{effect.ao.noiseTexture?.dispose();effect.ao.ssaoMaterial.dispose();effect.ao.dispose();effect.render.dispose();effect.output.dispose();effect.composer.dispose();},[effect]);
 useFrame((_state,delta)=>{const u=effect.ao.ssaoMaterial.uniforms;u.cameraProjectionMatrix.value.copy(camera.projectionMatrix);u.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);u.cameraNear.value=camera.near;u.cameraFar.value=camera.far;effect.ao.enabled=camera.zoom>2.2;effect.composer.render(delta);},1);
 return null;
}
