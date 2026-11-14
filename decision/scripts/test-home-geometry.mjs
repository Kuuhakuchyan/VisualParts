import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import {prepareBuildingSurfaces,buildingShape,SCENE_CAMERA} from '../frontend/home/scene-geometry.js';

const area=polygons=>polygons.reduce((sum,rings)=>sum+rings.reduce((net,ring,i)=>{
  const value=Math.abs(ring.reduce((s,p,j)=>{const q=ring[(j+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
  return net+(i?-value:value);
},0),0);
const feature=(rings,height=18)=>({geometry:{type:'Polygon',coordinates:rings},properties:{height_m:height}});
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const project=point=>point;

test('coincident, reversed and intersecting same-height footprints form one roof',()=>{
  const result=prepareBuildingSurfaces([feature([rect(0,0,10,10)]),feature([rect(0,0,10,10).reverse()]),feature([rect(5,0,10,10)])],{project});
  assert.equal(result.length,1);
  assert.equal(area(result.map(b=>b.rings)),150);
});

test('stepped buildings retain both heights without overlapping roof projections',()=>{
  const result=prepareBuildingSurfaces([feature([rect(0,0,10,10)],12),feature([rect(5,0,10,10)],30)],{project});
  assert.deepEqual(result.map(b=>b.height),[30,12]);
  assert.equal(area([result[0].rings]),100);
  assert.equal(area([result[1].rings]),50);
  assert.equal(area(polygonClipping.intersection([result[0].rings],[result[1].rings])),0);
});

test('courtyard holes survive polygon preparation and roof triangulation',()=>{
  const [building]=prepareBuildingSurfaces([feature([rect(0,0,20,20),rect(5,5,10,10)])],{project});
  const shape=buildingShape(building.rings);
  assert.equal(shape.holes.length,1);
  assert.equal(area([building.rings]),300);
  const geometry=new THREE.ShapeGeometry(shape),p=geometry.attributes.position;
  let triangles=0;
  const indices=geometry.index.array;
  for(let i=0;i<indices.length;i+=3){
    const a=new THREE.Vector3().fromBufferAttribute(p,indices[i]);
    const b=new THREE.Vector3().fromBufferAttribute(p,indices[i+1]);
    const c=new THREE.Vector3().fromBufferAttribute(p,indices[i+2]);
    triangles+=b.sub(a).cross(c.sub(a)).length()/2;
  }
  assert.equal(triangles,300);
  geometry.dispose();
});

test('actual campus roofs have no positive-area overlaps and preserve occupied area',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/data/campus-buildings.geojson',import.meta.url),'utf8'));
  const project=([lon,lat])=>[(lon-113.5295)*91500,(lat-34.8187)*111000];
  const originals=data.features.flatMap(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(rings=>rings.map(ring=>ring.map(project))));
  for(const defaultHeight of [18,i=>12+(i%6)*5]){
    const buildings=prepareBuildingSurfaces(data.features,{project,defaultHeight});
    assert.ok(Math.abs(area(buildings.map(b=>b.rings))-area(polygonClipping.union(originals)))<1e-5);
    for(let i=0;i<buildings.length;i++)for(let j=i+1;j<buildings.length;j++){
      assert.ok(area(polygonClipping.intersection([buildings[i].rings],[buildings[j].rings]))<1e-6,`overlapping buildings ${i}, ${j}`);
    }
    for(const building of buildings){
      const geometry=new THREE.ExtrudeGeometry(buildingShape(building.rings),{depth:building.height,bevelEnabled:false});
      assert.ok(geometry.attributes.position.array.every(Number.isFinite));
      geometry.dispose();
    }
  }
  assert.ok(SCENE_CAMERA.far/SCENE_CAMERA.near<300);
});
