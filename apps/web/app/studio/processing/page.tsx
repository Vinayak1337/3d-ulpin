import Link from 'next/link';
import {listSpatialDatasets} from '@/lib/server/spatial-datasets';
import { classificationLabel } from '@/lib/ui/provenance';
import styles from '@/features/spatial/dataset-processing/processing.module.css';
export const dynamic='force-dynamic';
export default async function Page(){const datasets=await listSpatialDatasets();return <main className={styles.page}><header className={styles.header}><Link href="/studio/datasets">← Saved maps</Link></header><div className={styles.heading}><div><span className={styles.eyebrow}>PROCESSING</span><h1>Choose a dataset</h1><p>Inspect retained source records and the preparation workflow.</p></div></div>{datasets.map(d=><Link href={`/studio/processing/${d.id}`} key={d.id}><section className={styles.card}><h2>{d.name}</h2><p>{d.buildingCount} buildings · {d.floorCount} supplied floors · {classificationLabel(d.classification)}</p><strong>Open evidence preparation →</strong></section></Link>)}{!datasets.length&&<p>No saved dataset is available.</p>}</main>;}
