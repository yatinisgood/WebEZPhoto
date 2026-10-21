'use strict';
const $ = id => document.getElementById(id);
const films = [
  {name:'Classic Neg',sub:'經典負片',iso:400,description:'柔和褪色、沉穩綠調，讓日常多一點懷舊的溫度。',contrast:1.08,saturation:.78,tint:[6,3,-5],lift:10},
  {name:'Chrome',sub:'鮮明正片',iso:100,description:'清透色彩與鮮明層次，留住晴天與旅行的光。',contrast:1.15,saturation:1.25,tint:[-3,3,3],lift:0},
  {name:'Mono',sub:'經典黑白',iso:400,description:'卸下色彩，用細膩灰階與光影，說一個簡單的故事。',contrast:1.18,saturation:0,tint:[0,0,0],lift:4},
  {name:'Max',sub:'暖調日常',iso:200,description:'溫暖金黃、飽滿色彩，收藏午後的陽光和生活片刻。',contrast:1.05,saturation:1.13,tint:[12,5,-10],lift:3},
  {name:'800 Cine',sub:'電影氛圍',iso:800,description:'冷青暗部與琥珀高光，為每一幕增添電影的情緒。',contrast:1.12,saturation:.85,tint:[3,2,-3],lift:5}
];
let selected = 0, source = null, sourceName = 'photo', comparing = false, frame = 0, loadVersion = 0, exporting = false;
let zoom = 1, centerX = .5, centerY = .5, pan = null;
const preview = $('preview'), ctx = preview.getContext('2d', {willReadFrequently:true});
const base = document.createElement('canvas');
const baseCtx = base.getContext('2d', {willReadFrequently:true});
function demo() {
  base.width=1440; base.height=800;
  const c=baseCtx; const sky=c.createLinearGradient(0,0,0,800);sky.addColorStop(0,'#7cabae');sky.addColorStop(.57,'#d4d6ad');sky.addColorStop(1,'#7b9e8a');c.fillStyle=sky;c.fillRect(0,0,1440,800);
  c.fillStyle='#f0e4b6';c.beginPath();c.arc(1060,170,59,0,Math.PI*2);c.fill();
  function ridge(points,color){c.fillStyle=color;c.beginPath();c.moveTo(0,800);points.forEach(p=>c.lineTo(...p));c.lineTo(1440,800);c.fill();}
  ridge([[0,430],[170,350],[340,400],[570,245],[760,395],[940,330],[1200,410],[1440,310]],'#829e95');
  ridge([[0,520],[180,420],[390,490],[620,380],[830,510],[1080,395],[1440,520]],'#567f73');
  ridge([[0,650],[230,570],[420,620],[680,490],[890,580],[1100,545],[1440,650]],'#385e4c');
  ridge([[0,710],[250,680],[550,740],[900,650],[1200,710],[1440,660]],'#254336');
  c.fillStyle='#b9b98b';c.beginPath();c.moveTo(660,800);c.bezierCurveTo(1020,680,640,650,880,578);c.bezierCurveTo(720,660,1120,680,810,800);c.fill();
}
function makePreview(){
  if(source){const scale=Math.min(1,1600/Math.max(source.width,source.height));base.width=Math.max(1,Math.round(source.width*scale));base.height=Math.max(1,Math.round(source.height*scale));baseCtx.drawImage(source,0,0,base.width,base.height);}else demo();
  preview.width=base.width;preview.height=base.height;render();
}
function processPixels(data,width,height){
 const f=films[selected], strength=.8,tint=Number($('tint').value)/100,warmth=Number($('warmth').value)/100,exposure=2**(Number($('exposure').value)/10);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],l=.2126*r+.7152*g+.0722*b;
  let channels=[r,g,b].map((v,k)=>((l+(v-l)*f.saturation)-128)*f.contrast+128+f.tint[k]+f.lift*(1-l/255));
  if(selected===4){const shadow=Math.max(0,1-l/140),light=Math.max(0,(l-120)/135);channels[0]+=light*12-shadow*9;channels[1]+=shadow*6;channels[2]+=shadow*12-light*9;}
  const nx=x/width-.5,ny=y/height-.5,vignette=1-strength*.2*(nx*nx+ny*ny);
  // Coordinate-based grain stays stable between previews and repeated exports.
  const grain=(((Math.imul(x+1,374761393)^Math.imul(y+1,668265263))>>>0)%101/100-.5)*(selected===4?7:3)*strength;
  for(let k=0;k<3;k++){let value=[r,g,b][k]*(1-strength)+channels[k]*strength;value+=(k===0?warmth*19:k===2?-warmth*19:warmth*2);value+=tint*(k===1?-12:12);data[i+k]=Math.max(0,Math.min(255,value*exposure*vignette+grain));}
 }
}
function cropRect(width,height){
 const w=width/zoom,h=height/zoom;
 centerX=Math.max(.5/zoom,Math.min(1-.5/zoom,centerX));
 centerY=Math.max(.5/zoom,Math.min(1-.5/zoom,centerY));
 return [centerX*width-w/2,centerY*height-h/2,w,h];
}
function resetFraming(){zoom=1;centerX=centerY=.5;$('zoom').value='1';preview.classList.remove('zoomed');}
function setZoom(value){zoom=Number(value);$('zoom').value=String(zoom);cropRect(base.width,base.height);preview.classList.toggle('zoomed',zoom>1);schedule();}
$('zoom').addEventListener('change',()=>setZoom($('zoom').value));
preview.addEventListener('pointerdown',e=>{
 if(zoom<=1||e.button!==0)return;
 const box=preview.getBoundingClientRect(),fit=Math.min(box.width/base.width,box.height/base.height);
 pan={id:e.pointerId,x:e.clientX,y:e.clientY,cx:centerX,cy:centerY,width:base.width*fit,height:base.height*fit};
 preview.setPointerCapture(e.pointerId);preview.classList.add('panning');
});
preview.addEventListener('pointermove',e=>{if(!pan||pan.id!==e.pointerId)return;centerX=pan.cx-(e.clientX-pan.x)/(pan.width*zoom);centerY=pan.cy-(e.clientY-pan.y)/(pan.height*zoom);cropRect(base.width,base.height);schedule();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])preview.addEventListener(event,()=>{pan=null;preview.classList.remove('panning');});
preview.addEventListener('dblclick',()=>{resetFraming();schedule();});
preview.addEventListener('keydown',e=>{const moves={ArrowLeft:[1,0],ArrowRight:[-1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};if(zoom>1&&moves[e.key]){e.preventDefault();centerX+=moves[e.key][0]*.03/zoom;centerY+=moves[e.key][1]*.03/zoom;cropRect(base.width,base.height);schedule();}});
function render(){ctx.clearRect(0,0,preview.width,preview.height);ctx.drawImage(base,...cropRect(base.width,base.height),0,0,preview.width,preview.height);if(!comparing){const pixels=ctx.getImageData(0,0,preview.width,preview.height);processPixels(pixels.data,preview.width,preview.height);ctx.putImageData(pixels,0,0);} $('preview-state').textContent=comparing?'ORIGINAL':'FILM PREVIEW';}
function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(render);}
function selectFilm(index){selected=index;$('current-film').style.backgroundPosition=`${index*25}% 50%`;$('current-film').setAttribute('aria-label',`選擇下一款底片，現在使用 ${films[index].name}`);$('film-label').textContent=`${films[index].name.toUpperCase()} · ISO ${films[index].iso}`;schedule();}
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
 try{const img=new Image();img.src=url;await img.decode();if(version!==loadVersion)return;if(img.naturalWidth*img.naturalHeight>60000000)throw new Error('照片超過 6,000 萬像素，請縮小後再試。');source=img;resetFraming();sourceName=file.name.replace(/\.[^.]+$/,'');$('empty-hint').hidden=true;$('image-label').textContent=file.name.length>28?file.name.slice(0,25)+'…':file.name;$('dimensions').textContent=`${img.naturalWidth} × ${img.naturalHeight}`;makePreview();$('status').textContent='照片已載入。選擇底片、微調色彩，按頂部快門下載。';}catch(error){if(version===loadVersion)$('status').textContent=error.message.startsWith('照片超過')?error.message:'無法讀取這張照片，請確認檔案完整或換一張試試。';}finally{URL.revokeObjectURL(url);}
}
const drop=$('dropzone');['dragenter','dragover'].forEach(event=>drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragging');}));['dragleave','drop'].forEach(event=>drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');}));drop.addEventListener('drop',e=>{if(e.dataTransfer.files[0])loadPhoto(e.dataTransfer.files[0]);});window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
$('grid').onclick=()=>{const shown=$('grid-overlay').hidden;$('grid-overlay').hidden=!shown;$('grid').setAttribute('aria-pressed',shown);};
function compare(value){if(comparing!==value){comparing=value;render();}}
$('compare').addEventListener('pointerdown',e=>{$('compare').setPointerCapture(e.pointerId);compare(true);});['pointerup','pointercancel','lostpointercapture','blur'].forEach(event=>$('compare').addEventListener(event,()=>compare(false)));$('compare').addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();compare(true);}});$('compare').addEventListener('keyup',()=>compare(false));window.addEventListener('blur',()=>compare(false));
$('reset').onclick=()=>{resetFraming();$('tint').value=0;$('warmth').value=0;$('exposure').value=0;updateOutputs();selectFilm(0);$('status').textContent='已恢復 Classic Neg 與預設調整值。';};
async function downloadPhoto(){
 if(!source||exporting)return;exporting=true;$('top-shutter').disabled=true;$('top-shutter').setAttribute('aria-busy','true');$('status').textContent='正在裝置內顯影，請稍候…';
 try{await new Promise(resolve=>setTimeout(resolve,40));const out=document.createElement('canvas');const crop=cropRect(source.width,source.height);const scale=Math.min(1,4096/Math.max(crop[2],crop[3]));out.width=Math.max(1,Math.round(crop[2]*scale));out.height=Math.max(1,Math.round(crop[3]*scale));const context=out.getContext('2d');context.drawImage(source,...crop,0,0,out.width,out.height);const pixels=context.getImageData(0,0,out.width,out.height);processPixels(pixels.data,out.width,out.height);context.putImageData(pixels,0,0);const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));if(!blob)throw new Error('Export failed');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${sourceName}-EZ-${films[selected].name.replace(/ /g,'-')}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);$('status').textContent=`已下載 ${out.width} × ${out.height} PNG 照片${scale<1?'（長邊縮至 4096 px）':''}。照片沒有離開你的裝置。`;out.width=out.height=0;}catch{$('status').textContent='下載失敗，可能是裝置記憶體不足；請縮小照片後再試。';}finally{exporting=false;$('top-shutter').disabled=false;$('top-shutter').removeAttribute('aria-busy');}
};
makePreview();selectFilm(0);

$('top-dial').onclick=()=>{const stops=[1,1.4,2,3];setZoom(stops[(stops.indexOf(zoom)+1)%stops.length]);};
$('top-shutter').onclick=()=>source ? downloadPhoto() : $('file').click();
