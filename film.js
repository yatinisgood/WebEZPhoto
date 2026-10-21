'use strict';
/* Pure pixel pipeline shared by the viewfinder and PNG export. Spatial maps and
 * grain live in full-photo coordinates, never in screen/crop coordinates. */
(function (global) {
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  function smooth(lo, hi, x) { const t = clamp((x - lo) / (hi - lo)); return t * t * (3 - 2 * t); }
  const luma = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
  const PROFILES = {
    solara:   {curve:[.016,.084,.26,.53,.775,.897,.969], seed:11},
    nocturne: {curve:[.003,.045,.19,.51,.82,.942,.991], seed:23},
    cine:     {curve:[.006,.047,.205,.505,.79,.915,.981], seed:37},
    evergreen:{curve:[.002,.049,.205,.525,.81,.94,.993], seed:47},
    classic:  {curve:[.009,.052,.208,.51,.79,.911,.972], seed:59}
  };
  const knots = [0,.08,.25,.5,.75,.9,1];
  // Monotone cubic Hermite curves avoid both hard thresholds and overshoot.
  function curveTable(values) {
    const slopes = [], tangents = [], table = new Float32Array(4097);
    for (let i = 0; i < 6; i++) slopes[i] = (values[i+1]-values[i])/(knots[i+1]-knots[i]);
    tangents[0] = slopes[0]; tangents[6] = slopes[5];
    for (let i = 1; i < 6; i++) tangents[i] = 2*slopes[i-1]*slopes[i]/(slopes[i-1]+slopes[i]);
    let k = 0;
    for (let i = 0; i <= 4096; i++) {
      const x = i/4096;
      while (k < 5 && x > knots[k+1]) k++;
      const span = knots[k+1]-knots[k], t = (x-knots[k])/span, t2=t*t, t3=t2*t;
      table[i]=(2*t3-3*t2+1)*values[k]+(t3-2*t2+t)*span*tangents[k]+(-2*t3+3*t2)*values[k+1]+(t3-t2)*span*tangents[k+1];
    }
    return table;
  }
  for (const profile of Object.values(PROFILES)) profile.table = curveTable(profile.curve);
  function tone(profile, x) {
    if (x >= 1) return 1-(1-profile.curve[6])*Math.exp(-2*(x-1));
    const pos=clamp(x)*4096, i=Math.floor(pos), t=pos-i;
    return profile.table[i]*(1-t)+profile.table[Math.min(4096,i+1)]*t;
  }
  function adjustmentTables(options = {}) {
    const warmth=clamp(options.warmth || 0,-1,1), tint=clamp(options.tint || 0,-1,1);
    const exposure=2**clamp(options.ev || 0,-2,2), tables=[];
    // Exposure is applied in linear light, before the film's highlight shoulder.
    for (let k=0;k<3;k++) {
      const gain=exposure*Math.exp(warmth*[.19,.015,-.19][k]+tint*[.10,-.10,.10][k]);
      const table=new Float32Array(256);
      for (let i=0;i<256;i++) {
        const v=i/255, linear=(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*gain;
        table[i]=linear<=.0031308?linear*12.92:1.055*linear**(1/2.4)-.055;
      }
      tables.push(table);
    }
    return tables;
  }
  function gaussian(input, width, height, sigma) {
    const radius=Math.ceil(3*sigma), kernel=new Float32Array(radius*2+1);
    let total=0;
    for (let i=-radius;i<=radius;i++) total+=(kernel[i+radius]=Math.exp(-i*i/(2*sigma*sigma)));
    for (let i=0;i<kernel.length;i++) kernel[i]/=total;
    const temp=new Float32Array(input.length), out=new Float32Array(input.length);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      let v=0;for(let k=-radius;k<=radius;k++) v+=input[y*width+clamp(x+k,0,width-1)]*kernel[k+radius];
      temp[y*width+x]=v;
    }
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      let v=0;for(let k=-radius;k<=radius;k++) v+=temp[clamp(y+k,0,height-1)*width+x]*kernel[k+radius];
      out[y*width+x]=v;
    }
    return out;
  }
  function sample(map, width, height, u, v) {
    const x=clamp(u*width-.5,0,width-1), y=clamp(v*height-.5,0,height-1);
    const x0=Math.floor(x), y0=Math.floor(y), x1=Math.min(width-1,x0+1), y1=Math.min(height-1,y0+1), tx=x-x0, ty=y-y0;
    return (map[y0*width+x0]*(1-tx)+map[y0*width+x1]*tx)*(1-ty)+(map[y1*width+x0]*(1-tx)+map[y1*width+x1]*tx)*ty;
  }
  // Build the spatial context once from the full preview source. Export reuses
  // exactly these maps, including light sources just outside the crop boundary.
  function prepare(data, width, height, options = {}) {
    const id=options.film || 'classic';
    if (!PROFILES[id]) throw new Error('Unknown film: '+id);
    const tables=adjustmentTables(options), scale=Math.min(1,640/Math.max(width,height));
    const w=Math.max(1,Math.round(width*scale)), h=Math.max(1,Math.round(height*scale)), count=w*h;
    const context={id,tables,width:w,height:h,aspect:width/height};
    if (id!=='cine' && id!=='nocturne') return context;
    const sums=new Float32Array(count), alpha=new Float32Array(count), lights=new Float32Array(count);
    const weights=new Uint32Array(count);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const i=(y*width+x)*4, j=Math.min(h-1,Math.floor(y*h/height))*w+Math.min(w-1,Math.floor(x*w/width));
      const a=data[i+3]/255, r=tables[0][data[i]], g=tables[1][data[i+1]], b=tables[2][data[i+2]];
      const lum=luma(r,g,b), peak=Math.max(r,g,b);
      weights[j]++;alpha[j]+=a;sums[j]+=lum*a;
      // Also admit very bright saturated lamps, but not ordinary red objects.
      const emitter=Math.max(smooth(.79,1.02,lum),smooth(.93,1.04,peak)*smooth(.30,.65,lum)*.65);
      const warm=clamp((r-b)*2+.65,.25,1);
      lights[j]+=emitter*(.7+.3*warm)*a;
    }
    for(let i=0;i<count;i++) { const n=weights[i]||1;sums[i]/=n;alpha[i]/=n;lights[i]/=n; }
    const sigma=Math.max(.6,Math.max(w,h)*.0025), blurAlpha=gaussian(alpha,w,h,sigma);
    context.local=gaussian(sums,w,h,sigma);
    for(let i=0;i<count;i++) context.local[i]/=Math.max(.00001,blurAlpha[i]);
    if (id==='cine') {
      const broad=gaussian(sums,w,h,Math.max(.8,Math.max(w,h)*.009));
      const broadAlpha=gaussian(alpha,w,h,Math.max(.8,Math.max(w,h)*.009));
      const mask=new Float32Array(count);
      for(let i=0;i<count;i++) {
        const local=sums[i]/Math.max(.00001,alpha[i]), surround=broad[i]/Math.max(.00001,broadAlpha[i]);
        // Broad bright surfaces (clouds, clothing, skin) have no emitter contrast.
        mask[i]=lights[i]*smooth(.045,.29,local-surround)*(1-smooth(.4,.85,surround));
      }
      context.haloNear=gaussian(mask,w,h,Math.max(.65,Math.max(w,h)*.003));
      context.haloFar=gaussian(mask,w,h,Math.max(1,Math.max(w,h)*.008));
    }
    return context;
  }
  function hash(x,y,seed) {
    let n=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(seed,1442695041);
    n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295*2-1;
  }
  function noise(x,y,seed) {
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,tx=fx*fx*(3-2*fx),ty=fy*fy*(3-2*fy);
    return (hash(ix,iy,seed)*(1-tx)+hash(ix+1,iy,seed)*tx)*(1-ty)+(hash(ix,iy+1,seed)*(1-tx)+hash(ix+1,iy+1,seed)*tx)*ty;
  }
  function hueWeight(h, target, spread) { const d=Math.abs(h-target);return 1-smooth(0,spread,Math.min(d,360-d)); }
  // region is in full-photo normalised coordinates (not crop-box coordinates).
  function process(data,width,height,context,region={x:0,y:0,width:1,height:1}) {
    const id=context.id, profile=PROFILES[id], tables=context.tables, mw=context.width,mh=context.height;
    const aspect=context.aspect, grainW=2400*Math.min(1,aspect),grainH=2400/Math.max(1,aspect);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const i=(y*width+x)*4;
      if (!data[i+3]) continue; // Do not touch hidden RGB, or invent alpha.
      let r=tables[0][data[i]],g=tables[1][data[i+1]],b=tables[2][data[i+2]];
      const lum=luma(r,g,b), hi=Math.max(r,g,b),lo=Math.min(r,g,b),chroma=hi-lo,sat=hi?chroma/hi:0;
      const u=region.x+(x+.5)/width*region.width,v=region.y+(y+.5)/height*region.height;
      let hue=0;
      if(chroma>1e-6) {hue=hi===r?((g-b)/chroma)%6:hi===g?(b-r)/chroma+2:(r-g)/chroma+4;hue=(hue*60+360)%360;}
      const chromatic=smooth(.04,.25,sat), skin=hueWeight(hue,29,31)*smooth(.12,.3,sat)*(1-smooth(.68,.9,sat))*smooth(.12,.4,lum);
      const green=hueWeight(hue,120,75)*chromatic,blue=hueWeight(hue,225,65)*chromatic;
      const red=hueWeight(hue,0,48)*chromatic,warm=hueWeight(hue,42,60)*chromatic;
      const shadow=(1-smooth(.1,.57,lum))*smooth(0,.075,lum), highlight=smooth(.48,.95,lum), mid=4*clamp(lum)*(1-clamp(lum));
      let saturation=1,rr=0,gg=0,bb=0;
      if(id==='solara') {
        saturation=1+.10*warm*(1-.8*skin)-.12*blue-.05*green;
        rr=.014*mid+.023*highlight+.023*green*chroma;
        gg=.006*highlight;bb=-.014*mid-.025*highlight+.01*shadow;
      } else if(id==='evergreen') {
        saturation=1+( .13+.19*green+.19*blue+.04*red)*chromatic*(1-.85*skin)*(1-smooth(.65,.98,sat));
        rr=-.008*shadow-.008*blue*chroma;gg=.013*green*chroma;bb=.012*shadow+.012*blue*chroma;
      } else if(id==='classic') {
        saturation=1-(.12+.12*green+.11*blue+.08*red+.04*warm)*(1-.7*skin);
        rr=-.022*shadow*(1-.85*skin)+.025*highlight+.025*green*chroma;
        gg=.012*shadow*(1-skin)+.008*highlight+.018*blue*chroma;
        bb=.014*shadow*(1-skin)-.026*highlight-.018*green*chroma-.014*red*chroma;
      } else if(id==='cine') {
        saturation=1-(.08+.12*green+.06*blue)*(1-.7*skin);
        rr=-.031*shadow*(1-.9*skin)+.027*highlight;
        gg=.011*shadow*(1-skin)+.007*highlight;
        bb=.034*shadow*(1-.9*skin)-.025*highlight+.019*green*chroma;
      }
      let mapped=tone(profile,lum);
      if(id==='nocturne') {
        const local=sample(context.local,mw,mh,u,v),detail=clamp(lum-local,-.08,.08);
        mapped+=detail*.20*smooth(.02,.16,lum)*(1-smooth(.8,1,lum));
        r=g=b=mapped;
      } else {
        r=mapped+(r-lum)*saturation+rr;
        g=mapped+(g-lum)*saturation+gg;
        b=mapped+(b-lum)*saturation+bb;
        if(id==='cine') {
          const halo=(sample(context.haloNear,mw,mh,u,v)*.75+sample(context.haloFar,mw,mh,u,v)*.55)*(1-smooth(.50,.95,lum));
          r+=halo*.60;g+=halo*.11;b+=halo*.018;
        }
      }
      // Fixed multi-scale emulsion texture: neutral coarse clusters for B&W,
      // finer luminance grain plus a small chromatic component for colour film.
      const gx=u*grainW,gy=v*grainH,fine=noise(gx,gy,profile.seed),coarse=noise(gx*.37,gy*.37,profile.seed+7);
      const density=smooth(0,.045,lum), dark=1-smooth(.06,.7,lum);
      let amplitude,grain;
      if(id==='nocturne') {amplitude=(.001+.044*dark+.009*mid)*density;grain=(fine*.58+coarse*.42)*amplitude;}
      else if(id==='cine') {amplitude=(.003+.018*dark)*density;grain=(fine*.78+coarse*.22)*amplitude;}
      else if(id==='classic') {amplitude=(.002+.010*dark)*density;grain=(fine*.85+coarse*.15)*amplitude;}
      else if(id==='solara') {amplitude=(.001+.003*dark)*density;grain=fine*amplitude;}
      else {amplitude=.0012*density;grain=fine*amplitude;}
      r+=grain;g+=grain;b+=grain;
      if(id==='classic'||id==='cine') {const colour=noise(gx*.83,gy*.83,profile.seed+19)*amplitude*.14;r+=colour;b-=colour;}
      // Compress chroma toward luminance instead of independently clipping RGB.
      // This preserves hue and texture in saturated reds and bright skin.
      const centre=clamp(luma(r,g,b)),max=Math.max(r,g,b),min=Math.min(r,g,b);
      let gamut=1;
      if(max>1) gamut=Math.min(gamut,(1-centre)/Math.max(1e-8,max-centre));
      if(min<0) gamut=Math.min(gamut,centre/Math.max(1e-8,centre-min));
      data[i]=255*clamp(centre+(r-centre)*gamut);data[i+1]=255*clamp(centre+(g-centre)*gamut);data[i+2]=255*clamp(centre+(b-centre)*gamut);
    }
    return data;
  }
  global.EZFilm={prepare,process};
})(typeof globalThis !== 'undefined'?globalThis:this);
