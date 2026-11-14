import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createIcons, ArrowUpRight, ArrowRight, ArrowDown, Menu, X, Focus } from 'lucide';
import { SCENE_CAMERA, prepareBuildingSurfaces, buildingShape, inBuilding } from './scene-geometry.js';

createIcons({icons:{ArrowUpRight,ArrowRight,ArrowDown,Menu,X,Focus}});

const palette=['#4f8fb8','#8bb6d2','#ddd5ba','#df995a','#c75450'];
const origin=[113.5295,34.8187];
const xy=([lon,lat])=>[(lon-origin[0])*91500,(lat-origin[1])*111000];
const heat=(x,y)=>Math.min(1,Math.max(0,.42+.32*Math.sin(x/165+y/295)+.18*Math.cos(y/130-x/280)));
function inside(x,y,poly){
  let hit=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
}
const colorAt=value=>{
  const n=value*4,index=Math.floor(n);
  return new THREE.Color(palette[Math.min(index,4)]).lerp(new THREE.Color(palette[Math.min(index+1,4)]),n-index);
};
function polygon(points,elevation=0){
  const shape=new THREE.Shape();
  points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));
  const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);geometry.translate(0,elevation,0);
  return geometry;
}
async function mountScene(){
  const host=document.querySelector('.hero-scene');
  if(!host)return;
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),10000);
  let response;
  try{response=await fetch(new URL('scene.json',import.meta.url),{signal:abort.signal});}finally{clearTimeout(timeout);}
  if(!response.ok)throw new Error('Scene geometry unavailable');
  const data=await response.json();
  const boundary=data.boundary.geometry.coordinates[0].map(xy);
  const buildings=prepareBuildingSurfaces(data.buildings.features,{project:xy});
  const canvas=host.querySelector('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const world=new THREE.Scene();world.background=new THREE.Color('#edf0f1');world.fog=new THREE.Fog('#edf0f1',2600,5500);
  world.add(new THREE.HemisphereLight('#ffffff','#a4adb4',2.5));
  const sun=new THREE.DirectionalLight('#fff5df',3.1);sun.position.set(-700,1500,600);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-1800,right:1800,top:1800,bottom:-1800});sun.shadow.normalBias=1.5;world.add(sun);
  const map=new THREE.Group();world.add(map);
  const material=(color)=>new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide});
  const add=(geometry,mat,parent=map)=>{const mesh=new THREE.Mesh(geometry,mat);mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  const floor=new THREE.PlaneGeometry(10000,10000);floor.rotateX(-Math.PI/2);floor.translate(0,-4,0);add(floor,material('#edf0f1'),world);
  add(polygon(boundary),material('#bdc3c9'));
  const cells=[],tiles=[];
  for(let x=-620;x<650;x+=43)for(let y=-1140;y<1070;y+=43){
    const cx=x+21.5,cy=y+21.5;if(!inside(cx,cy,boundary))continue;
    const value=heat(cx,cy),geometry=polygon([[x,y],[x+42,y],[x+42,y+42],[x,y+42]],1.5);
    const color=colorAt(value),colors=new Float32Array(geometry.attributes.position.count*3);
    for(let i=0;i<colors.length;i+=3)colors.set([color.r,color.g,color.b],i);
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));tiles.push(geometry);
    cells.push({id:'G-'+String(cells.length+1).padStart(4,'0'),cx,cy,value});
  }
  add(mergeGeometries(tiles),new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.64,depthWrite:false,side:THREE.FrontSide}));tiles.forEach(g=>g.dispose());
  const roads=[];
  for(const f of data.streets.features){
    const points=f.geometry.coordinates.map(xy);
    for(let i=1;i<points.length;i++){
      const [x1,y1]=points[i-1],[x2,y2]=points[i],dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy);
      if(len<1)continue;const nx=-dy/len*7,ny=dx/len*7;
      roads.push(polygon([[x1+nx,y1+ny],[x2+nx,y2+ny],[x2-nx,y2-ny],[x1-nx,y1-ny]],2));
    }
  }
  if(roads.length){add(mergeGeometries(roads),material('#f5f5ec'));roads.forEach(g=>g.dispose());}
  const buildingGeometry=[];
  for(const {rings,height} of buildings){
    const shape=buildingShape(rings);
    const geo=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});geo.rotateX(-Math.PI/2);geo.translate(0,2.5,0);buildingGeometry.push(geo);
  }
  const merged=mergeGeometries(buildingGeometry),buildingMaterial=material('#e7eaec');buildingMaterial.side=THREE.FrontSide;
  const body=add(merged,buildingMaterial);body.castShadow=true;
  map.add(new THREE.LineSegments(new THREE.EdgesGeometry(merged,30),new THREE.LineBasicMaterial({color:'#a5aeb5',transparent:true,opacity:.4,depthWrite:false})));
  buildingGeometry.forEach(g=>g.dispose());
  let seed=29;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1.3,8,5),material('#657a8c'),700);
  const leaves=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(7.5,1),material('#8ea18a'),700);
  const dummy=new THREE.Object3D();let count=0;
  for(let i=0;i<3800&&count<700;i++){
    const x=-600+random()*1160,y=-1100+random()*2100;
    if(!inside(x,y,boundary)||buildings.some(b=>inBuilding(x,y,b,inside))||heat(x,y)>.72&&random()>.12)continue;
    dummy.position.set(x,7,-y);dummy.scale.setScalar(.7+random()*.7);dummy.updateMatrix();trunks.setMatrixAt(count,dummy.matrix);
    dummy.position.y=15;dummy.updateMatrix();leaves.setMatrixAt(count++,dummy.matrix);
  }
  trunks.count=count;leaves.count=count;leaves.castShadow=true;map.add(trunks,leaves);
  const context=material('#cfd4d8');
  for(let ix=-3;ix<=3;ix++)for(let iz=-5;iz<=5;iz++){
    const x=ix*340,y=iz*300;if(inside(x,y,boundary))continue;
    const block=add(new THREE.BoxGeometry(160+random()*90,8+random()*20,110+random()*70),context);block.position.set(x,10,-y);block.castShadow=true;
  }
  const camera=new THREE.PerspectiveCamera(38,1,SCENE_CAMERA.near,SCENE_CAMERA.far);
  const marker=host.querySelector('.hero-hotspot');
  let width=0,height=0,hot=null,frame=0,visible=true,disposed=false,lean=0,target=0,firstFrame=true;
  const motion=()=>document.documentElement.dataset.motion==='on';
  const projected=cell=>map.localToWorld(new THREE.Vector3(cell.cx,4,-cell.cy)).project(camera);
  const draw=()=>{
    if(disposed||!visible)return;
    const nextWidth=host.clientWidth,nextHeight=host.clientHeight;
    if(width!==nextWidth||height!==nextHeight){
      width=nextWidth;height=nextHeight;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
      const mobile=innerWidth<=640;
      if(mobile){camera.position.set(1300,1650,1300);camera.lookAt(0,0,-100);map.position.set(0,0,-180);}
      else{camera.position.set(1450,1700,1700);camera.lookAt(-250,0,-40);map.position.set(350,0,0);}
      hot=null;
    }
    map.rotation.y=(innerWidth<=640?-.28:-.12)+lean;map.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    if(!hot){
      hot=cells.filter(c=>c.value>=.65&&!buildings.some(b=>inBuilding(c.cx,c.cy,b,inside))).map(c=>({cell:c,screen:projected(c)}))
        .filter(c=>c.screen.x>-.1&&c.screen.x<.76&&c.screen.y>-.6&&c.screen.y<.55)
        .sort((a,b)=>Math.hypot(a.screen.x-.54,a.screen.y-.06)-Math.hypot(b.screen.x-.54,b.screen.y-.06))[0]?.cell;
    }
    if(hot&&marker){
      const p=projected(hot);marker.style.left=(p.x+1)*width/2+'px';marker.style.top=(1-p.y)*height/2+'px';
      marker.dataset.gridId=hot.id;marker.dataset.value=hot.value;marker.hidden=innerWidth<=640;
    }
    renderer.render(world,camera);host.dataset.rendered='true';host.dataset.source='visual_simulation';
    if(firstFrame){firstFrame=false;dispatchEvent(new CustomEvent('home-scene-ready',{detail:{fallback:false}}));}
  };
  const animate=()=>{frame=0;if(!motion())lean=target=0;else lean+=(target-lean)*.12;draw();if(Math.abs(target-lean)>.0002&&visible)frame=requestAnimationFrame(animate);};
  const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(animate);};
  const observer=new ResizeObserver(schedule);observer.observe(host);
  const visibility=new IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;
    if(visible){if(motion())lean=-.035;target=0;schedule();}else{cancelAnimationFrame(frame);frame=0;}
  });visibility.observe(host);
  const hero=host.closest('.hero');
  hero.addEventListener('pointermove',event=>{if(event.pointerType==='touch'||!motion())return;const rect=hero.getBoundingClientRect();target=((event.clientX-rect.left)/rect.width-.5)*.055;schedule();});
  hero.addEventListener('pointerleave',()=>{target=0;schedule();});
  window.addEventListener('home-motion-change',()=>{target=0;if(motion())lean=-.035;schedule();});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();host.dataset.rendered='false';if(marker)marker.hidden=true;});
  canvas.addEventListener('webglcontextrestored',()=>{hot=null;schedule();});
  window.addEventListener('pageshow',()=>{visible=true;schedule();});
  window.addEventListener('pagehide',event=>{
    cancelAnimationFrame(frame);frame=0;if(event.persisted)return;disposed=true;observer.disconnect();visibility.disconnect();
    const geometries=new Set(),materials=new Set();world.traverse(node=>{if(node.geometry)geometries.add(node.geometry);if(node.material)(Array.isArray(node.material)?node.material:[node.material]).forEach(m=>materials.add(m));});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();
  });
  draw();
}
mountScene().catch(()=>{const host=document.querySelector('.hero-scene');if(host)host.dataset.rendered='false';dispatchEvent(new CustomEvent('home-scene-ready',{detail:{fallback:true}}));});
