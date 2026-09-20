import { ArrowUpRight, Check, Minus } from 'lucide-react';
import styles from './explainer.module.css';

export default function Results() {
  return <div className={styles.results}>
    <div className={styles.resultMetrics}>
      <article><span className={styles.eyebrow}>FLOOR-PLAN SEGMENTATION</span><h2>CubiCasa5K</h2><div className={styles.bigMetric}>0.656 <span>mean class IoU</span></div><div className={styles.metricTrack}><span style={{width:'65.622%'}}/></div><p>2 published test plans · 12 present classes</p><p className={styles.metricLimit}>Some rooms merge; garage and other classes perform poorly.</p></article>
      <article><span className={styles.eyebrow}>BUILDING SEGMENTATION</span><h2>RF-DETR</h2><div className={styles.bigMetric}>0.287 <span>aggregate IoU</span></div><div className={styles.metricTrack}><span style={{width:'28.738%'}}/></div><p>12 aerial test tiles · includes 4 empty targets</p><p className={styles.metricLimit}>Substantial false positives on blurred or unfamiliar imagery.</p></article>
    </div>
    <p className={styles.metricExplanation}>IoU measures predicted/reference overlap: intersection ÷ union. The floor and building results use different aggregation methods and datasets; these bars are not a model ranking. Small feasibility samples do not establish cadastral accuracy.</p>
    <div className={styles.proofColumns}>
      <section><span className={styles.eyebrow}>WHAT THE RETAINED TEST PROVES</span><h2>A complete reviewed handoff.</h2><ul>{['Actual local CPU model inference','220 selected contour vertices preserved','Reviewed geometry built and technically recorded','Original bytes unchanged through retries and recording'].map(s=><li key={s}><Check size={17}/>{s}</li>)}</ul></section>
      <section><span className={styles.eyebrow}>WHAT IT DOES NOT PROVE</span><h2>Clear limits, visible errors.</h2><ul>{['Correct legal room or parcel boundaries','Automatic ownership, height or floor-count inference','Accuracy on arbitrary or Indian survey imagery','Training a new foundation model from scratch'].map(s=><li key={s}><Minus size={17}/>{s}</li>)}</ul></section>
    </div>
    <div className={styles.contribution}><span className={styles.eyebrow}>THE ENGINEERING CONTRIBUTION</span><p>Pretrained models, integrated into a traceable workflow.</p><div><span>Verified model artifacts</span><span>Durable jobs & retries</span><span>Pixel-aligned review</span><span>Metric calibration</span><span>Revision-safe recording</span></div></div>
    <div className={styles.evidenceLinks}><a href="/explainer/evaluation.md" download>Download evaluation report <ArrowUpRight size={15}/></a><a href="/explainer/workflow-evidence.md" download>Download workflow evidence <ArrowUpRight size={15}/></a></div>
    <p className={styles.attribution}>Sources: <a href="https://doi.org/10.5281/zenodo.2613548" target="_blank" rel="noreferrer">CubiCasa5K</a> (noncommercial CC-BY-NC-4.0 model scope); <a href="https://huggingface.co/merve/rf-detr-seg-satellite-buildings/tree/05b80dce9a57701724ad6a0fc052827c8b724257" target="_blank" rel="noreferrer">RF-DETR satellite checkpoint</a> (Apache-2.0 model card); <a href="https://huggingface.co/datasets/hotosm/vhr-building-segmentation/tree/8d3e64e5c69aa37209953cce3a48df1092bc7c94" target="_blank" rel="noreferrer">HOTOSM evaluation data</a> (OAM imagery / OSM annotations; separate attribution terms).</p>
  </div>;
}
