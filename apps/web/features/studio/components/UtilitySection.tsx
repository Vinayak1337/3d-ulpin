import type { Building } from '../types';
import { district, utilityClearance } from '../data/district';
export function nearestWater(b:Building){return district.utilities.filter(u=>u.kind==='Water').map(u=>({u,gap:utilityClearance(b,u)})).sort((a,c)=>a.gap-c.gap)[0];}
export default function UtilitySection({building}:{building:Building}){
  const {u,gap}=nearestWater(building),radius=u.diameter/2000;
  const px=Math.min(42,175/(gap+radius+1)),edge=60,cx=edge+(gap+radius)*px,cy=70+u.depth*38,r=Math.max(6,radius*px);
  return <svg viewBox="0 0 285 225" role="img" aria-label={`Section: ${gap} metres horizontal clearance and ${u.depth} metres pipe centre depth`}>
    <defs><pattern id="soil-grain" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".6" fill="#9a9f93"/><circle cx="6" cy="7" r=".6" fill="#bcc1b4"/></pattern></defs>
    <rect width="285" height="225" fill="#f4f8f7"/><rect y="70" width="285" height="155" fill="#d2d0c1"/><rect y="70" width="285" height="155" fill="url(#soil-grain)"/>
    <path d="M0 70H285" stroke="#829185" strokeWidth="2"/>
    <rect x="8" y="13" width={edge-8} height="57" fill="#e4d4cd" stroke="#be6657" strokeWidth="1.6"/><text x="13" y="32" fontSize="9" fill="#66473f">Building</text><text x="13" y="45" fontSize="9" fill="#66473f">footprint</text>
    <path d={`M${edge} 67V48M${cx-radius*px} 67V48M${edge} 54H${cx-radius*px}`} stroke="#c55943" fill="none" strokeWidth="1.5"/>
    <text x={(edge+cx-radius*px)/2} y="44" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#b44935">{gap} m</text>
    <text x="77" y="87" fontSize="8" fill="#5d6d61">Ground level · 0.0 m</text>
    <circle cx={cx} cy={cy} r={r+3} fill="#b5d9e6"/><circle cx={cx} cy={cy} r={r} fill="#328daf" stroke="#edf7fc" strokeWidth="2"/>
    <path d={`M254 72V${cy}M248 72h12M248 ${cy}h12`} stroke="#487d94" strokeWidth="1.5" fill="none"/>
    <text x="242" y={(cy+70)/2-5} textAnchor="end" fontSize="11" fontWeight="bold" fill="#315c73">{u.depth} m</text><text x="242" y={(cy+70)/2+7} textAnchor="end" fontSize="8" fill="#507b8f">centre depth</text>
    <text x="13" y="207" fontSize="9" fill="#546960">Water pipe Ø {u.diameter} mm · section schematic</text>
  </svg>;
}
