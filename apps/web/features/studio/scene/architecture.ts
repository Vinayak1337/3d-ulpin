import type { Building } from '../types';
export type SceneInstance={p:[number,number,number];s:[number,number,number];c:string;r?:[number,number,number];owner?:string};
type Parts=Record<string,SceneInstance[]>;

/** Detailed envelopes retain the recorded footprint; added facade elements are decorative. */
export function buildArchitecture(buildings:Building[]):Parts {
  const parts:Parts={body:[],frames:[],windows:[],trim:[],roof:[],tanks:[],solar:[],footings:[],accent:[]};
  const palettes=['#d8d0be','#c4cecc','#d6c4af','#dddccf'];
  const accents=['#b39780','#819b9b','#b4a086','#adb7ab'];
  for(const b of buildings){
    const {x,z,width:w,depth:d,height:h,id,variant:v}=b;
    const featured=b.ulpin==='11007500003527';
    const body=featured?'#d5c7b9':b.color;
    const add=(key:string,px:number,py:number,pz:number,ww:number,hh:number,dd:number,color:string,r?:[number,number,number])=>parts[key].push({p:[px,py,pz],s:[ww,hh,dd],c:color,owner:id,r});
    // An inset structural core leaves genuinely recessed window bays in the envelope.
    add('body',x,h/2+.4,z,w-.8,h,d-.8,body);
    add('footings',x,.26,z,w+.65,.26,d+.65,'#bdbcb0');
    const windowW=v===1?2.5:v===0?1.85:2.25,windowH=v===2?1.9:1.72;
    for(let f=0;f<b.floors;f++){
      const base=.4+f*b.floorHeight,wy=base+1.78;
      // Facade walls are piers + spandrels, rather than a flat wall with painted windows.
      for(const side of [-1,1]){
        const faceZ=z+side*(d/2-.14),faceX=x+side*(w/2-.14);
        add('frames',x,base+.42,faceZ,w,.84,.3,body);
        add('frames',x,base+2.96,faceZ,w,.48,.3,body);
        add('frames',faceX,base+.42,z,.3,.84,d,body);
        add('frames',faceX,base+2.96,z,.3,.48,d,body);
        for(const horizontal of [true,false]){
          const span=horizontal?w:d;
          const centres=[-span*.31,0,span*.31];
          let edge=-span/2;
          for(let c=0;c<3;c++){
            const centre=centres[c],gap=centre-windowW/2-edge;
            if(gap>0){if(horizontal)add('frames',x+edge+gap/2,wy,faceZ,gap,1.99,.3,body);else add('frames',faceX,wy,z+edge+gap/2,.3,1.99,gap,body);}
            const glass=(c+f+v)%5===0?'#799599':(c+v)%3===0?'#5d767d':'#49636b';
            if(horizontal){
              add('windows',x+centre,wy,z+side*(d/2-.25),windowW,windowH,.045,glass);
              for(const e of [-1,1])add('trim',x+centre+e*windowW/2,wy,z+side*(d/2+.025),.045,windowH+.08,.08,body);
              add('trim',x+centre,wy-windowH/2-.045,z+side*(d/2+.13),windowW+.22,.11,.38,'#d5d4c9');
              add('trim',x+centre,wy+windowH/2+.045,z+side*(d/2+.05),windowW+.19,.1,.2,'#efede2');
              add('trim',x+centre,wy,z+side*(d/2-.15),.065,windowH,.06,'#b9c6c5');
            }else{
              add('windows',x+side*(w/2-.25),wy,z+centre,.045,windowH,windowW,glass);
              for(const e of [-1,1])add('trim',x+side*(w/2+.025),wy,z+centre+e*windowW/2,.08,windowH+.08,.045,body);
              add('trim',x+side*(w/2+.13),wy-windowH/2-.045,z+centre,.38,.11,windowW+.22,'#d2d2c7');
              add('trim',x+side*(w/2+.05),wy+windowH/2+.045,z+centre,.2,.1,windowW+.19,'#eeece1');
              add('trim',x+side*(w/2-.15),wy,z+centre,.06,windowH,.065,'#b9c6c5');
            }
            edge=centre+windowW/2;
          }
          const rest=span/2-edge;
          if(horizontal)add('frames',x+edge+rest/2,wy,faceZ,rest,1.99,.3,body);
          else add('frames',faceX,wy,z+edge+rest/2,.3,1.99,rest,body);
        }
      }
      if(v===1||featured)add('trim',x,base+.06,z,w+.06,.10,d+.06,'#dddcd2');
      if(f>0&&(v!==0||f===b.floors-1)){
        const bw=w*(v===1?.36:.49),bx=x+(v%2===0?-w*.15:w*.17),bz=z+d/2+.7;
        add('trim',bx,base+.16,bz,bw,.26,1.82,'#e6e1d5');
        add('accent',bx,base+.29,bz,bw-.2,.035,1.56,'#bfbcae');
        add('windows',bx,base+.88,bz+.83,bw-.18,.9,.055,v===2?'#889b92':'#9baca0');
        add('trim',bx,base+1.36,bz+.84,bw,.09,.09,'#d6dcd3');
        for(const side of [-1,1]){
          add('trim',bx+side*(bw/2-.06),base+.84,bz,.12,1.26,1.72,'#e5e5da');
          add('trim',bx+side*bw*.17,base+.86,bz+.84,.055,1.02,.07,'#d4d9d1');
        }
        if(v===2||featured){add('accent',bx-bw*.33,base+.51,bz+.54,1.24,.36,.46,'#9b8e71');add('accent',bx-bw*.33,base+.81,bz+.54,1.28,.36,.53,'#7d9563');}
        if(v===1){add('trim',x-w/2-.46,base+.12,z+d*.16,.96,.2,d*.39,'#e2e6dd');add('windows',x-w/2-.89,base+.8,z+d*.16,.04,1.1,d*.37,'#8fa59f');}
      }
    }
    // Vertical accent bays create variation without changing floor/unit geometry.
    if(v===3||featured){add('accent',x-w*.39,h/2+.4,z+d/2+.045,1.1,h,.12,accents[v]);}
    if(v===1)add('accent',x-w/2-.06,h/2+.4,z-d*.35,.14,h,1.6,accents[v]);
    add('windows',x,.4+1.22,z+d/2+.02,1.65,2.44,.06,'#3a5556');
    add('trim',x,.28,z+d/2+.58,2.4,.18,1.35,'#d1d0c3');
    add('trim',x,.15,z+d/2+1.02,2.9,.14,1.1,'#d4d4c8');
    add('trim',x,3.08,z+d/2+.72,2.65,.16,1.62,'#e6e3d6');
    add('roof',x,h+.53,z,w+.14,.26,d+.14,b.roofColor);
    for(const side of [-1,1]){
      add('frames',x+side*(w/2-.18),h+.98,z,.32,.69,d,body);
      add('frames',x,h+.98,z+side*(d/2-.18),w,.69,.32,body);
      add('trim',x+side*(w/2-.18),h+1.36,z,.4,.1,d+.12,'#eeece0');
      add('trim',x,h+1.36,z+side*(d/2-.18),w+.12,.1,.4,'#eeece0');
    }
    add('body',x-w*.25,h+1.88,z-d*.24,3.45,2.65,4.05,body);
    add('roof',x-w*.25,h+3.26,z-d*.24,3.75,.18,4.3,'#bfc7c1');
    add('windows',x-w*.25,h+1.47,z-d*.24+2.055,1.1,1.9,.035,'#627a73');
    add('tanks',x+w*.23,h+1.26,z-d*.26,1.72,1.16,1.72,v%2?'#697977':'#bdc5bc');
    add('tanks',x+w*.23,h+1.88,z-d*.26,1.61,.09,1.61,'#7e8e83');
    if(v!==0){
      add('solar',x+w*.08,h+1.01,z+d*.19,4.4,.12,2.7,'#37596b',[-.19,0,0]);
      for(let line=0;line<5;line++)add('trim',x+w*.08-2.05+line*1.02,h+1.02,z+d*.19,.035,.13,2.7,'#b0c3c5',[-.19,0,0]);
      add('trim',x+w*.08,h+1.025,z+d*.19,4.4,.14,.04,'#a5bec3',[-.19,0,0]);
    }else{
      const px=x+w*.12,pz=z+d*.19;
      for(const side of [-1,1])add('accent',px+side*2.25,h+1.24,pz,.12,1.4,3.3,'#b5a086');
      for(let j=0;j<7;j++)add('accent',px-2.3+j*.77,h+1.94,pz,.16,.14,3.3,'#c1b39b');
    }
  }
  return parts;
}
