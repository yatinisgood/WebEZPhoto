'use strict';
const $ = id => document.getElementById(id);
const films = [
  {name:'Classic Neg',recipe:'classic',art:'assets/P5.png',iso:400},
  {name:'Evergreen',recipe:'evergreen',art:'assets/P4.png',iso:100},
  {name:'Nocturne',recipe:'nocturne',art:'assets/P2.png',iso:800},
  {name:'Solara',recipe:'solara',art:'assets/P1.png',iso:200},
  {name:'800 Cine',recipe:'cine',art:'assets/P3.png',iso:800}
];
let selected = 0, source = null, sourceName = 'photo', comparing = false, frame = 0, loadVersion = 0, exporting = false;
let zoom = 1, centerX = .5, centerY = .5, pan = null;
const Geo = globalThis.EZGeometry;
// The screen is always 3:2; the preview buffer matches so no letterbox can appear.
const SCREEN_WIDTH = 1080, SCREEN_HEIGHT = Math.round(SCREEN_WIDTH / Geo.SCREEN_RATIO);
let outputRatio = Geo.RATIOS[0];
const preview = $('preview'), ctx = preview.getContext('2d', {willReadFrequently:true});
const base = document.createElement('canvas');
const baseCtx = base.getContext('2d', {willReadFrequently:true});
let filmContext = null, filmContextKey = '';
function getFilmContext(){
 const options={film:films[selected].recipe,warmth:Number($('warmth').value)/100,tint:Number($('tint').value)/100,ev:Number($('exposure').value)/10};
 const key=JSON.stringify(options);
 if(!filmContext||key!==filmContextKey){filmContext=EZFilm.prepare(baseCtx.getImageData(0,0,base.width,base.height).data,base.width,base.height,options);filmContextKey=key;}
 return filmContext;
}
function photoRegion(rect,width,height){return {x:rect.x/width,y:rect.y/height,width:rect.width/width,height:rect.height/height};}
function demo() {
  // 3:2 so the placeholder fills the viewfinder exactly, like a loaded photo would.
  base.width=1440; base.height=960;
  const c=baseCtx; c.setTransform(1,0,0,1,0,0);
  const sky=c.createLinearGradient(0,0,0,960);sky.addColorStop(0,'#7cabae');sky.addColorStop(.62,'#d4d6ad');sky.addColorStop(1,'#7b9e8a');c.fillStyle=sky;c.fillRect(0,0,1440,960);
  c.fillStyle='#f0e4b6';c.beginPath();c.arc(1060,205,59,0,Math.PI*2);c.fill();
  c.translate(0,160);
  function ridge(points,color){c.fillStyle=color;c.beginPath();c.moveTo(0,800);points.forEach(p=>c.lineTo(...p));c.lineTo(1440,800);c.fill();}
  ridge([[0,430],[170,350],[340,400],[570,245],[760,395],[940,330],[1200,410],[1440,310]],'#829e95');
  ridge([[0,520],[180,420],[390,490],[620,380],[830,510],[1080,395],[1440,520]],'#567f73');
  ridge([[0,650],[230,570],[420,620],[680,490],[890,580],[1100,545],[1440,650]],'#385e4c');
  ridge([[0,710],[250,680],[550,740],[900,650],[1200,710],[1440,660]],'#254336');
  c.fillStyle='#b9b98b';c.beginPath();c.moveTo(660,800);c.bezierCurveTo(1020,680,640,650,880,578);c.bezierCurveTo(720,660,1120,680,810,800);c.fill();
  c.setTransform(1,0,0,1,0,0);
}
function makePreview(){
  filmContext=null;
  if(source){const scale=Math.min(1,1600/Math.max(source.width,source.height));base.width=Math.max(1,Math.round(source.width*scale));base.height=Math.max(1,Math.round(source.height*scale));baseCtx.drawImage(source,0,0,base.width,base.height);}else demo();
  preview.width=SCREEN_WIDTH;preview.height=SCREEN_HEIGHT;render();
}
// Every framing question — preview, overlay, export — is answered here.
function framing(width,height){const geo=Geo.frame({imageWidth:width,imageHeight:height,zoom,centerX,centerY,ratio:outputRatio.value});centerX=geo.centerX;centerY=geo.centerY;return geo;}
function syncOverlay(geo){const style=$('crop-frame').style;style.left=`${geo.box.left}%`;style.top=`${geo.box.top}%`;style.width=`${geo.box.width}%`;style.height=`${geo.box.height}%`;preview.classList.toggle('zoomed',geo.pannable&&!!source);}
function syncZoom(){ $('zoom').value=String(zoom);$('zoom-value').textContent=`${zoom.toFixed(2)}×`;$('zoom').setAttribute('aria-valuetext',`${zoom.toFixed(2)} 倍`); }
function resetFraming(){zoom=1;centerX=centerY=.5;syncZoom();updateDimensions();}
function setZoom(value){zoom=Math.max(1,Math.min(3,Number(value)||1));syncZoom();updateDimensions();schedule();}
// The screen label advertises the real file you will get, not the preview buffer.
function updateDimensions(){
 if(!source){$('dimensions').textContent=`EZ PHOTO / ${outputRatio.id}`;return;}
 const geo=Geo.frame({imageWidth:source.naturalWidth,imageHeight:source.naturalHeight,zoom,centerX,centerY,ratio:outputRatio.value});
 const size=Geo.exportSize(geo.crop,outputRatio.value,4096);
 $('dimensions').textContent=`${size.width} × ${size.height} · ${outputRatio.id}`;
}
$('zoom').addEventListener('input',()=>setZoom($('zoom').value));
for(const ratio of Geo.RATIOS)$('ratio').add(new Option(ratio.label,ratio.id));
// Switching the output ratio only moves the crop box; zoom and centre survive.
function setRatio(id){outputRatio=Geo.RATIOS.find(r=>r.id===id)||Geo.RATIOS[0];$('ratio').value=outputRatio.id;updateDimensions();if(base.width)syncOverlay(framing(base.width,base.height));schedule();}
$('ratio').addEventListener('change',()=>setRatio($('ratio').value));
preview.addEventListener('pointerdown',e=>{
 if(!source||e.button!==0)return;
 const geo=framing(base.width,base.height);
 if(!geo.pannable)return;
 const box=preview.getBoundingClientRect();
 pan={id:e.pointerId,x:e.clientX,y:e.clientY,cx:centerX,cy:centerY,fx:geo.fx/box.width,fy:geo.fy/box.height};
 preview.setPointerCapture(e.pointerId);preview.classList.add('panning');
});
preview.addEventListener('pointermove',e=>{if(!pan||pan.id!==e.pointerId)return;e.preventDefault();centerX=pan.cx-(e.clientX-pan.x)*pan.fx;centerY=pan.cy-(e.clientY-pan.y)*pan.fy;schedule();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])preview.addEventListener(event,()=>{pan=null;preview.classList.remove('panning');});
preview.addEventListener('dblclick',()=>{resetFraming();schedule();});
preview.addEventListener('keydown',e=>{const moves={ArrowLeft:[1,0],ArrowRight:[-1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};if(!moves[e.key]||!source)return;const geo=framing(base.width,base.height);if(!geo.pannable)return;e.preventDefault();centerX+=moves[e.key][0]*.03*geo.fx;centerY+=moves[e.key][1]*.03*geo.fy;schedule();});
function render(){const geo=framing(base.width,base.height);ctx.clearRect(0,0,preview.width,preview.height);ctx.drawImage(base,geo.screen.x,geo.screen.y,geo.screen.width,geo.screen.height,0,0,preview.width,preview.height);if(!comparing){const pixels=ctx.getImageData(0,0,preview.width,preview.height);EZFilm.process(pixels.data,preview.width,preview.height,getFilmContext(),photoRegion(geo.screen,base.width,base.height));ctx.putImageData(pixels,0,0);}syncOverlay(geo);$('preview-state').textContent=comparing?'ORIGINAL':'LIVE';}
function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(render);}
function selectFilm(index){selected=index;$('current-film').style.backgroundImage=`url('${films[index].art}')`;$('current-film').setAttribute('aria-label',`選擇下一款底片，現在使用 ${films[index].name}`);$('film-label').textContent=`${films[index].name.toUpperCase()} · ISO ${films[index].iso}`;schedule();}
$('current-film').onclick=()=>selectFilm((selected+1)%films.length);
for(const id of ['tint','warmth','exposure'])$(id).addEventListener('input',()=>{updateOutputs();schedule();});
function updateOutputs(){$('tint-value').textContent=Number($('tint').value)>0?`+${$('tint').value}`:$('tint').value;$('warmth-value').textContent=Number($('warmth').value)>0?`+${$('warmth').value}`:$('warmth').value;$('exposure-value').textContent=`${(Number($('exposure').value)/10).toFixed(1)} EV`;}
for(const id of ['choose','choose-main'])$(id).onclick=()=>$('file').click();
$('file').onchange=()=>{if($('file').files[0])loadPhoto($('file').files[0]);$('file').value='';};
async function loadPhoto(file){
 const version=++loadVersion;
 if(!/^image\/(jpeg|png|webp)$/.test(file.type)){ $('status').textContent='請選擇 JPG、PNG 或 WebP 圖片；HEIC／RAW 請先轉換格式。';return;}
 if(file.size>50*1024*1024){$('status').textContent='這張照片超過 50 MB，請先縮小檔案後再試。';return;}
 const url=URL.createObjectURL(file);$('status').textContent='正在裝入你的照片…';
 try{const img=new Image();img.src=url;await img.decode();if(version!==loadVersion)return;if(img.naturalWidth*img.naturalHeight>60000000)throw new Error('照片超過 6,000 萬像素，請縮小後再試。');source=img;document.querySelector('.preview-live').classList.add('is-active');resetFraming();sourceName=file.name.replace(/\.[^.]+$/,'');$('empty-hint').hidden=true;makePreview();updateDimensions();$('status').textContent='照片已載入。選擇底片、微調色彩，按底片倉旁的銀色快門下載。';}catch(error){if(version===loadVersion)$('status').textContent=error.message.startsWith('照片超過')?error.message:'無法讀取這張照片，請確認檔案完整或換一張試試。';}finally{URL.revokeObjectURL(url);}
}
const drop=$('dropzone');['dragenter','dragover'].forEach(event=>drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragging');}));['dragleave','drop'].forEach(event=>drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');}));drop.addEventListener('drop',e=>{if(e.dataTransfer.files[0])loadPhoto(e.dataTransfer.files[0]);});window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
$('grid').onclick=()=>{const shown=$('grid-overlay').hidden;$('grid-overlay').hidden=!shown;$('grid').setAttribute('aria-pressed',shown);};
function compare(value){if(comparing!==value){comparing=value;render();}}
$('compare').addEventListener('pointerdown',e=>{$('compare').setPointerCapture(e.pointerId);compare(true);});['pointerup','pointercancel','lostpointercapture','blur'].forEach(event=>$('compare').addEventListener(event,()=>compare(false)));$('compare').addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();compare(true);}});$('compare').addEventListener('keyup',()=>compare(false));window.addEventListener('blur',()=>compare(false));
$('reset').onclick=()=>{resetFraming();setRatio(Geo.RATIOS[0].id);$('tint').value=0;$('warmth').value=0;$('exposure').value=0;updateOutputs();selectFilm(0);$('status').textContent='已恢復 Classic Neg、3:2 輸出與預設調整值。';};
async function downloadPhoto(){
 if(!source||exporting)return;exporting=true;$('shutter').disabled=true;$('shutter').setAttribute('aria-busy','true');$('status').textContent='正在裝置內顯影，請稍候…';
 try{
  const exportSource=source, exportName=sourceName, exportFilm=films[selected].name, exportRatio=outputRatio;
  const exportFrame={zoom,centerX,centerY};
  const contextForExport=getFilmContext();
  await new Promise(resolve=>setTimeout(resolve,40));
  // Same geometry as the preview, evaluated against the full-resolution source.
  const geo=Geo.frame({imageWidth:exportSource.naturalWidth,imageHeight:exportSource.naturalHeight,...exportFrame,ratio:exportRatio.value});
  const size=Geo.exportSize(geo.crop,exportRatio.value,4096);const capped=size.width<Math.round(geo.crop.width);
  const out=document.createElement('canvas');out.width=size.width;out.height=size.height;
  const context=out.getContext('2d');context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  context.drawImage(exportSource,geo.crop.x,geo.crop.y,geo.crop.width,geo.crop.height,0,0,out.width,out.height);
  const pixels=context.getImageData(0,0,out.width,out.height);EZFilm.process(pixels.data,out.width,out.height,contextForExport,photoRegion(geo.crop,exportSource.naturalWidth,exportSource.naturalHeight));context.putImageData(pixels,0,0);
  const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));if(!blob)throw new Error('Export failed');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${exportName}-EZ-${exportFilm.replace(/ /g,'-')}-${exportRatio.id.replace(':','x')}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);$('status').textContent=`已下載 ${out.width} × ${out.height} PNG 照片（${exportRatio.id}）${capped?'，長邊縮至 4096 px':''}。照片沒有離開你的裝置。`;out.width=out.height=0;}catch{$('status').textContent='下載失敗，可能是裝置記憶體不足；請縮小照片後再試。';}finally{exporting=false;$('shutter').disabled=false;$('shutter').removeAttribute('aria-busy');}
};
setRatio(Geo.RATIOS[0].id);makePreview();selectFilm(0);

syncZoom();
$('shutter').onclick=()=>source ? downloadPhoto() : $('file').click();
