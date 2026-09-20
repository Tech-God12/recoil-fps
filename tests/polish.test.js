import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {installCanvasStub} from './helpers/geometry.js';
const {buildWorld,MAPS}=await import('../src/game/world.ts');
const {Engine}=await import('../src/game/engine.ts');
const {AIManager}=await import('../src/game/ai.ts');
const {MissionMarkers}=await import('../src/game/systems/mission-markers.ts');
const {getMission}=await import('../src/game/systems/mission.ts');
const keys=['sand','plaza','adobeWall','adobeWall2','adobeBrick','concrete','asphalt','wood','rustedMetal','sandbag','tileFloor','plaster','whitewash','stoneBlock','firedBrick','packedEarth','corrugatedMetal','roughTimber','terracePavers','cobbleLane','wadiBed','signage'];
const fixture=id=>buildWorld(new THREE.Scene(),id,Object.fromEntries(keys.map(k=>[k,new THREE.MeshStandardMaterial()])));

test('Sandblast and Town expand outward without scaling doors and stairs',()=>{
  assert.deepEqual(MAPS.map(m=>m.name),['Warehouse','Sandblast','Town']);
  for(const [id,old] of [['alrasul',104],['kasbah',112]]) {
    const w=fixture(id);assert.ok(w.half/old>1.18&&w.half/old<1.22);
    assert.ok(w.interiors.some(b=>Math.abs(b.minX)>old),'new outer buildings, not only larger bounds');
  }
});

test('both bridge decks support feet above them but do not teleport players underneath',()=>{
  const w=fixture('alrasul'),ctx={world:w,solidGrid:new Map(),scratch:[],GRID_CELL:8,nearSolids:Engine.prototype.nearSolids};
  Engine.prototype.buildSolidGrid.call(ctx);
  for(const [x,z] of [[-12,2.64],[48,-10.56]]) {
    assert.equal(w.groundHeight(x,z),-2.5);
    assert.equal(Engine.prototype.supportHeight.call(ctx,new THREE.Vector3(x,0,z),.34),0);
    assert.equal(Engine.prototype.supportHeight.call(ctx,new THREE.Vector3(x,-2.5,z),.34),-2.5);
    const p=new THREE.Vector3(x-5,-2.5,z);
    for(let i=0;i<100;i++) Engine.prototype.moveAxis.call(ctx,p,.1,0,.34,1.7);
    assert.ok(p.x>x+4.8,`underpass blocked at ${p.toArray()}`);
    assert.equal(p.y,-2.5);
  }
});

test('unreachable AI goals are retried with cooldown, not every logic tick',()=>{
  const restore=installCanvasStub();
  try {
    const ctx={scene:new THREE.Scene(),solids:[],occluders:[],coverNodes:[],half:104,
      effects:{bloodDecal(){},enemyMuzzle(){},tracer(){}},difficulty:{reaction:.5,accuracy:.7,flank:true,aggression:.8},
      playerPos:()=>new THREE.Vector3(0,1.62,0),playerFeet:()=>new THREE.Vector3(),playerAlive:()=>true,
      playerVel:()=>0,playerStaticTime:()=>0,damagePlayer(){},moveCollide(p,x,z){p.x+=x;p.z+=z;},onCallout(){},aiThrowGrenade(){},onEnemyFire(){}};
    const ai=new AIManager(ctx,[]);ai.insertSquad({insertionId:'test',from:'south',focus:[0,0,0],members:[[0,0,30],[-3,0,30],[3,0,30]]});
    const e=ai.enemies[0];let searches=0;e.nav.lineFree=()=>false;e.nav.path=()=>{searches++;return null;};e.repathT=0;
    for(let i=0;i<30;i++)e.goTo(new THREE.Vector3(),1,1/60);
    assert.equal(searches,1);
    ai.dispose();
  }finally{restore();}
});

test('charge is visible while attaching, armed afterward, and removed by demolition',()=>{
  const world={solids:[],occluders:[]};const marker=new MissionMarkers(new THREE.Scene(),world,getMission('alrasul'));
  assert.equal(marker.charge.visible,false);
  marker.setCharge(.2,false,1);assert.equal(marker.charge.visible,true);
  marker.setCharge(1,true,2);assert.ok(marker.charge.material.emissiveIntensity>0);
  marker.destroyCache(world);assert.equal(marker.charge.visible,false);
  marker.dispose();
});


test('opening objectives are authored inside rooms, not arbitrary road centres',()=>{
  for(const id of ['alrasul','kasbah']) {
    const world=fixture(id),p=getMission(id).phases[0];
    assert.ok(world.interiors.some(b=>p.at[0]>b.minX&&p.at[0]<b.maxX&&p.at[2]>b.minZ&&p.at[2]<b.maxZ));
    assert.ok(p.radius<=2);
    assert.ok(!world.solids.some(b=>b.minY<1.7&&b.maxY>.55&&p.at[0]>b.minX&&p.at[0]<b.maxX&&p.at[2]>b.minZ&&p.at[2]<b.maxZ));
  }
});


test('expanded riverbank closes gradually instead of a 2.5m height discontinuity',()=>{
  const w=fixture('alrasul');
  let previous=w.groundHeight(100,-22);
  for(let x=100.1;x<122;x+=0.1) {
    const height=w.groundHeight(x,-22);
    assert.ok(Math.abs(height-previous)<0.04);previous=height;
  }
  assert.equal(w.groundHeight(120,-22),0);
});
