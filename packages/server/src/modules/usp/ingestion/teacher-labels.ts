import {createReadStream,openSync,writeSync,closeSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {ColumnProfileDocumentSchema,type ColumnProfileDocument,type MappingV2Operation,type MappingTarget} from '@ulpin/contracts';
import {validateMappingPlanV2,layoutFingerprint} from './mapping-plan-v2';
import {executeMappingPlanV2,type MappingRow} from './mapping-executor';
import {columnProfileHash,mappingContextFromColumnProfile,type TeacherDataPolicy} from './mapping-teacher';

export const DEVELOPMENT_TEACHER_METHOD='model:claude-opus-5-5@dev-2026-10';
export type TeacherProfileEntry={profile:ColumnProfileDocument;dataPolicy:TeacherDataPolicy;rows?:MappingRow[];sourceRef?:string};
export type PseudoLabelExample={layoutFingerprint:string;columnProfile:ColumnProfileDocument['columns'][number];
  target:MappingTarget;operation:MappingV2Operation;method:string;verified:boolean;labelKind:'pseudo_label';profileHash:string};
const labelSchema=z.strictObject({profileHash:z.string().regex(/^[a-f0-9]{64}$/),plan:z.unknown(),method:z.literal(DEVELOPMENT_TEACHER_METHOD)});
/** Public development profiles only; passing this verifier is NOT independent truth or officer approval. */
export async function ingestTeacherLabels(inputPath:string,profiles:ReadonlyMap<string,TeacherProfileEntry>,outputPath:string){
  for(const path of [inputPath,outputPath])if(/(?:^|[\\/])\.env(?:\.|$)/i.test(path))throw new Error('TEACHER_LABEL_PATH_FORBIDDEN');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../../../..'),rel=relative(root,resolve(outputPath));
  if(!rel.startsWith('..')&&!isAbsolute(rel))throw new Error('TEACHER_LABEL_OUTPUT_IN_GIT');
  // Exclusive create: never replace/append a pre-existing training artifact.
  const fd=openSync(outputPath,'wx',0o600);
  const report={accepted:0,rejected:0,examples:0,verifiedExamples:0,rejections:[] as {line:number;codes:string[]}[]};
  const lines=createInterface({input:createReadStream(inputPath),crlfDelay:Infinity});let lineNumber=0;
  const reject=(codes:string[])=>{report.rejected++;report.rejections.push({line:lineNumber,codes});};
  try{
    for await(const line of lines){lineNumber++;if(!line.trim())continue;
      try{
        if(line.length>1024*1024){reject(['TEACHER_LABEL_LIMIT']);continue;}
        const label=labelSchema.safeParse(JSON.parse(line));if(!label.success){reject(['TEACHER_LABEL_SCHEMA_INVALID']);continue;}
        const entry=profiles.get(label.data.profileHash);
        if(!entry||entry.dataPolicy.dataClass!=='public'||entry.dataPolicy.split==='held_out'){
          reject(['TEACHER_LABEL_PROFILE_DENIED']);continue;
        }
        const profile=ColumnProfileDocumentSchema.parse(entry.profile);
        if(columnProfileHash(profile)!==label.data.profileHash||profile.layoutFingerprint!==layoutFingerprint(profile.columns)){reject(['TEACHER_LABEL_PROFILE_MISMATCH']);continue;}
        const checked=validateMappingPlanV2(label.data.plan,mappingContextFromColumnProfile(profile));
        if(!checked.success){reject(checked.errors.map(error=>error.code));continue;}
        if(checked.plan.method!==label.data.method){reject(['TEACHER_LABEL_METHOD_MISMATCH']);continue;}
        let verified=false;
        if(entry.rows?.length&&entry.sourceRef){
          const dry=executeMappingPlanV2(checked.plan,entry.rows,{...mappingContextFromColumnProfile(profile),
            sourceRef:entry.sourceRef,rowCount:entry.rows.length});
          if(dry.counts.needsInput||dry.counts.conflicting){reject(['TEACHER_LABEL_DRY_RUN_FAILED']);continue;}
          verified=true;
        }
        const examples=checked.plan.fields.map(field=>{
          const example:PseudoLabelExample={layoutFingerprint:profile.layoutFingerprint,
            columnProfile:profile.columns.find(column=>column.name===field.sourceField)!,target:field.target,
            operation:field.operation,method:label.data.method,verified,labelKind:'pseudo_label',profileHash:label.data.profileHash};
          return example;
        });
        writeSync(fd,examples.map(example=>JSON.stringify(example)+'\n').join(''));
        report.examples+=examples.length;if(verified)report.verifiedExamples+=examples.length;
        report.accepted++;
      }catch{reject(['TEACHER_LABEL_INVALID']);}
    }
  }finally{closeSync(fd);lines.close();}
  return report;
}
