import type {ConsolidatedRegistryReport} from '@ulpin/contracts';

const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
/** Fixed print layout over a narrow facts projection, with no external assets or scripts. */
export function consolidatedRegisterHtml(report:ConsolidatedRegistryReport):string {
  const references=new Map(report.sources.map((source,index)=>[source.id,`S${index+1}`]));
  const refs=(ids:string[])=>ids.length?` <span class="refs">[${ids.map(id=>escape(references.get(id)??'Unavailable')).join(', ')}]</span>`:'';
  const fact=(field:ConsolidatedRegistryReport['building']['name'])=>
    `${field.state==='recorded'?escape(field.value):`<span class="state">${escape(field.state)}</span>`}${refs(field.sources)}`;
  const row=(label:string,value:string)=>`<tr><th scope="row">${escape(label)}</th><td>${value}</td></tr>`;
  const iso=(value:string|null)=>value?escape(value.replace('T',' ').replace(/\.\d{3}Z$/,' UTC')):'<span class="state">unknown</span>';
  const b=report.building;
  const byId=new Map(report.records.map(record=>[record.id,record]));
  const label=(id:string)=>{
    const record=byId.get(id);
    if(record)return `${fact(record.name)} · <span class="id">${escape(record.applicationId)}</span>`;
    if(id===b.id)return `${fact(b.name)} · <span class="id">${escape(b.applicationId)}</span>`;
    return `<span class="state">unknown · parent outside selected records</span> (<span class="id">${escape(id)}</span>)`;
  };
  const selection=report.selection.kind==='space'?'Space / unit':report.selection.kind==='floor'?'Floor':'Whole building';
  const renderRecord=(record:ConsolidatedRegistryReport['records'][number])=>`<section class="record">
    <h4>${escape(record.kind==='space'?'Space / unit':record.kind)} · ${fact(record.name)}</h4>
    <table><tbody>${row('Application ID',`<span class="id">${escape(record.applicationId)}</span>`)}
      ${row('Record UUID',`<span class="id">${escape(record.id)}</span>`)}${row('Revision / recorded date',`${record.revision} / ${iso(record.recordedAt)}`)}
      ${row('Recorded links',record.links.length?record.links.map(link=>`${escape(link.type)} → ${label(link.targetId)}`).join('<br>'):'<span class="state">unknown</span>')}
    </tbody></table>
    <h4>Recorded address</h4><table><tbody>
      ${row('Address line',fact(record.address.line))}${row('Locality',fact(record.address.locality))}
      ${row('District / region',`${fact(record.address.district)} / ${fact(record.address.region)}`)}
      ${row('PIN / postal code',fact(record.address.postalCode))}${row('Country',fact(record.address.country))}
    </tbody></table>
    <h4>Ownership claims</h4>${record.ownershipClaims.length?`<table><thead><tr><th>Recorded claimant</th><th>Basis</th></tr></thead><tbody>
      ${record.ownershipClaims.map(claim=>`<tr><td>${fact(claim.party)}</td><td>Ownership claim${refs(claim.sources)}</td></tr>`).join('')}</tbody></table>`:'<p class="state">unknown · No ownership claim is recorded for this record.</p>'}
    <h4>Recorded residents / occupants</h4><p>Status: <span class="state">${escape(record.occupancy.state)}</span>${refs(record.occupancy.sources)}</p>
    ${record.occupancy.people.length?`<table><thead><tr><th>Name</th><th>Recorded role</th><th>Associated record</th></tr></thead><tbody>
      ${record.occupancy.people.map(person=>`<tr><td>${fact(person.name)}</td><td>${escape(person.role)}</td><td class="id">${escape(record.applicationId)}</td></tr>`).join('')}</tbody></table>`:''}
  </section>`;
  const groupTitles={building:'Building records',floor:'Floor and explicitly linked units',multiple_parents:'Multiple recorded parents / cross-floor links',
    outside_selection:'Parent outside selected records',unlinked:'Unknown / unlinked grouping',cycle:'Cyclic links - grouping unresolved'};
  const records=report.groups.map(group=>`<section class="group"><h3>${escape(groupTitles[group.kind])}</h3>
    ${group.parentIds.length?`<p>${group.parentIds.map(label).join('<br>')}</p>`:'<p class="state">No recorded parent is available.</p>'}
    ${group.recordIds.map(id=>byId.get(id)).filter((record):record is NonNullable<typeof record>=>Boolean(record)).map(renderRecord).join('')}
    </section>`).join('');
  const parcels=report.parcels.map(parcel=>`<section class="parcel"><h3>Parcel · <span class="id">${escape(parcel.applicationId)}</span></h3>
    <table><tbody>${row('Parcel UUID / revision',`<span class="id">${escape(parcel.id)}</span> / ${parcel.revision}`)}
      ${row('Recorded association',`${escape(parcel.relationship)} · ${escape(parcel.associationState)}${refs(parcel.sources)}`)}
      ${row('Record authority',escape(parcel.authority))}
      ${row('Official 2D ULPIN assertions',parcel.officialAssertions.length?parcel.officialAssertions.map(assertion=>
        `${fact(assertion.value)} · issuer: ${fact(assertion.issuer)} · status: ${escape(assertion.state)}`).join('<br>'):'<span class="state">unknown</span>')}
    </tbody></table></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Consolidated building registry</title>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>
    @page{size:A4}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.4;color:#202923;margin:0}
    header{border-bottom:2px solid #263e31;padding-bottom:12px;margin-bottom:14px}.eyebrow{font-size:8pt;letter-spacing:1px;text-transform:uppercase;color:#526056}
    h1{font-size:23pt;line-height:1.15;margin:8px 0}h2{font-size:14pt;border-bottom:1px solid #bac6be;padding-bottom:5px;margin:20px 0 9px;break-after:avoid}
    h3{font-size:11pt;margin:14px 0 7px;break-after:avoid;text-transform:capitalize}h4{font-size:10pt;margin:12px 0 5px;break-after:avoid}p{margin:5px 0 9px}
    table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 10px}th,td{text-align:left;vertical-align:top;padding:6px 8px;border:1px solid #d4dcd6;overflow-wrap:anywhere}
    th{font-weight:600;background:#f0f3f0;width:31%}thead{display:table-header-group}tr{break-inside:avoid}.id{font-family:monospace;font-size:8.5pt;overflow-wrap:anywhere}
    .refs{font-size:8pt;color:#405548;white-space:normal}.state{color:#49574e;font-style:italic}.note{border-left:3px solid #748f7d;padding:7px 10px;background:#f4f6f3}
    .source{break-inside:avoid;border-bottom:1px solid #d4dcd6;padding:7px 0;font-size:9pt}.hash{font-family:monospace;font-size:8pt;overflow-wrap:anywhere}
    .limitations{font-size:9pt}.limitations p{margin:5px 0}footer{font-size:8pt;color:#526056;margin-top:14px}a{color:inherit}
    .record{margin-left:10px;border-left:2px solid #d4dcd6;padding-left:10px}.draft{font-weight:bold;border:2px solid #875b21;padding:10px;background:#fff7e9;color:#684415}
    </style></head><body><header><div class="eyebrow">Private registry summary · ${escape(report.schemaVersion)}</div>
    <h1>Consolidated building registry</h1><p>${fact(b.name)}</p><p>Generated ${iso(report.generatedAt)} · ${escape(selection)}</p></header>
    ${report.recordState==='unrecorded'?'<p class="draft">UNRECORDED / awaiting review<br>Source/import summary only. This feature is not recorded or qualified.</p>':'<p>Record state: recorded</p>'}
    <section><h2>Building and scope</h2><table><tbody>
      ${row('Application building ID',`<span class="id">${escape(b.applicationId)}</span>`)}${row('Building UUID',`<span class="id">${escape(b.id)}</span>`)}
      ${row('Building revision / recorded date',`${b.revision} / ${iso(b.recordedAt)}`)}
      ${row('Registry area name',fact(b.areaName))}${row('Area / site revision',`${b.areaRevision} / ${b.siteRevision}`)}
      ${row('Selected record',`<span class="id">${escape(report.selection.id)}</span> · ${escape(report.selection.kind)}`)}
      ${report.sourcePackage?row('Current source/import package',`<span class="id">${escape(report.sourcePackage.id)}</span> · revision ${report.sourcePackage.revision} · ${escape(report.sourcePackage.state)}`):''}
    </tbody></table><p class="note">Application IDs identify building, floor and space records. Official 2D parcel ULPIN assertions appear separately below. A floor is not necessarily a unit.</p></section>
    <section><h2>Explicitly associated parcels</h2>${parcels||`<p class="state">unknown · ${report.recordState==='unrecorded'?'Parcel and legal assertions are excluded from this unrecorded summary.':'No explicit parcel association is recorded here.'} Official parcel ULPIN: unknown.</p>`}</section>
    <section><h2>Registry records, ownership and occupancy</h2>${records||'<p class="state">unknown · No associated canonical building, floor or space registry records are available here.</p><table><tbody><tr><th>Ownership claims</th><td class="state">unknown</td></tr><tr><th>Address / PIN / locality</th><td class="state">unknown</td></tr><tr><th>Residents / occupants</th><td class="state">unknown</td></tr></tbody></table>'}</section>
    <section><h2>Source revision references</h2>${report.sources.map(source=>`<div class="source"><strong>${escape(references.get(source.id))}</strong> · ${escape(source.profile)} · revision ${source.revision}<br>
      Source UUID: <span class="id">${escape(source.id)}</span><br>Received: ${iso(source.receivedAt)}<br>SHA-256: <span class="hash">${escape(source.sha256)}</span></div>`).join('')||'<p class="state">unknown</p>'}</section>
    <section class="limitations"><h2>Scope and unknown data</h2>${report.omissions.map(note=>`<p>${escape(note)}</p>`).join('')}</section>
    <footer>Private record summary. Source originals and source text remain in the authorized evidence workflow.</footer></body></html>`;
}
