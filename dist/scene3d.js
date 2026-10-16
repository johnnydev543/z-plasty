import * as THREE from './vendor/three.module.min.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};

export function surfacePoint(point,s){
  const [px,h,pz]=point,a=s.orientation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a);
  const x=px*s.mirror*c-pz*sn,z=px*s.mirror*sn+pz*c;
  if(s.surface!=='tube')return[x,h,z];
  const r=s.diameter/60,theta=x/r,shape=columnShape(s);
  return[(r+h)*Math.sin(theta)*shape.radial,((r+h)*Math.cos(theta)-r)*shape.radial,z];
}

export function columnShape(s){
  if(s.surface!=='tube')return{axial:1,radial:1};
  const ratio=Math.sqrt(5-4*Math.cos(s.angle*Math.PI/180));
  const gain=(ratio-1)*s.length/180*(s.deformation/100)*smooth((s.progress/100-.16)/.68);
  const axial=1+gain;return{axial,radial:1/Math.sqrt(axial)};
}

export function columnMeasurements(s){
  const shape=columnShape(s),diameter=s.diameter*shape.radial;
  return{initialLength:180,length:180*shape.axial,initialDiameter:s.diameter,diameter,initialCircumference:Math.PI*s.diameter,circumference:Math.PI*diameter};
}

// A kinematic teaching model. Bases remain attached to the surrounding sheet;
// barycentric bending lifts the free tips. No tissue mechanics are inferred.
export function pose(model,angle,t,lengthScale=1){
  const {initial:I,final:F}=model.geometry(angle);
  const u=smooth((t-.16)/.68),lift=Math.sin(Math.PI*smooth(t));
  const triangles=[model.rigidTriangle([I.A,I.B,I.C],[F.D,F.B,F.C],u),model.rigidTriangle([I.B,I.A,I.D],[F.C,F.A,F.D],u)].map(tri=>tri.map(p=>p.map(v=>v*lengthScale)));
  return {triangles,lift,lengthScale,anchors:[triangles[1][1],triangles[0][2],triangles[0][1],triangles[1][2]],initial:I};
}

export function createFlap3D(host,model,onError){
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label','3D 皮瓣轉位模型，可拖曳旋轉視角');
  renderer.domElement.setAttribute('role','img');
  renderer.domElement.tabIndex=0;
  host.prepend(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(36,1,.05,30);
  const group=new THREE.Group();scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff,0x778777,2));
  const key=new THREE.DirectionalLight(0xffe9d6,3);key.position.set(-2,5,3);scene.add(key);
  const fill=new THREE.DirectionalLight(0xd2e7ff,1.3);fill.position.set(3,2,-2);scene.add(fill);
  const textureCanvas=document.createElement('canvas');textureCanvas.width=textureCanvas.height=256;
  const ctx=textureCanvas.getContext('2d');ctx.fillStyle='#f4eadc';ctx.fillRect(0,0,256,256);
  let seed=91;const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  for(let i=0;i<1800;i++){ctx.fillStyle=`rgba(104,64,45,${.025+random()*.055})`;ctx.beginPath();ctx.ellipse(random()*256,random()*256,.4+random()*.6,.3+random()*.8,random()*3,0,Math.PI*2);ctx.fill();}
  const texture=new THREE.CanvasTexture(textureCanvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(3,3);texture.colorSpace=THREE.SRGBColorSpace;
  const skinMat=new THREE.MeshStandardMaterial({color:0xd4ae90,map:texture,roughness:.85,side:THREE.DoubleSide});
  const flapMats=[new THREE.MeshStandardMaterial({color:0x8cb99e,map:texture,roughness:.78,side:THREE.DoubleSide}),new THREE.MeshStandardMaterial({color:0x91acc4,map:texture,roughness:.78,side:THREE.DoubleSide})];
  const undersideMat=new THREE.MeshStandardMaterial({color:0xb87970,roughness:.96,side:THREE.DoubleSide});
  const bedMat=new THREE.MeshStandardMaterial({color:0xbc8779,roughness:.95});
  const bed=new THREE.Mesh(new THREE.CylinderGeometry(3.3,3.3,.16,72),bedMat);bed.position.y=-.105;group.add(bed);
  let tube=null,tubeKey=null;
  const capMat=new THREE.MeshStandardMaterial({color:0xc4a18a,roughness:.9,side:THREE.DoubleSide});
  const referenceMat=new THREE.LineBasicMaterial({color:0x83a89b,transparent:true,opacity:.35,depthWrite:false});
  let reference=null;
  const cutMat=new THREE.LineBasicMaterial({color:0x5b483e});
  const gridMat=new THREE.LineBasicMaterial({color:0x584e43,transparent:true,opacity:.14,depthWrite:false});
  const baseMat=new THREE.LineDashedMaterial({color:0xa79771,dashSize:.045,gapSize:.025,transparent:true,opacity:.9});
  const axisMat=new THREE.LineDashedMaterial({color:0x715d50,dashSize:.055,gapSize:.04,transparent:true,opacity:.65});
  const axis=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,.016,-.68),new THREE.Vector3(0,.016,.68)]),axisMat);axis.computeLineDistances();group.add(axis);
  let yaw=-.38,elevation=.82,distance=9.3,quality='auto',current=null,structure=null,pending=null,active=true,failed=false;
  let drawCount=0,lastFrameMs=0;
  const mobile=()=>matchMedia('(max-width:760px)').matches;
  const level=()=>quality==='low'||(quality==='auto'&&(mobile()||(navigator.hardwareConcurrency||4)<=4))?'low':quality==='high'?'high':'normal';
  function updateTube(s){
    const isTube=s.surface==='tube';bed.visible=!isTube;
    if(!isTube){if(tube)tube.visible=false;if(reference)reference.visible=false;return;}
    const r=s.diameter/60,key=`${r}:${level()}`;
    if(tubeKey!==key){
      if(tube){tube.traverse(o=>o.geometry?.dispose());group.remove(tube);}
      if(reference){reference.geometry.dispose();group.remove(reference);}
      tube=new THREE.Group();group.add(tube);tubeKey=key;
      const segments=level()==='low'?48:level()==='high'?96:72;
      const core=new THREE.Mesh(new THREE.CylinderGeometry(r-.042,r-.042,6,segments,1,false),bedMat);core.rotation.x=Math.PI/2;core.position.y=-r;tube.add(core);
      for(const z of [-3.003,3.003]){const cap=new THREE.Mesh(new THREE.CircleGeometry(r,segments),capMat);cap.position.set(0,-r,z);tube.add(cap);}
      const points=[];
      for(const z of [-3,3])for(let i=0;i<48;i++){for(const j of [i,i+1]){const a=j/48*Math.PI*2;points.push(new THREE.Vector3(r*Math.sin(a),r*Math.cos(a)-r,z));}}
      for(let i=0;i<4;i++){const a=i*Math.PI/2;for(const z of [-3,3])points.push(new THREE.Vector3(r*Math.sin(a),r*Math.cos(a)-r,z));}
      reference=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),referenceMat);group.add(reference);
    }
    const shape=columnShape(s);tube.visible=true;tube.scale.set(shape.radial,shape.radial,shape.axial);reference.visible=s.axis;
  }
  function meshGeometry(coords,index){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(coords.length*3,3).setUsage(THREE.DynamicDrawUsage));geo.setAttribute('uv',new THREE.Float32BufferAttribute(coords.flatMap(p=>[p[0]/3.36+.5,p[1]/3.36+.5]),2));geo.setIndex(index);return geo;}
  function gridFor(geo){const idx=geo.index.array,edges=[],seen=new Set();for(let i=0;i<idx.length;i+=3)for(let e=0;e<3;e++){const a=idx[i+e],b=idx[i+(e+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;if(!seen.has(key)){seen.add(key);edges.push(a,b);}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(edges.length*3,3).setUsage(THREE.DynamicDrawUsage));const line=new THREE.LineSegments(g,gridMat);line.userData.edges=edges;group.add(line);return line;}
  function disposeStructure(){if(!structure)return;for(const o of structure.objects){group.remove(o);o.geometry?.dispose();}structure=null;}
  function build(s){
    const angle=s.angle;
    disposeStructure();const q=level(),n=q==='low'?12:q==='high'?24:18,rn=q==='low'?6:q==='high'?14:10;
    const {initial:I}=model.geometry(angle),order=s.mirror<0?['A','D','B','C']:['A','C','B','D'],corners=order.map(key=>{const p=I[key].map(v=>v*s.length/30),a=s.orientation*Math.PI/180;return[p[0]*s.mirror*Math.cos(a)-p[1]*Math.sin(a),p[0]*s.mirror*Math.sin(a)+p[1]*Math.cos(a)];});
    const angles=corners.map(p=>Math.atan2(p[1],p[0]));for(let i=1;i<4;i++)while(angles[i]<angles[i-1])angles[i]+=Math.PI*2;angles.push(angles[0]+Math.PI*2);
    const coords=[],ringData=[],index=[];
    for(let side=0;side<4;side++){
      const offset=coords.length;
      const edgeAngles=Array.from({length:n+1},(_,i)=>angles[side]+(angles[side+1]-angles[side])*i/n);
      if(s.surface==='tube'){const xBound=Math.PI*s.diameter/60;for(const x of [-xBound,xBound])for(const z of [-3,3]){let a=Math.atan2(z,x);while(a<angles[side])a+=Math.PI*2;if(a>angles[side]+1e-8&&a<angles[side+1]-1e-8)edgeAngles.push(a);}edgeAngles.sort((a,b)=>a-b);}
      const columns=edgeAngles.length;
      for(let row=0;row<=rn;row++)for(let col=0;col<columns;col++){
        const r=row/rn,theta=edgeAngles[col],v=(theta-angles[side])/(angles[side+1]-angles[side]);
        const inner=[corners[side][0]*(1-v)+corners[(side+1)%4][0]*v,corners[side][1]*(1-v)+corners[(side+1)%4][1]*v];
        const extent=s.surface==='tube'?Math.min(Math.PI*s.diameter/60/Math.max(1e-10,Math.abs(Math.cos(theta))),3/Math.max(1e-10,Math.abs(Math.sin(theta)))):3.3;
        const outer=[Math.cos(theta)*extent,Math.sin(theta)*extent];const p=[inner[0]*(1-r)+outer[0]*r,inner[1]*(1-r)+outer[1]*r];
        coords.push(p);ringData.push({side,r,v,p,inner});
      }
      for(let row=0;row<rn;row++)for(let col=0;col<columns-1;col++){const a=offset+row*columns+col,b=a+columns;index.push(a,b,a+1,a+1,b,b+1);}
    }
    const ringGeo=meshGeometry(coords,index),ring=new THREE.Mesh(ringGeo,skinMat);group.add(ring);
    const objects=[ring],flaps=[];
    for(let f=0;f<2;f++){
      const bary=[],idx=[],lookup=new Map();for(let i=0;i<=n;i++)for(let j=0;j<=n-i;j++){lookup.set(`${i},${j}`,bary.length);bary.push([1-(i+j)/n,i/n,j/n]);}
      for(let i=0;i<n;i++)for(let j=0;j<n-i;j++){const a=lookup.get(`${i},${j}`),b=lookup.get(`${i+1},${j}`),c=lookup.get(`${i},${j+1}`);idx.push(a,b,c);if(i+j<n-1)idx.push(b,lookup.get(`${i+1},${j+1}`),c);}
      const flapGeo=meshGeometry(bary.map(p=>[p[1],p[2]]),idx),top=new THREE.Mesh(flapGeo,flapMats[f]);group.add(top);objects.push(top);
      const bottomGeo=flapGeo.clone(),bottom=new THREE.Mesh(bottomGeo,undersideMat);group.add(bottom);objects.push(bottom);
      const wallGeo=new THREE.BufferGeometry();wallGeo.setAttribute('position',new THREE.Float32BufferAttribute(n*3*6*3,3).setUsage(THREE.DynamicDrawUsage));const wall=new THREE.Mesh(wallGeo,undersideMat);group.add(wall);objects.push(wall);
      const cutGeo=new THREE.BufferGeometry();cutGeo.setAttribute('position',new THREE.Float32BufferAttribute((n*2+1)*3,3).setUsage(THREE.DynamicDrawUsage));const cuts=new THREE.Line(cutGeo,cutMat);group.add(cuts);objects.push(cuts);
      const baseGeo=new THREE.BufferGeometry();baseGeo.setAttribute('position',new THREE.Float32BufferAttribute((n+1)*3,3).setUsage(THREE.DynamicDrawUsage));const base=new THREE.Line(baseGeo,baseMat);group.add(base);objects.push(base);
      const labelCanvas=document.createElement('canvas');labelCanvas.width=128;labelCanvas.height=128;const lc=labelCanvas.getContext('2d');lc.fillStyle=f===0?'#345e48':'#3d5d76';lc.beginPath();lc.arc(64,64,58,0,Math.PI*2);lc.fill();lc.fillStyle='#edf7ed';lc.font='600 64px sans-serif';lc.textAlign='center';lc.fillText(f===0?'A':'B',64,86);const map=new THREE.CanvasTexture(labelCanvas);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:false}));sprite.scale.set(.15,.15,1);group.add(sprite);objects.push(sprite);
      flaps.push({bary,top,bottom,wall,cuts,base,sprite,map});
    }
    structure={angle,length:s.length,orientation:s.orientation,mirror:s.mirror,surface:s.surface,diameter:s.diameter,q,n,ring,ringData,flaps,objects,grids:[]};
  }
  function flapPoint(f,bary,p,offset=0){const tri=p.triangles[f],tip=bary[0];const x=tri.reduce((s,v,i)=>s+v[0]*bary[i],0),z=tri.reduce((s,v,i)=>s+v[1]*bary[i],0);const lift=p.lift*p.lengthScale*(f===0?.72:.39)*Math.pow(Math.max(0,tip),1.7);const curl=.1*p.lift*p.lengthScale*tip*(bary[1]-bary[2]);return surfacePoint([x,lift+curl+.007+offset,z],current);}
  function updateGeometry(s){
    current={...s};updateTube(s);
    if(!structure||structure.angle!==s.angle||structure.length!==s.length||structure.surface!==s.surface||structure.diameter!==s.diameter||structure.orientation!==s.orientation||structure.mirror!==s.mirror||structure.q!==level()){if(structure)structure.flaps.forEach(f=>{f.map.dispose();f.sprite.material.dispose();});build(s);}
    const p=pose(model,s.angle,s.progress/100,s.length/30),shape=columnShape(s),rot=s.orientation*Math.PI/180,anchors=p.anchors.map(p=>[p[0]*s.mirror*Math.cos(rot)-p[1]*Math.sin(rot),p[0]*s.mirror*Math.sin(rot)+p[1]*Math.cos(rot)]);if(s.mirror<0)[anchors[1],anchors[3]]=[anchors[3],anchors[1]];const rp=structure.ring.geometry.attributes.position;
    structure.ringData.forEach((d,i)=>{const a=anchors[d.side],b=anchors[(d.side+1)%4];const dx=(a[0]*(1-d.v)+b[0]*d.v-d.inner[0])*Math.pow(1-d.r,2),dz=(a[1]*(1-d.v)+b[1]*d.v-d.inner[1])*Math.pow(1-d.r,2);const z=(d.p[1]+dz)*(1+(shape.axial-1)*d.r*d.r);rp.setXYZ(i,...surfacePoint([d.p[0]+dx,.006*Math.sin(Math.PI*d.r)+.018*p.lift*Math.sin(Math.PI*d.r),z],{...s,orientation:0,mirror:1}));});rp.needsUpdate=true;structure.ring.geometry.computeVertexNormals();
    structure.flaps.forEach((f,k)=>{
      const pos=f.top.geometry.attributes.position,bottom=f.bottom.geometry.attributes.position;
      f.bary.forEach((b,i)=>{pos.setXYZ(i,...flapPoint(k,b,p));bottom.setXYZ(i,...flapPoint(k,b,p,-.025));});pos.needsUpdate=bottom.needsUpdate=true;f.top.geometry.computeVertexNormals();f.bottom.geometry.computeVertexNormals();
      const n=structure.n,wall=f.wall.geometry.attributes.position,cut=f.cuts.geometry.attributes.position,base=f.base.geometry.attributes.position;let wi=0;
      const edgeBary=(edge,t)=>edge===0?[1-t,t,0]:edge===1?[0,1-t,t]:[t,0,1-t];
      for(let edge=0;edge<3;edge++)for(let i=0;i<n;i++){const ba=edgeBary(edge,i/n),bbary=edgeBary(edge,(i+1)/n),a=flapPoint(k,ba,p),b=flapPoint(k,bbary,p),aa=flapPoint(k,ba,p,-.025),bb=flapPoint(k,bbary,p,-.025);for(const v of [a,aa,b,b,aa,bb])wall.setXYZ(wi++,...v);}
      for(let i=0;i<=2*n;i++){const bary=i<=n?[i/n,1-i/n,0]:[1-(i-n)/n,0,(i-n)/n];cut.setXYZ(i,...flapPoint(k,bary,p,.004));}
      for(let i=0;i<=n;i++){base.setXYZ(i,...flapPoint(k,[0,1-i/n,i/n],p,.004));}
      wall.needsUpdate=cut.needsUpdate=base.needsUpdate=true;f.wall.geometry.computeVertexNormals();f.base.computeLineDistances();const center=flapPoint(k,[.65,.175,.175],p);f.sprite.position.set(center[0],center[1]+.09,center[2]);f.sprite.visible=s.labels;f.base.visible=s.labels;
    });
    // Reuse grid line buffers rather than allocating per animation frame.
    if(s.grid){const geos=[structure.ring.geometry,...structure.flaps.map(f=>f.top.geometry)];if(!structure.grids.length){for(const geo of geos){const line=gridFor(geo);structure.grids.push(line);structure.objects.push(line);}}
      geos.forEach((geo,k)=>{const src=geo.attributes.position,out=structure.grids[k].geometry.attributes.position,edges=structure.grids[k].userData.edges;edges.forEach((a,i)=>out.setXYZ(i,src.getX(a),src.getY(a)+.002,src.getZ(a)));out.needsUpdate=true;structure.grids[k].visible=true;});
    }else structure.grids.forEach(g=>g.visible=false);
    const axisPos=axis.geometry.attributes.position;axisPos.setXYZ(0,...surfacePoint([0,.016,-.68*s.length/30],s));axisPos.setXYZ(1,...surfacePoint([0,.016,.68*s.length/30],s));axisPos.needsUpdate=true;axis.computeLineDistances();axis.visible=s.axis;group.rotation.y=0;group.scale.x=1;
    bedMat.color.set(s.dark?0x875f59:0xbc8779);skinMat.color.set(s.dark?0xc6a48e:0xd4ae90);
    scene.background=new THREE.Color(s.dark?0x18231e:0xfcfdfa);
    const phase=s.progress<1?'01 切口與皮瓣基底':s.progress<38?'02 掀起游離皮瓣':s.progress<80?'03 交錯轉位':s.progress<100?'04 落回並對接':'05 轉位完成';
    host.querySelector('[data-phase]').textContent=phase;
    host.querySelector('[data-lift]').textContent=`L ${s.length} mm${s.surface==='tube'?' · Ø '+s.diameter+' mm':''} · 示意抬升 ${(p.lift*.72*s.length*shape.radial).toFixed(1)} mm`;
    const columnInfo=host.querySelector('[data-column]');columnInfo.hidden=s.surface!=='tube';columnInfo.textContent=`柱體形變：軸向 +${((shape.axial-1)*100).toFixed(1)}% ／ 徑向 −${((1-shape.radial)*100).toFixed(1)}%（示意）`;
    renderer.domElement.setAttribute('aria-label',`3D ${s.angle} 度 Z-plasty，${phase}，${Math.round(s.progress)}%`);
  }
  function render(){pending=null;if(!active||failed||!current||document.hidden)return;const start=performance.now();const w=host.clientWidth,h=host.clientHeight;if(w<1||h<1)return;
    const maxPixels=level()==='low'?350000:level()==='high'?1500000:800000;const ratio=Math.min(level()==='low'?1:1.5,window.devicePixelRatio||1,Math.sqrt(maxPixels/(w*h)));const bufferW=Math.round(w*ratio),bufferH=Math.round(h*ratio);if(renderer.domElement.width!==bufferW||renderer.domElement.height!==bufferH){renderer.setPixelRatio(ratio);renderer.setSize(w,h,false);}const shape=columnShape(current),targetY=current.surface==='tube'?-current.diameter/60*shape.radial:.04,viewDistance=distance+(current.surface==='tube'?1.2:0);camera.aspect=w/h;camera.position.set(Math.sin(yaw)*Math.cos(elevation)*viewDistance,targetY+Math.sin(elevation)*viewDistance,Math.cos(yaw)*Math.cos(elevation)*viewDistance);camera.lookAt(0,targetY,0);camera.updateProjectionMatrix();renderer.render(scene,camera);drawCount++;lastFrameMs=performance.now()-start;
    host.dataset.frames=String(drawCount);host.dataset.triangles=String(renderer.info.render.triangles);host.dataset.renderMs=lastFrameMs.toFixed(2);host.dataset.drawCalls=String(renderer.info.render.calls);
  }
  function request(){if(active&&!pending&&!document.hidden)pending=requestAnimationFrame(render);}
  const ro=new ResizeObserver(()=>{if(current&&structure&&structure.q!==level())updateGeometry(current);request();});ro.observe(host);
  let pointer=null;
  renderer.domElement.addEventListener('pointerdown',e=>{pointer={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);renderer.domElement.classList.add('dragging');});
  renderer.domElement.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId)return;yaw-=(e.clientX-pointer.x)*.008;elevation=clamp(elevation+(e.clientY-pointer.y)*.006,.18,1.56);pointer.x=e.clientX;pointer.y=e.clientY;request();});
  const release=()=>{pointer=null;renderer.domElement.classList.remove('dragging');};renderer.domElement.addEventListener('pointerup',release);renderer.domElement.addEventListener('pointercancel',release);
  renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();distance=clamp(distance+e.deltaY*.004,5,15);request();},{passive:false});
  renderer.domElement.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')yaw-=.12;if(e.key==='ArrowRight')yaw+=.12;if(e.key==='ArrowUp')elevation=clamp(elevation+.1,.18,1.56);if(e.key==='ArrowDown')elevation=clamp(elevation-.1,.18,1.56);if(e.key==='+')distance=clamp(distance-.3,5,15);if(e.key==='-')distance=clamp(distance+.3,5,15);request();}});
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();failed=true;if(pending)cancelAnimationFrame(pending);onError('3D 畫面已中斷，可重新載入，或切換至 2D 幾何。');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&pending){cancelAnimationFrame(pending);pending=null;}else request();});
  host.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{const v=button.dataset.view;yaw=v==='side'?-1.2:v==='top'?0:-.38;elevation=v==='side'?.23:v==='top'?1.56:.82;distance=9.3;host.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});request();});
  host.querySelector('[data-quality]').onchange=e=>{quality=e.target.value;if(current)updateGeometry(current);request();};
  host.querySelector('[data-zoom-in]').onclick=()=>{distance=clamp(distance-.5,5,15);request();};host.querySelector('[data-zoom-out]').onclick=()=>{distance=clamp(distance+.5,5,15);request();};
  return {update(s){current={...s};if(active&&!failed){updateGeometry(current);request();}},setActive(v){if(active===v)return;active=v;if(!v&&pending){cancelAnimationFrame(pending);pending=null;}if(v&&current){updateGeometry(current);request();}},snapshot(){render();return new Promise(resolve=>renderer.domElement.toBlob(resolve,'image/png'));},stats(){return{triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,frames:drawCount,lastRenderMs:lastFrameMs};}};
}
