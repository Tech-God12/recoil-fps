// Native-scale equipment: different housings, not one universal box scaled by class.
import * as THREE from 'three';
import { GunBuilder, WM } from './models';
import type { AttachContext, AttachmentBuilder } from './attachments';
import { HALF_PI, screw } from './weapons/furniture';
import type { ScopeReticle } from './economy/stats';

function lens(p: THREE.Group, radius: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), WM.glass);
  mesh.name = 'seated optical glass'; mesh.position.set(0,y,z); p.add(mesh);
}
function windowGlass(p: THREE.Group, width: number, height: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),WM.glass);
  mesh.name='seated optical glass'; mesh.position.set(0,y,z); p.add(mesh);
}
function etching(p: THREE.Group, y: number, z: number, kind: ScopeReticle) {
  const marks=new THREE.Group(), b=new GunBuilder(); marks.name=`${kind} optical etching`; marks.userData.adsHide=true;
  const ink=kind==='mil6'||kind==='mil8'||kind==='bdc4' ? WM.scopeInner : WM.reticle;
  const line=(w:number,h:number,x=0,dy=0)=>b.name('etched reticle line').box(w,h,.00006,ink,x,y+dy,z);
  if(kind==='holo'||kind==='prism2') b.name('etched reticle ring').tube(kind==='holo'?.0042:.0026,kind==='holo'?.0040:.0024,.00008,WM.reticle,0,y,z);
  if(kind==='prism3'||kind==='bdc4') {
    b.name('etched chevron').rod([-.0018,y-.0021,z],[0,y,z],.00011,WM.reticle,.00011,6);
    b.rod([0,y,z],[.0018,y-.0021,z],.00011,WM.reticle,.00011,6);
    for(let i=1;i<4;i++) line(.004-i*.0008,.00009,0,-.0025-i*.0014);
  } else if(kind==='mil6'||kind==='mil8') {
    line(.018,.00009); line(.00009,.018);
    for(const n of [-3,-2,-1,1,2,3]) {line(.0001,.0008,n*.002,0);line(.0008,.0001,0,n*.002);}
  }
  const dot=new THREE.Mesh(new THREE.CircleGeometry(kind==='dot'?.00045:.00023,16),WM.reticle);dot.position.set(0,y,z+.00008);dot.userData.adsHide=true;marks.add(dot);
  b.build(marks);marks.traverse(o=>{o.userData.adsHide=true;});p.add(marks);
}
function clamp(b:GunBuilder,length:number,width=.029) {
  b.name('optic rail saddle').box(width,.007,length,WM.darkSteel,0,.003,0);
  b.name('dovetail clamp jaw').box(.004,.006,length*.82,WM.dark,-width/2,.0045,0);
  for(const z of [-length*.30,length*.30]) screw(b,-width*.53,.004,z,.0020);
}
function finishOptic(p:THREE.Group,b:GunBuilder,height:number,reticle:ScopeReticle,rear:number) {
  b.build(p);etching(p,height,rear,reticle);p.userData.lensH=height;p.userData.reticle=reticle;return p;
}

function microDot(_ctx:AttachContext) {
  const p=new THREE.Group(),b=new GunBuilder(),h=.021;
  clamp(b,.036,.026);
  b.name('micro dot riser').box(.017,.010,.024,WM.darkSteel,0,.010,0);
  b.name('sealed micro dot tube').tube(.013,.011,.042,WM.darkSteel,0,h,0);
  for(const z of [-.020,.020]) b.name('micro dot protective rim').tube(.0145,.011,.004,WM.dark,0,h,z);
  b.name('side battery cap').cyl(.006,.006,.009,WM.dark, .0165,h,-.003,0,0,HALF_PI,24);
  b.name('elevation adjuster').cyl(.0035,.0035,.004,WM.darkSteel,0,.034,-.005,0,0,0,20);
  lens(p,.011,h,-.021);lens(p,.011,h,.021);
  return finishOptic(p,b,h,'dot',.0205);
}
function holographic(_ctx:AttachContext) {
  const p=new THREE.Group(),b=new GunBuilder(),h=.025;
  clamp(b,.054,.033);
  const hood:[number,number][]=[[-.019,.006],[-.019,.031],[-.015,.041],[.015,.041],[.019,.031],[.019,.006],[.014,.006],[.014,.030],[.011,.036],[-.011,.036],[-.014,.030],[-.014,.006]];
  b.name('armoured holographic hood').section(hood,.029,WM.darkSteel,0,0,-.002);
  b.name('forward battery compartment').box(.030,.014,.029,WM.dark,0,.010,-.030);
  b.name('battery latch').box(.010,.003,.010,WM.darkSteel,0,.018,-.040);
  for(const side of [-1,1]) screw(b,side*.0193,.013,-.003,.0027);
  windowGlass(p,.026,.022,h,.0123);
  return finishOptic(p,b,h,'holo',.0120);
}
function prism(ctx:AttachContext,power:2|3|4) {
  const p=new THREE.Group(),b=new GunBuilder();
  const h=power===2?.023:.027, length=power===2?.055:power===3?.072:.082, radius=power===2?.013:.015;
  clamp(b,length*.83,power===2?.028:.031);
  b.name('integral prism pedestal').box(.019,.011,length*.63,WM.darkSteel,0,.010,0);
  const shell:[number,number][]=[[-radius,-radius-.001],[radius,-radius-.001],[radius+.003,.001],[radius,.011],[radius*.6,.017],[-radius*.6,.017],[-radius,.011],[-radius-.003,.001]];
  b.name(`${power}x forged prism body`).section(shell,length,WM.darkSteel,0,h,0,{y:0,radius:radius-.002});
  const nose=power===4?.018:radius+.001;
  b.name('prism objective hood').turned([[radius,-length*.35],[nose,-length*.55],[nose,-length*.67],[nose-.002,-length*.67],[nose-.002,-length*.55],[radius-.002,-length*.35],[radius,-length*.35]],WM.dark,0,h,0);
  b.name('prism ocular rim').tube(radius+.001,radius-.002,.004,WM.dark,0,h,length/2);
  b.name('prism elevation turret').cyl(.005,.005,.006,WM.dark,0,h+.018,-.010,0,0,0,24);
  b.name('illumination dial').cyl(.0055,.0055,.007,WM.dark,radius+.004,h,.005,0,0,HALF_PI,24);
  if(power===4) {
    b.name('fibre channel').box(.006,.003,.059,WM.dark,0,h+.018,-.004);
    b.name('fibre collector').cyl(.0011,.0011,.050,WM.tritium,0,h+.0196,-.004,HALF_PI,0,0,12);
  }
  lens(p,nose-.002,h,-length*.66);lens(p,radius-.002,h,length*.50);
  const reticle:ScopeReticle=power===2?'prism2':power===3?'prism3':'bdc4';
  const model=finishOptic(p,b,h,reticle,length*.497);
  model.userData.opticPower=power;model.userData.host=ctx.weapon;return model;
}
function telescope(_ctx:AttachContext,power:6|8) {
  const p=new THREE.Group(),b=new GunBuilder(),h=.030,k=power===8?1.20:1;
  clamp(b,.097*k,.030);
  b.name('precision scope main tube').tube(.0125,.0108,.115*k,WM.darkSteel,0,h,0);
  b.name('tapered objective bell').turned([[.0125,-.037*k],[.021,-.064*k],[.021,-.082*k],[.019,-.082*k],[.019,-.064*k],[.0108,-.037*k],[.0125,-.037*k]],WM.dark,0,h,0);
  b.name('diopter eyepiece').turned([[.0125,.039*k],[.016,.052*k],[.016,.078*k],[.0138,.078*k],[.0138,.052*k],[.0108,.039*k],[.0125,.039*k]],WM.dark,0,h,0);
  for(const z of [-.028*k,.028*k]){
    b.name('ring mounting foot').box(.019,.013,.012,WM.darkSteel,0,.012,z);
    b.name('scope clamp ring').tube(.015,.012,.012,WM.darkSteel,0,h,z);
    for(const side of [-1,1]) b.name('ring clamp screw').cyl(.0019,.0019,.002,WM.steel,side*.015,h,z,0,0,HALF_PI,16);
  }
  b.name('elevation drum').cyl(.008,.008,.012,WM.darkSteel,0,.046,-.008,0,0,0,28);
  b.name('windage drum').cyl(.007,.007,.012,WM.darkSteel,.016,h,-.008,0,0,HALF_PI,28);
  for(let i=0;i<12;i++) {
    const theta=i*Math.PI/6;
    b.name('turret knurl').box(.0018,.008,.0016,WM.dark,Math.cos(theta)*.008,.047,-.008+Math.sin(theta)*.008,0,-theta,0);
  }
  const ring=new THREE.Group(),rb=new GunBuilder();ring.name='magnification adjustment ring';ring.position.set(0,h,.046*k);
  rb.name('zoom collar').tube(.0155,.012,.012,WM.darkSteel,0,0,0);
  for(let i=0;i<18;i++){const t=i*Math.PI/9;rb.name('zoom collar knurl').box(.0016,.0016,.011,WM.dark,Math.sin(t)*.0155,Math.cos(t)*.0155,0,0,0,-t);}
  rb.name('magnification index').box(.001,.0015,.009,WM.steel,0,.016,0);rb.build(ring);p.add(ring);p.userData.zoomRing=ring;
  lens(p,.019,h,-.081*k);lens(p,.0138,h,.077*k);
  return finishOptic(p,b,h,power===6?'mil6':'mil8',.0765*k);
}
function pistolReflex(_ctx:AttachContext) {
  const p=new THREE.Group(),b=new GunBuilder(),h=.016;
  b.name('slide specific micro plate').box(.022,.004,.030,WM.darkSteel,0,.002,0);
  b.name('micro sight electronics').box(.020,.006,.014,WM.dark,0,.006,-.006);
  b.name('micro reflex protective hoop').section([[-.011,.003],[-.011,.018],[-.008,.025],[.008,.025],[.011,.018],[.011,.003],[.008,.003],[.008,.017],[.005,.021],[-.005,.021],[-.008,.017],[-.008,.003]],.010,WM.darkSteel,0,0,.009);
  windowGlass(p,.014,.014,h,.0137);
  return finishOptic(p,b,h,'dot',.0135);
}

function grip(ctx:AttachContext,kind:'vertical'|'half'|'thumb'|'light'|'pump') {
  const p=new THREE.Group(),b=new GunBuilder();
  const coat=ctx.weapon==='scar_h'?WM.tan:WM.poly;
  if(kind==='pump') {
    b.name('pump saddle').box(.043,.009,.036,WM.darkSteel,0,.003,0);
    b.name('pump palm stop').profile([[-.020,.003],[.016,.003],[.020,-.008],[.017,-.022],[.009,-.022],[.008,-.007],[-.020,-.006]],.038,WM.grip,0,.002);
    b.build(p);return p;
  }
  b.name('grip rail clamp').box(.026,.009,kind==='thumb'?.040:.035,WM.darkSteel,0,-.003,0);
  if(kind==='vertical') {
    const length=ctx.weapon==='vector'?.046:.056;
    b.name('rounded vertical grip').cyl(.010,.012,length,WM.grip,0,-.010-length/2,0,0,0,0,32);
    b.name('vertical grip shoulder').box(.022,.014,.023,coat,0,-.012,0);
    for(let i=0;i<5;i++) b.name('wraparound grip rib').tube(.0124,.010,.0025,coat,0,-.025-i*(length-.02)/5,0,0);
    b.name('grip end plug').cyl(.0118,.0118,.004,WM.rubber,0,-.010-length,0,0,0,0,28);
  } else if(kind==='half') {
    b.name('short open half-grip frame').profile([[-.018,-.006],[.018,-.006],[.020,-.016],[.010,-.043],[-.004,-.043],[-.014,-.023]],.023,WM.red,0,.0014,[[[-.009,-.012],[.011,-.012],[.007,-.032],[.000,-.032]]]);
    b.name('half grip palm pad').box(.024,.009,.016,WM.grip,0,-.038,.003);
  } else if(kind==='thumb') {
    b.name('low thumb shelf').profile([[-.022,-.006],[.021,-.006],[.019,-.014],[-.010,-.024],[-.020,-.022]],.029,coat,0,.0018);
    b.name('thumb ramp tread').box(.023,.002,.022,WM.grip,0,-.015,-.001,.23);
    b.name('forward finger hook').box(.024,.018,.006,WM.grip,0,-.012,-.021);
  } else {
    b.name('skeleton precision grip').profile([[-.018,-.006],[.016,-.006],[.017,-.017],[.030,-.057],[.020,-.062],[.008,-.054],[-.004,-.025],[-.018,-.018]],.019,coat,0,.0013,[[[-.007,-.012],[.009,-.012],[.020,-.052],[.012,-.044]]]);
    b.name('precision grip heel').box(.023,.006,.018,WM.grip,0,-.057,.020);
  }
  screw(b,-.014,-.004,0,.0023);b.build(p);return p;
}

function compactRail(ctx:AttachContext,light:boolean,pistol:boolean) {
  const p=new THREE.Group(),b=new GunBuilder(),h=pistol?.009:.0125;
  b.name('host matched rail shoe').box(pistol?.020:.022,.005,pistol?.026:.032,WM.darkSteel,0,.001,0);
  if(light){
    b.name('pistol light body').box(.021,.015,.028,WM.dark,0,.010,0);
    b.name('pistol light bezel').tube(.010,.0077,.009,WM.darkSteel,0,.011,-.016);
  }else{
    b.name('compact laser housing').box(pistol?.017:.019,pistol?.011:.018,pistol?.027:.036,WM.dark,0,h,0);
    b.name('laser aperture rim').tube(.004,.0023,.004,WM.darkSteel,0,h,-(pistol?.015:.019));
    b.name('laser activation pad').box(.009,.0015,.011,WM.grip,0,h+(pistol?.006:.009),.003);
  }
  b.build(p);
  const glass=new THREE.Mesh(new THREE.CircleGeometry(light?.0078:.0023,24),light?WM.tritium:WM.reticle);
  glass.rotation.y=Math.PI;glass.position.set(0,light?.011:h,light?-.021:(pistol?-.017:-.021));glass.name='seated emitter lens';p.add(glass);p.userData.lensMesh=glass;p.userData.host=ctx.weapon;
  return p;
}

export const EQUIPMENT_BUILDERS: Record<string,AttachmentBuilder> = {
  reddot:microDot,holo:holographic,pistol_rmr:pistolReflex,
  prism_2x:ctx=>prism(ctx,2),prism_3x:ctx=>prism(ctx,3),acog_4x:ctx=>prism(ctx,4),ak_prism:ctx=>prism(ctx,4),
  scope_6x:ctx=>telescope(ctx,6),scope_8x:ctx=>telescope(ctx,8),
  vgrip:ctx=>grip(ctx,'vertical'),half_grip:ctx=>grip(ctx,'half'),thumb_grip:ctx=>grip(ctx,'thumb'),light_grip:ctx=>grip(ctx,'light'),pump_stop:ctx=>grip(ctx,'pump'),
  compact_laser:ctx=>compactRail(ctx,false,false),pistol_laser:ctx=>compactRail(ctx,false,true),pistol_light:ctx=>compactRail(ctx,true,true),
};
