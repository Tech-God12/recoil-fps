import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
const {buildAWM,buildAK47}=await import('../src/game/models.ts');
const {AIManager}=await import('../src/game/ai.ts');
const {Engine}=await import('../src/game/engine.ts');
const {Effects}=await import('../src/game/effects.ts');

test('sniper body/barrel are rendered and all weapon geometries are finite',()=>{
  for(const make of [buildAWM,buildAK47]) {
    const model=make();
    const bounds=new THREE.Box3().setFromObject(model.group);
    assert.ok(bounds.min.z < -0.64,'barrel must exist, not just a detached scope');
    model.group.traverse(o=>{if(o.isMesh){assert.ok(o.geometry.attributes.position.count>0);assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));}});
  }
});

test('movement substeps cannot tunnel through thin walls, with matched stair support',()=>{
  const wall={minX:2,maxX:2.1,minY:0,maxY:4,minZ:-10,maxZ:10};
  const context={world:{half:100,solids:[wall],groundHeight:()=>0},nearSolids:()=>[wall]};
  const p=new THREE.Vector3();
  Engine.prototype.moveAxis.call(context,p,12,2,0.34,1.7);
  assert.ok(p.x<1.67);assert.ok(p.z>1.9,'slide along wall');
  context.world.solids=[{minX:-1,maxX:1,minZ:-1,maxZ:1,minY:0,maxY:0.54}];
  assert.equal(Engine.prototype.supportHeight.call(context,new THREE.Vector3(),0.34),0.54);
});

test('hostile tracers travel downrange and return to the fixed pool',()=>{
  const restore=installCanvasStub();
  try {
    const effects=new Effects(new THREE.Scene());
    effects.tracer(new THREE.Vector3(),new THREE.Vector3(0,0,-60),true);
    const tracer=effects.tracers.find(t=>t.active),start=tracer.mesh.position.z;
    effects.update(0.1,new THREE.Vector3());assert.ok(tracer.mesh.position.z<start-5);
    effects.update(1,new THREE.Vector3());assert.equal(tracer.active,false);assert.equal(tracer.mesh.visible,false);
  }finally{restore();}
});

test('close visible contacts interrupt flanking and fire; gait persists between brain ticks',()=>{
  const restore=installCanvasStub();
  try {
    let shots=0;
    const ctx={scene:new THREE.Scene(),solids:[],occluders:[],coverNodes:[],half:100,
      effects:{bloodDecal(){},enemyMuzzle(){},tracer(){}},difficulty:{reaction:.5,accuracy:.7,flank:true,aggression:.8},
      playerPos:()=>new THREE.Vector3(0,1.62,0),playerFeet:()=>new THREE.Vector3(),playerAlive:()=>true,
      playerVel:()=>0,playerStaticTime:()=>0,damagePlayer(){},moveCollide(p,x,z){p.x+=x;p.z+=z;},onCallout(){},aiThrowGrenade(){},onEnemyFire(){shots++;}};
    const ai=new AIManager(ctx,[]);
    ai.insertSquad({insertionId:'test',from:'south',focus:[0,0,0],members:[[0,0,8],[-3,0,9],[3,0,9]]});
    const e=ai.enemies[0];e.setState('FLANK');e.reactTimer=-1;e.hasLOS=true;e.checkLOS=()=>true;
    e.updateLogic(.1);assert.equal(e.state,'ENGAGE');assert.ok(shots>0);
    for(let i=0;i<60;i++){if(i%3===0)e.pos.x+=.2;e.updateVisualFrame(1/60);}
    const phase=e.walkPhase; e.updateVisualFrame(1/60);
    assert.ok(e.walkPhase>phase,'visual clock advances even without a brain movement tick');
    assert.ok(e.locomotion>1);
    assert.ok(e.model.parts.rArm.rotation.x>0,'aimed arms point towards negative Z, not behind the soldier');
    assert.equal(e.model.parts.lShin.parent,e.model.parts.lLeg);
    const targets=ai.enemies.map(actor=>actor.approachPoint(new THREE.Vector3()));
    assert.ok(targets[1].distanceTo(targets[2])>6,'opposite squad approach lanes');
  }finally{restore();}
});
