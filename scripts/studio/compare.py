"""Build labelled comparisons from actual browser captures, never mockup backdrops."""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont
import hashlib, json, shutil, html

ROOT=Path(__file__).resolve().parents[2]
CAPTURE=ROOT/'docs/evidence/t058/final'
BASE=ROOT/'docs/evidence/t058/baseline'
MOCK=ROOT/'docs/evidence/reference/references'
OUT=ROOT/'apps/web/public/studio-review'
OUT.mkdir(parents=True,exist_ok=True)
font_path=Path('C:/Windows/Fonts/segoeui.ttf')
font=ImageFont.truetype(str(font_path),24) if font_path.exists() else ImageFont.load_default()
sources={
 'mock-map':MOCK/'block.png','mock-register':MOCK/'register.png','mock-workspace':MOCK/'workspace.png',
 'original-map':BASE/'studio-map.png','original-register':BASE/'studio-register.png',
 'current-map':CAPTURE/'map.png','current-register':CAPTURE/'register.png','current-workspace':CAPTURE/'workspace.png',
 'current-close':CAPTURE/'building-close.png','current-utilities':CAPTURE/'utilities.png','current-plan':CAPTURE/'top-down.png',
 'current-mobile-map':CAPTURE/'mobile-map.png','current-mobile-inspector':CAPTURE/'mobile-inspector.png',
}
records={}
for key,path in sources.items():
 data=path.read_bytes();image=Image.open(path);shutil.copyfile(path,OUT/(key+'.png'))
 records[key]={'source':str(path.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(data).hexdigest(),'width':image.width,'height':image.height}
def compare(name,items,scene=False):
 width,height=(1000,865) if scene else (1254,706)
 canvas=Image.new('RGB',(width*len(items),height+58),'#e8eeeb');draw=ImageDraw.Draw(canvas)
 for index,(key,label) in enumerate(items):
  image=Image.open(OUT/(key+'.png')).convert('RGB')
  if scene:
   box=(309,72,1309,937) if key.startswith('mock') else (300,72,1317,925)
   image=image.crop(box)
  image=ImageOps.contain(image,(width,height))
  x=index*width+(width-image.width)//2;y=58+(height-image.height)//2
  canvas.paste(image,(x,y));draw.text((index*width+19,15),label,fill='#254c40',font=font)
 canvas.save(OUT/(name+'.png'))
compare('map-comparison',[('mock-map','Supplied mockup / visual target'),('original-map','Original standalone Studio'),('current-map','Implemented product / actual browser')])
compare('scene-comparison',[('mock-map','Mockup scene crop'),('current-map','Actual implemented scene crop')],scene=True)
compare('register-comparison',[('mock-register','Supplied register mockup'),('original-register','Original standalone Studio'),('current-register','Implemented register / actual browser')])
compare('workspace-comparison',[('mock-workspace','Supplied workspace mockup'),('current-workspace','Implemented workspace / actual browser')])
notes=[
 ('Original Studio first','The original Studio composition was copied before scene changes. The old T057 map-lab composition was not reused as the design baseline.'),
 ('Scene and visual hierarchy','The map keeps the Studio header, rails, inspector, minimap and findings dock. The scene now uses a deliberately authored reference neighbourhood, foreground park, varied facades, roof structures, local materials and contact lighting.'),
 ('Real geometry, not image substitution','All building, tree, road and interior views are rendered. Source mockups are used only in this comparison gallery, never as the map background. The gallery labels actual implementation captures separately.'),
 ('Numbers follow the prepared data','The selected source footprint is 288 m², its volume 4,608 m³ and its parcel 506.25 m². The 32 m² outside-parcel region and 16 m² road-overlap region overlap and are not summed. Mockup numbers are not source truth.'),
 ('Document and record consistency','903 prepared synthetic PDFs, 239 floor plans and 478 unit records are linked to a validated ulpin-spatial/2 snapshot. The same room layout is used by the SVG plan, 3D cutaway, register and PDFs.'),
 ('Known visual differences','The original target is a photorealistic generated illustration. This product uses explicit geometry and reusable procedural architecture: tree silhouettes, facade weathering, pavement details and exact neighbourhood arrangement are not pixel-identical. No user approval or perceptual score is invented.'),
 ('Workflow boundaries','Source uploads use the existing backend. Workspace measurements and revisioned review drafts are explicitly local drafts, not official or registry publication. Imported real neighbourhoods remain accessible through the original saved-data routes; this authored quarter is not a replacement for them.'),
]
text=''.join('<article><h3>'+html.escape(title)+'</h3><p>'+html.escape(body)+'</p></article>' for title,body in notes)
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>City Studio · reference comparison</title><style>
*{box-sizing:border-box}body{font:15px/1.65 system-ui,sans-serif;color:#2c4c43;background:#f1f5f2;margin:0}header{padding:35px 4vw;background:#fff;border-bottom:1px solid #d9e5dd}h1{font-size:30px;line-height:1.2;margin:7px 0}header p{max-width:850px;color:#72867b}main{padding:20px 4vw 60px}h2{margin-top:45px;font-size:21px}a{color:#276d53}nav{display:flex;gap:20px;flex-wrap:wrap}section{background:#fff;padding:14px;border:1px solid #dce6df;border-radius:9px}.comparison{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.comparison.two{grid-template-columns:repeat(2,minmax(0,1fr))}figure{margin:0}figcaption{font-size:11px;padding:7px;color:#5a7568}img{width:100%;display:block;cursor:zoom-in;border:1px solid #e5eae6}.full{display:block;width:100%;overflow:auto}.mobile{display:flex;gap:20px}.mobile img{width:auto;max-width:390px;max-height:740px}.notes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;background:transparent;border:0;padding:0}.notes article{padding:20px;background:#fff;border:1px solid #dce6df;border-radius:7px}.notes h3{font-size:15px;margin-top:0}.notes p{font-size:13px;color:#778c7d}.eyebrow{font-size:10px;letter-spacing:2px;color:#6e9480}.caption{font-size:12px;color:#7c8f81}@media(max-width:800px){.comparison,.comparison.two,.notes{grid-template-columns:1fr}.mobile{overflow:auto}.mobile img{max-width:82vw}}dialog{padding:12px;max-width:96vw;max-height:95vh;border:1px solid #9ebbaa;border-radius:8px}dialog img{max-height:87vh;width:auto;max-width:92vw;object-fit:contain}dialog button{display:block;margin:0 0 10px auto;padding:6px 16px;background:#285b48;color:white;border:0;border-radius:4px}dialog::backdrop{background:#14251cd6}
</style><header><span class="eyebrow">T058 · ACTUAL BROWSER EVIDENCE</span><h1>City Studio: source, reference and implementation</h1><p>The original standalone Studio and the image mockups are shown alongside real captures of the rebuilt product. Open an image to inspect it at full size.</p><nav><a href="/studio">Open implemented Studio</a><a href="#map">Map comparison</a><a href="#register">Register</a><a href="#workspace">Workspace</a><a href="#review">Review notes</a></nav></header><main>
<h2 id="map">01 / Complete map</h2><section class="comparison"><figure><img src="mock-map.png"><figcaption>Supplied image mockup — art direction, not runtime evidence.</figcaption></figure><figure><img src="original-map.png"><figcaption>Original standalone Studio, captured before changes.</figcaption></figure><figure><img src="current-map.png"><figcaption>Implemented product with prepared sources and actual 3D geometry.</figcaption></figure></section>
<h2>02 / Scene-only detail</h2><section><img src="scene-comparison.png"></section>
<h2 id="register">03 / Register and exact units</h2><section class="comparison"><figure><img src="mock-register.png"><figcaption>Supplied register mockup.</figcaption></figure><figure><img src="original-register.png"><figcaption>Original standalone register.</figcaption></figure><figure><img src="current-register.png"><figcaption>Implemented register using the shared viewport and prepared unit records.</figcaption></figure></section>
<h2 id="workspace">04 / Source-plan workspace</h2><section class="comparison two"><figure><img src="mock-workspace.png"><figcaption>Supplied workspace mockup.</figcaption></figure><figure><img src="current-workspace.png"><figcaption>Implemented source inspection, measurements, review draft and shared 3D preview.</figcaption></figure></section>
<h2>05 / Alternate operating views</h2><section class="comparison"><figure><img src="current-close.png"><figcaption>Actual building inspection.</figcaption></figure><figure><img src="current-utilities.png"><figcaption>Utility depths and horizontal clearance remain separate.</figcaption></figure><figure><img src="current-plan.png"><figcaption>Top-down view from the same scene.</figcaption></figure></section>
<h2>06 / Responsive implementation</h2><section class="mobile"><img src="current-mobile-map.png"><img src="current-mobile-inspector.png"></section><h2 id="review">Review and boundaries</h2><section class="notes">'''+text+'''</section><p class="caption">Viewport: 1672 × 941 for desktop; 390 × 844 for mobile. Mobile is browser emulation, not a physical-device test. Original and current image checksums are in comparison-manifest.json.</p></main><dialog><button>Close</button><img></dialog><script>const d=document.querySelector('dialog');document.querySelectorAll('main img').forEach(i=>i.addEventListener('click',()=>{d.querySelector('img').src=i.src;d.showModal()}));d.querySelector('button').onclick=()=>d.close();d.addEventListener('click',e=>{if(e.target===d)d.close()});</script></html>'''
(OUT/'index.html').write_text(page,encoding='utf-8')
(OUT/'comparison-manifest.json').write_text(json.dumps({'kind':'labelled-original-and-runtime-comparison','images':records,'reviewNotes':notes},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'gallery':str(OUT.relative_to(ROOT)),'images':len(records),'comparisons':4,'notClaimed':'Pixel equivalence, original user approval or photogrammetric accuracy'}))
