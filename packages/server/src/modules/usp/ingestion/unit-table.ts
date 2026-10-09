import type {MappingSourceUnitSchema} from '@ulpin/contracts';
import type {z} from 'zod';

type Unit=z.infer<typeof MappingSourceUnitSchema>;
export type UnitDefinition={family:'area'|'length'|'count';unit:'m2'|'m'|'count';factor:number|null;
  state:'supported'|'needs_input';source:string|null;meaning:string};
const si='https://www.bipm.org/en/publications/si-brochure';
const nist='https://physics.nist.gov/cuu/pdf/sp811.pdf';
const unresolved=(meaning:string):UnitDefinition=>({family:'area',unit:'m2',factor:null,state:'needs_input',source:null,meaning});
/** Code-owned factors only. NIST SP 811 Appendix B.8: foot = 0.3048 m and yard = 0.9144 m, exact. */
export const UNIT_TABLE:Readonly<Record<Unit,UnitDefinition>>=Object.freeze({
  m2:{family:'area',unit:'m2',factor:1,state:'supported',source:si,meaning:'SI square metre; identity conversion.'},
  ft2:{family:'area',unit:'m2',factor:0.09290304,state:'supported',source:nist,meaning:'International square foot: (0.3048 m)^2, exact by definition; not US survey foot.'},
  sq_yd:{family:'area',unit:'m2',factor:0.83612736,state:'supported',source:nist,meaning:'Square yard: (0.9144 m)^2, exact by definition.'},
  // Do not substitute a web-vendor equivalence for an inspected Indian government definition.
  gaj:unresolved('Indian government gaj = square-yard citation not yet verified; request source meaning.'),
  marla:unresolved('Regional marla definition and official state factor required.'),
  bigha:unresolved('Regional bigha definition and official state factor required.'),
  kanal:unresolved('Regional kanal definition and official state factor required.'),
  cent:unresolved('Official applicable state cent factor required.'),
  guntha:unresolved('Official applicable state guntha factor required.'),
  m:{family:'length',unit:'m',factor:1,state:'supported',source:si,meaning:'SI metre; identity conversion.'},
  ft:{family:'length',unit:'m',factor:0.3048,state:'supported',source:nist,meaning:'International foot, exact by definition; not US survey foot.'},
  count:{family:'count',unit:'count',factor:1,state:'supported',source:si,meaning:'Dimensionless explicit count; identity only.'},
});
/** Tokens recognised in source cells; disagreement with a declared unit fails closed. */
export const UNIT_SUFFIXES:Readonly<Record<Unit,RegExp>>={
  m2:/^(?:m²|m2|sq\.?\s*m(?:et(?:er|re)s?)?|square\s*met(?:er|re)s?)$/i,
  ft2:/^(?:ft²|ft2|sq\.?\s*ft|sq\.?\s*feet|square\s*f(?:oo|ee)t)$/i,
  sq_yd:/^(?:yd²|yd2|sq\.?\s*yds?|sq\.?\s*yards?|square\s*yards?)$/i,
  gaj:/^(?:gaj|गज)$/i,marla:/^marlas?$/i,bigha:/^bighas?$/i,kanal:/^kanals?$/i,
  cent:/^cents?$/i,guntha:/^(?:gunthas?|guntas?)$/i,m:/^(?:m|met(?:er|re)s?)$/i,
  ft:/^(?:ft|f(?:oo|ee)t)$/i,count:/^count$/i,
};
