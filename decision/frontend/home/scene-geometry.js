import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';

export const SCENE_CAMERA = Object.freeze({near:25,far:7000});

const area = ring => Math.abs(ring.reduce((sum,p,i)=>{
  const next=ring[(i+1)%ring.length];return sum+p[0]*next[1]-next[0]*p[1];
},0))/2;

function cleanRing(ring,project){
  const result=[];
  for(const point of ring){
    const value=project(point);
    if(!value.every(Number.isFinite))return null;
    const last=result.at(-1);
    if(!last||last[0]!==value[0]||last[1]!==value[1])result.push(value);
  }
  if(result.length>1&&result[0][0]===result.at(-1)[0]&&result[0][1]===result.at(-1)[1])result.pop();
  return result.length>=3&&area(result)>1e-6?result:null;
}

// Union equal roofs, then remove taller footprints from lower solids. Source GIS data stays intact.
export function prepareBuildingSurfaces(features,{project,defaultHeight=18}){
  const levels=new Map();
  for(const [index,feature] of features.entries()){
    const fallback=typeof defaultHeight==='function'?defaultHeight(index):defaultHeight;
    const value=feature.properties?.height_m;
    const height=Number.isFinite(value)&&value>0?value:fallback;
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[];
    for(const polygon of polygons){
      const outer=cleanRing(polygon[0],project);
      if(!outer)continue;
      const rings=[outer,...polygon.slice(1).map(ring=>cleanRing(ring,project)).filter(Boolean)];
      if(!levels.has(height))levels.set(height,[]);
      levels.get(height).push(rings);
    }
  }
  const result=[];
  let occupied=[];
  for(const [height,polygons] of [...levels].sort((a,b)=>b[0]-a[0])){
    const combined=polygonClipping.union(polygons);
    const exposed=occupied.length?polygonClipping.difference(combined,occupied):combined;
    for(const rings of exposed)result.push({height,rings,points:rings[0]});
    occupied=occupied.length?polygonClipping.union(occupied,combined):combined;
  }
  return result;
}

export function buildingShape(rings){
  const shape=new THREE.Shape(rings[0].map(([x,y])=>new THREE.Vector2(x,y)));
  shape.holes=rings.slice(1).map(ring=>new THREE.Path(ring.map(([x,y])=>new THREE.Vector2(x,y))));
  return shape;
}

export function inBuilding(x,y,building,inside){
  return inside(x,y,building.rings[0])&&!building.rings.slice(1).some(ring=>inside(x,y,ring));
}
