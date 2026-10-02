(() => {
  'use strict';

  const AGENT_COUNT = 1000;
  const MICRO_PER_ZONE = 6;
  const DT = 5; // seconds/tick: microsimulation needs finer time than 1 minute
  const MAX_SECONDS = 3600;
  const MAX_TICKS = MAX_SECONDS / DT;
  const SEGMENT_LENGTH_M = 120;
  const COLORS = { MOTO:'#2fd3d2', CAR:'#ff9a56', HEAVY:'#b97cff', SHELTER:'#62d18b' };
  const $ = id => document.getElementById(id);
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const lerp = (a,b,t) => a+(b-a)*t;
  const round = (v,n=1) => Number(v).toFixed(n);

  const protocol = new pmtiles.Protocol({metadata:true});
  maplibregl.addProtocol('pmtiles', protocol.tile);
  const map = new maplibregl.Map({
    container:'map', style:'https://demotiles.maplibre.org/pmtiles/vector/style.json',
    center:[-77.0147,38.9026], zoom:10.7, minZoom:7, maxZoom:18, attributionControl:false
  });
  map.addControl(new maplibregl.NavigationControl({showCompass:true}),'top-right');
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');

  let geo=null, neighbors=new Map(), zones=new Map(), microzones=new Map(), agents=[];
  let shelterIds=[], tick=0, elapsed=0, running=false, timer=null, selectedAgentId=null;
  let totalMoves=0, totalLaneChanges=0, totalNearMiss=0, interactionsBound=false, hoveredZone=null;
  let history={speed:[],congestion:[],disorder:[]};

  function setBadge(type,text){ const b=$('runtimeBadge'); b.className='badge'+(type?` ${type}`:''); b.innerHTML=`<i></i>${text}`; }
  function log(msg){ const row=document.createElement('div'); row.innerHTML=`<time>${formatTime(elapsed)}</time>${msg}`; $('log').prepend(row); while($('log').children.length>70)$('log').lastElementChild.remove(); }

  map.on('error',e=>{
    const msg=String(e?.error?.message||'').toLowerCase();
    if(msg.includes('pmtiles')){ setBadge('error','PMTiles lỗi · dùng nền dự phòng'); try{map.setStyle('https://tiles.openfreemap.org/styles/liberty');}catch(_e){} }
  });

  Promise.all([
    fetch('./data/dc.geojson').then(r=>{if(!r.ok)throw new Error('dc.geojson');return r.json();}),
    fetch('./data/neighbors.json').then(r=>{if(!r.ok)throw new Error('neighbors.json');return r.json();})
  ]).then(([g,pairs])=>{
    geo=g;
    for(const f of geo.features){ const id=Number(f.properties.ID); if(!neighbors.has(id))neighbors.set(id,new Set()); }
    for(const [a,b] of pairs){ if(!neighbors.has(a))neighbors.set(a,new Set()); neighbors.get(a).add(b); }
    buildEnvironment();
    resetSimulation(false);
    addLayers(); fitData();
    setBadge('ok','AEIO-1000 sẵn sàng');
    log(`Nạp ${zones.size} vùng GIS → ${microzones.size} vi môi trường; khởi tạo ${AGENT_COUNT.toLocaleString('vi-VN')} agent.`);
  }).catch(err=>{ setBadge('error','Không tải được dữ liệu'); log(`Lỗi: ${err.message}`); });

  map.on('style.load',()=>{ if(geo){ addLayers(); renderAll(); if(!$('runtimeBadge').classList.contains('error'))setBadge('ok','AEIO-1000 sẵn sàng'); }});

  function buildEnvironment(){
    zones.clear(); microzones.clear();
    const centers=[];
    for(const f of geo.features) centers.push({id:Number(f.properties.ID),c:polygonCentroid(f.geometry.coordinates)});
    const lngs=centers.map(x=>x.c[0]), lats=centers.map(x=>x.c[1]);
    const minLng=Math.min(...lngs), maxLng=Math.max(...lngs), minLat=Math.min(...lats), maxLat=Math.max(...lats);
    for(const f of geo.features){
      const id=Number(f.properties.ID), centroid=centers.find(x=>x.id===id).c;
      const nx=(centroid[0]-minLng)/(maxLng-minLng||1), ny=(centroid[1]-minLat)/(maxLat-minLat||1);
      const terrain=clamp(.10+.54*ny+.18*nx+pseudo(id*17)*.18,0,1);
      const drainage=clamp(.22+pseudo(id*31)*.68,0,1);
      const impervious=clamp(.40+pseudo(id*47)*.55,0,1);
      zones.set(id,{id,feature:f,centroid,terrain,drainage,impervious,rainAccum:0,waterStore:0,waterDepth:0,access:1,shelter:false,signalOffset:(id*11)%60});
      for(let slot=0;slot<MICRO_PER_ZONE;slot++){
        const lane=(slot%3)+1, dir=slot<3?1:-1, mid=`${id}:${slot}`;
        microzones.set(mid,{id:mid,zoneId:id,slot,lane,dir,capacity:4+Math.floor(pseudo(id*101+slot)*3),point:microPoint(centroid,slot),density:0});
      }
    }
    shelterIds=[...zones.values()].map(z=>({id:z.id,score:z.terrain*.55+z.drainage*.30+clamp((neighbors.get(z.id)?.size||0)/12,0,1)*.15})).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.id);
    shelterIds.forEach(id=>zones.get(id).shelter=true);
  }

  function resetSimulation(writeLog=true){
    stopRun(false); tick=0; elapsed=0; totalMoves=0; totalLaneChanges=0; totalNearMiss=0; selectedAgentId=null; history={speed:[],congestion:[],disorder:[]};
    for(const z of zones.values()){ z.rainAccum=0; z.waterStore=0; z.waterDepth=0; z.access=1; }
    agents=createAgents(AGENT_COUNT);
    const m=metrics(); pushHistory(m); updateEnvironmentGeo(); updateUI(m); renderAll(); drawChart(); updateSelectedAgent();
    if(writeLog)log('Khởi tạo lại 1.000 tác tử theo AEIO. Kết quả nổi lên chưa được lập trình sẵn.');
  }

  function createAgents(n){
    const zoneIds=[...zones.keys()];
    const out=[];
    for(let i=1;i<=n;i++){
      const zoneId=zoneIds[(i*37 + Math.floor(pseudo(i*19)*zoneIds.length))%zoneIds.length];
      const slot=(i*13+Math.floor(pseudo(i*23)*6))%6;
      const type=vehicleType(i);
      const p=profile(type,i);
      const z=zones.get(zoneId);
      const original=z.feature.properties.SOC;
      const group=original==='RED'||original==='BLUE'?original:(pseudo(i*29)>.5?'RED':'BLUE');
      out.push({
        id:i,type,group,homeZone:zoneId,zoneId,slot,microId:`${zoneId}:${slot}`,lane:(slot%3)+1,dir:slot<3?1:-1,progress:pseudo(i*41),
        speed:p.desired*(.55+.35*pseudo(i*43)),desiredSpeed:p.desired,maxSpeed:p.max,accel:p.accel,decel:p.decel,length:p.length,safeGap:p.safeGap,
        patience:clamp(.2+.78*pseudo(i*59),0,1),aggression:clamp(.15+.8*pseudo(i*61),0,1),baseCompliance:clamp(.35+.64*pseudo(i*67),0,1),
        floodTolerance:.08+.27*pseudo(i*71),vision:25+55*pseudo(i*73),status:'MOVE',reason:'Khởi tạo',route:[],targetZone:null,
        socialTolerance:clamp(Number($('threshold')?.value||35)/100+(pseudo(i*79)-.5)*.16,.1,.9),socialScore:1,exposure:0,trail:[microPoint(z.centroid,slot)],nearMiss:0
      });
    }
    return out;
  }

  function vehicleType(i){ const r=pseudo(i*7); return r<.70?'MOTORBIKE':r<.92?'CAR':r<.97?'TRUCK':'BUS'; }
  function profile(type,i){
    const j=.88+.24*pseudo(i*83);
    if(type==='MOTORBIKE')return{desired:42*j,max:62,accel:2.0,decel:3.8,length:2.0,safeGap:3.0};
    if(type==='CAR')return{desired:36*j,max:55,accel:1.6,decel:3.5,length:4.5,safeGap:6.0};
    if(type==='TRUCK')return{desired:28*j,max:42,accel:1.0,decel:2.5,length:8.0,safeGap:9.0};
    return{desired:30*j,max:45,accel:1.1,decel:2.7,length:10.0,safeGap:10.0};
  }

  function step(){
    if(!geo||elapsed>=MAX_SECONDS){stopRun();return;}
    tick++; elapsed=Math.min(MAX_SECONDS,elapsed+DT);
    updateHydrology();
    const state=buildInteractionState();
    updateAgents(state);
    const m=metrics(); pushHistory(m); updateEnvironmentGeo(); renderAll(); updateUI(m); updateSelectedAgent(); if(tick%3===0)drawChart();
    if(tick===1||tick%60===0||elapsed>=MAX_SECONDS)log(`t=${formatTime(elapsed)} · tốc độ TB ${round(m.avgSpeed,1)} km/h · ùn tắc ${round(m.congestionPct,0)}% · near-miss ${totalNearMiss}.`);
    if(elapsed>=MAX_SECONDS){stopRun(false);$('runState').textContent='Hoàn tất 60 phút';log('Hoàn tất 720 tick. Có thể đổi mức hỗn loạn/mưa rồi Khởi tạo để so sánh kịch bản.');}
  }

  function updateHydrology(){
    const intensity=Number($('rainIntensity').value); const rainMm=intensity*DT/3600;
    const previous=new Map([...zones].map(([id,z])=>[id,z.waterStore]));
    for(const z of zones.values())z.rainAccum+=rainMm;
    for(const z of zones.values()){
      const lowland=1-z.terrain;
      const runoff=rainMm*(.28+.68*z.impervious)*(.72+1.25*lowland);
      let inflow=0;
      for(const nid of neighbors.get(z.id)||[]){ const nz=zones.get(nid); if(nz&&nz.terrain>z.terrain)inflow+=Math.max(0,(previous.get(nid)||0)-(previous.get(z.id)||0))*.006; }
      const drain=(.10+.62*z.drainage)*(.6+.4*z.terrain)*DT/5;
      z.waterStore=Math.max(0,z.waterStore+runoff+inflow-drain);
      z.waterDepth=clamp(z.waterStore/1000*5.0,0,.8);
      z.access=clamp(1-z.waterDepth/.42,.04,1);
    }
  }

  function buildInteractionState(){
    const microBuckets=new Map(), macroBuckets=new Map(), groupCounts=new Map();
    for(const m of microzones.values())m.density=0;
    for(const a of agents){
      if(!microBuckets.has(a.microId))microBuckets.set(a.microId,[]); microBuckets.get(a.microId).push(a);
      if(!macroBuckets.has(a.zoneId))macroBuckets.set(a.zoneId,[]); macroBuckets.get(a.zoneId).push(a);
      const key=`${a.zoneId}:${a.group}`; groupCounts.set(key,(groupCounts.get(key)||0)+1);
    }
    for(const [mid,list] of microBuckets){ const m=microzones.get(mid); if(m)m.density=list.length/Math.max(1,m.capacity); list.sort((a,b)=>a.progress-b.progress); }
    return{microBuckets,macroBuckets,groupCounts};
  }

  function updateAgents(state){
    const chaos=Number($('chaos').value)/100;
    const rain=Number($('rainIntensity').value);
    for(const a of agents){
      if(a.status==='SHELTERED')continue;
      const z=zones.get(a.zoneId), m=microzones.get(a.microId); if(!z||!m)continue;
      const compliance=clamp(a.baseCompliance-chaos*.55+(pseudo(a.id+tick*.17)-.5)*.08,.02,1);
      const acceptedGap=a.safeGap*lerp(1.2,.55,chaos)*lerp(1.05,.8,a.aggression);
      const perception=perceive(a,state,acceptedGap);
      const social=socialScore(a,state.groupCounts); a.socialScore=social;
      const unsafe=z.waterDepth>a.floodTolerance;
      const socialUnhappy=social<a.socialTolerance;
      const signalGreen=isSignalGreen(z,a.dir,elapsed);
      const density=m.density;
      const weatherFactor=clamp(1-rain/220-z.waterDepth/.55,.12,1);
      const densityFactor=1/(1+Math.max(0,density-0.45)*.9);
      let desired=Math.min(a.maxSpeed,a.desiredSpeed*weatherFactor*densityFactor);

      // Interaction: car-following / collision avoidance.
      if(perception.front){
        if(perception.gap<acceptedGap){
          desired=Math.min(desired,perception.front.speed*.70);
          a.status='FOLLOW'; a.reason=`Bám xe: khoảng cách ${round(perception.gap,1)} m < ngưỡng ${round(acceptedGap,1)} m.`;
          if(perception.gap<Math.max(.8,a.length*.35)){ totalNearMiss++; a.nearMiss++; desired=0; a.reason='Near-miss: giảm tốc khẩn cấp để tránh va chạm.'; }
          if(perception.gap<acceptedGap*.8 && shouldChangeLane(a,chaos,perception,state)) changeLane(a,state,chaos);
        }
      }

      // Environment + Organisation: flood evacuation and signal compliance.
      if(unsafe){
        if(!a.route.length || a.targetZone===null){ a.route=findShelterRoute(a.zoneId,state.macroBuckets); a.targetZone=a.route[a.route.length-1]||null; }
        a.status='EVACUATE'; desired=Math.min(desired,a.desiredSpeed*.75); a.reason=`Ngập ${round(z.waterDepth*100,0)} cm vượt ngưỡng ${round(a.floodTolerance*100,0)} cm; ưu tiên tuyến an toàn.`;
      } else if(socialUnhappy && a.route.length===0 && pseudo(a.id*97+tick)<.025){
        const dest=bestSocialNeighbor(a,state.groupCounts);
        if(dest&&dest!==a.zoneId){ a.route=[dest]; a.targetZone=dest; a.reason=`Schelling mở rộng: đồng nhóm ${round(social*100,0)}% thấp hơn ngưỡng; thử chuyển vùng lân cận.`; }
      }

      if(a.progress>.93 && !signalGreen && compliance>chaos*.55){ desired=0; a.status='WAIT'; a.reason='Tuân thủ tín hiệu tổ chức: chờ pha đèn phù hợp.'; }
      else if(a.progress>.93 && !signalGreen && compliance<=chaos*.55){ a.reason='Hỗn loạn: bỏ qua tín hiệu do mức tuân thủ thấp.'; }

      // Acceleration/deceleration.
      const speedMs=a.speed/3.6, desiredMs=desired/3.6;
      let nextMs=speedMs;
      if(desiredMs>speedMs)nextMs=Math.min(desiredMs,speedMs+a.accel*DT);
      else nextMs=Math.max(desiredMs,speedMs-a.decel*DT);
      a.speed=clamp(nextMs*3.6,0,a.maxSpeed);

      // Microscopic movement along a logical lane cell.
      const delta=(a.speed/3.6)*DT/SEGMENT_LENGTH_M;
      a.progress+=delta;
      if(a.progress>=1){
        const crossed=crossBoundary(a,state,compliance,chaos);
        if(crossed){ a.progress=a.progress%1; totalMoves++; const p=agentPoint(a); a.trail.push(p); if(a.trail.length>16)a.trail.shift(); }
        else a.progress=.98;
      }
      const now=zones.get(a.zoneId);
      if(now?.shelter && unsafe){ a.status='SHELTERED'; a.speed=0; a.route=[]; a.targetZone=now.id; a.reason='Đã tới điểm trú ẩn.'; }
      if(now?.waterDepth>.20)a.exposure+=DT;
      if(a.status==='MOVE'||a.status==='FOLLOW'||a.status==='CHANGE_LANE'){
        if(a.speed<1)a.status='WAIT'; else if(a.status!=='FOLLOW'&&a.status!=='CHANGE_LANE')a.status='MOVE';
      }
    }
  }

  function perceive(a,state,acceptedGap){
    const list=state.microBuckets.get(a.microId)||[]; let front=null,gap=Infinity;
    for(const b of list){ if(b.id===a.id||b.progress<=a.progress)continue; const g=(b.progress-a.progress)*SEGMENT_LENGTH_M-a.length; if(g<gap&&g<=a.vision){gap=g;front=b;} }
    return{front,gap,acceptedGap};
  }

  function shouldChangeLane(a,chaos,perception,state){
    const chance=.12+.42*a.aggression+.35*chaos+.18*(1-a.patience);
    return pseudo(a.id*131+tick*17)<chance && perception.gap<a.safeGap*1.2;
  }

  function changeLane(a,state,chaos){
    const lane=a.lane, candidates=[];
    for(const d of [-1,1]){ const nl=lane+d; if(nl<1||nl>3)continue; const slot=(a.dir===1?0:3)+(nl-1); const mid=`${a.zoneId}:${slot}`; const list=state.microBuckets.get(mid)||[]; let safe=true; for(const b of list){const g=Math.abs(b.progress-a.progress)*SEGMENT_LENGTH_M;if(g<a.safeGap*lerp(1,.6,chaos)){safe=false;break;}} if(safe)candidates.push({slot,mid,nl,count:list.length}); }
    if(candidates.length){ candidates.sort((x,y)=>x.count-y.count); const c=candidates[0]; a.slot=c.slot;a.microId=c.mid;a.lane=c.nl;a.status='CHANGE_LANE';totalLaneChanges++;a.reason=`Đổi làn ${lane}→${a.lane} sau khi quan sát khoảng trống an toàn.`; }
  }

  function crossBoundary(a,state,compliance,chaos){
    const current=a.zoneId;
    let next=null;
    if(a.route.length){ next=a.route.shift(); }
    if(!next){
      const nids=[...(neighbors.get(current)||[])]; if(!nids.length)return false;
      const scored=nids.map(id=>{const z=zones.get(id);const density=(state.macroBuckets.get(id)||[]).length;const disorder=pseudo(a.id*193+id*17+tick);const cost=(z?.waterDepth||0)*16+density/12+(1-(z?.access||1))*5 + (1-chaos)*disorder;return{id,cost};}).sort((x,y)=>x.cost-y.cost);
      if(chaos>.7 && pseudo(a.id*211+tick)<chaos*.35)next=nids[Math.floor(pseudo(a.id*223+tick)*nids.length)]; else next=scored[0].id;
    }
    if(!zones.has(next))return false;
    a.zoneId=next;
    const slot=(a.dir===1?0:3)+(a.lane-1); a.slot=slot; a.microId=`${next}:${slot}`;
    return true;
  }

  function socialScore(a,groupCounts){
    const ids=[a.zoneId,...(neighbors.get(a.zoneId)||[])]; let same=0,total=0;
    for(const id of ids){ const r=groupCounts.get(`${id}:RED`)||0,b=groupCounts.get(`${id}:BLUE`)||0;total+=r+b;same+=a.group==='RED'?r:b; }
    return total>1?clamp((same-1)/(total-1),0,1):1;
  }

  function bestSocialNeighbor(a,groupCounts){
    let best=a.zoneId,bestScore=socialScore(a,groupCounts);
    for(const id of neighbors.get(a.zoneId)||[]){ const z=zones.get(id); if(!z||z.waterDepth>a.floodTolerance*.9)continue; let same=0,total=0; for(const x of [id,...(neighbors.get(id)||[])]){const r=groupCounts.get(`${x}:RED`)||0,b=groupCounts.get(`${x}:BLUE`)||0;total+=r+b;same+=a.group==='RED'?r:b;} const s=total?same/total:1;if(s>bestScore+.05){best=id;bestScore=s;} }
    return best;
  }

  function findShelterRoute(start,macroBuckets){
    if(shelterIds.includes(start))return[start];
    const dist=new Map([[start,0]]),prev=new Map(),open=[start];
    while(open.length){
      open.sort((a,b)=>(dist.get(a)??Infinity)-(dist.get(b)??Infinity)); const cur=open.shift();
      if(shelterIds.includes(cur)){ const path=[cur];let x=cur;while(prev.has(x)){x=prev.get(x);path.push(x);}return path.reverse().slice(1); }
      for(const nid of neighbors.get(cur)||[]){ const z=zones.get(nid);if(!z)continue;const density=(macroBuckets.get(nid)||[]).length;const cost=1+z.waterDepth*20+(1-z.access)*5+density/40;const nd=(dist.get(cur)||0)+cost;if(nd<(dist.get(nid)??Infinity)){dist.set(nid,nd);prev.set(nid,cur);if(!open.includes(nid))open.push(nid);} }
    }
    return[];
  }

  function isSignalGreen(z,dir,seconds){ const phase=(seconds+z.signalOffset)%60; if(dir===1)return phase<27; return phase>=31&&phase<58; }

  function metrics(){
    let sumSpeed=0,congested=0,follow=0,wait=0,evac=0,sheltered=0,exposure=0,moto=0,car=0,heavy=0;
    for(const a of agents){ sumSpeed+=a.speed;if(a.speed<a.desiredSpeed*.28&&a.status!=='SHELTERED')congested++;if(a.status==='FOLLOW')follow++;if(a.status==='WAIT')wait++;if(a.status==='EVACUATE')evac++;if(a.status==='SHELTERED')sheltered++;if(a.exposure>0)exposure++;if(a.type==='MOTORBIKE')moto++;else if(a.type==='CAR')car++;else heavy++; }
    const avgSpeed=sumSpeed/(agents.length||1), congestionPct=congested/(agents.length||1)*100;
    const chaos=Number($('chaos')?.value||65); const laneRate=clamp(totalLaneChanges/Math.max(1,tick*agents.length)*8000,0,100); const nearRate=clamp(totalNearMiss/Math.max(1,tick*agents.length)*12000,0,100);
    const disorder=clamp(.38*chaos+.27*congestionPct+.20*laneRate+.15*nearRate,0,100);
    return{avgSpeed,congestionPct,follow,wait,evac,sheltered,exposure,moto,car,heavy,disorder};
  }

  function pushHistory(m){ if(tick%6!==0&&tick!==0)return;history.speed.push(clamp(m.avgSpeed/55*100,0,100));history.congestion.push(m.congestionPct);history.disorder.push(m.disorder);if(history.speed.length>130){history.speed.shift();history.congestion.shift();history.disorder.shift();} }

  function addLayers(){
    if(!geo||!map.isStyleLoaded())return;
    if(!map.getSource('abm-zones'))map.addSource('abm-zones',{type:'geojson',data:geo,promoteId:'ID'});
    if(!map.getLayer('abm-water'))map.addLayer({id:'abm-water',type:'fill',source:'abm-zones',paint:{'fill-color':['interpolate',['linear'],['coalesce',['get','waterDepth'],0],0,'#263941',.05,'#8fd3ff',.12,'#55aef0',.25,'#247bc0',.5,'#0b3f7a'],'fill-opacity':['case',['boolean',['feature-state','hover'],false],.9,.62]}});
    if(!map.getLayer('abm-outline'))map.addLayer({id:'abm-outline',type:'line',source:'abm-zones',paint:{'line-color':'#d8e6ea','line-width':['case',['boolean',['feature-state','hover'],false],2,.45],'line-opacity':.55}});
    if(!map.getSource('abm-micro'))map.addSource('abm-micro',{type:'geojson',data:microGeoJSON()});
    if(!map.getLayer('abm-micro'))map.addLayer({id:'abm-micro',type:'circle',source:'abm-micro',paint:{'circle-radius':['interpolate',['linear'],['coalesce',['get','density'],0],0,1.1,1,2.1,2,3.2],'circle-color':['interpolate',['linear'],['coalesce',['get','density'],0],0,'#49606a',.8,'#ffca5c',1.5,'#f05a5a'],'circle-opacity':.58}});
    if(!map.getSource('abm-shelters'))map.addSource('abm-shelters',{type:'geojson',data:shelterGeoJSON()});
    if(!map.getLayer('abm-shelters'))map.addLayer({id:'abm-shelters',type:'circle',source:'abm-shelters',paint:{'circle-radius':6,'circle-color':COLORS.SHELTER,'circle-stroke-color':'#fff','circle-stroke-width':1.5}});
    if(!map.getSource('abm-trails'))map.addSource('abm-trails',{type:'geojson',data:trailGeoJSON()});
    if(!map.getLayer('abm-trails'))map.addLayer({id:'abm-trails',type:'line',source:'abm-trails',layout:{visibility:'none'},paint:{'line-color':['match',['get','type'],'MOTORBIKE',COLORS.MOTO,'CAR',COLORS.CAR,COLORS.HEAVY],'line-width':1,'line-opacity':.22}});
    if(!map.getSource('abm-agents'))map.addSource('abm-agents',{type:'geojson',data:agentGeoJSON()});
    if(!map.getLayer('abm-agents'))map.addLayer({id:'abm-agents',type:'circle',source:'abm-agents',paint:{'circle-radius':['match',['get','type'],'MOTORBIKE',2.2,'CAR',2.9,'TRUCK',3.5,3.8],'circle-color':['match',['get','type'],'MOTORBIKE',COLORS.MOTO,'CAR',COLORS.CAR,COLORS.HEAVY],'circle-stroke-color':['case',['==',['get','status'],'EVACUATE'],'#fff',['==',['get','status'],'SHELTERED'],COLORS.SHELTER,'#0a1117'],'circle-stroke-width':['case',['==',['get','status'],'EVACUATE'],1.6,.55],'circle-opacity':.88}});
    bindInteractions(); renderAll();
  }

  function bindInteractions(){
    if(interactionsBound)return;interactionsBound=true;
    map.on('mousemove','abm-water',e=>{if(!e.features?.length)return;map.getCanvas().style.cursor='crosshair';if(hoveredZone!==null)map.setFeatureState({source:'abm-zones',id:hoveredZone},{hover:false});const f=e.features[0],id=Number(f.properties.ID);hoveredZone=id;map.setFeatureState({source:'abm-zones',id},{hover:true});const z=zones.get(id);const list=agents.filter(a=>a.zoneId===id);const dens=list.length/(MICRO_PER_ZONE*5);$('hoverWard').textContent=`Vùng ${id}`;$('hoverDepth').textContent=`${round((z?.waterDepth||0)*100,1)} cm`;$('hoverAgents').textContent=`${list.length} agent`;$('hoverDensity').textContent=`${round(dens*100,0)}%`;});
    map.on('mouseleave','abm-water',()=>{map.getCanvas().style.cursor='';if(hoveredZone!==null)map.setFeatureState({source:'abm-zones',id:hoveredZone},{hover:false});hoveredZone=null;});
    map.on('click','abm-agents',e=>{if(!e.features?.length)return;selectedAgentId=Number(e.features[0].properties.id);updateSelectedAgent();});
    map.on('mouseenter','abm-agents',()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave','abm-agents',()=>map.getCanvas().style.cursor='');
  }

  function updateEnvironmentGeo(){
    for(const f of geo.features){const z=zones.get(Number(f.properties.ID));if(z){f.properties.waterDepth=z.waterDepth;f.properties.access=z.access;f.properties.rainAccum=z.rainAccum;}}
  }
  function renderAll(){
    if(!geo)return;updateEnvironmentGeo();const z=map.getSource('abm-zones');if(z)z.setData(geo);const m=map.getSource('abm-micro');if(m)m.setData(microGeoJSON());const a=map.getSource('abm-agents');if(a)a.setData(agentGeoJSON());const t=map.getSource('abm-trails');if(t)t.setData(trailGeoJSON());const s=map.getSource('abm-shelters');if(s)s.setData(shelterGeoJSON());
  }

  function microGeoJSON(){return{type:'FeatureCollection',features:[...microzones.values()].map(m=>({type:'Feature',geometry:{type:'Point',coordinates:m.point},properties:{id:m.id,zoneId:m.zoneId,lane:m.lane,dir:m.dir,density:m.density}}))};}
  function agentGeoJSON(){return{type:'FeatureCollection',features:agents.map(a=>({type:'Feature',geometry:{type:'Point',coordinates:agentPoint(a)},properties:{id:a.id,type:a.type,group:a.group,status:a.status,zoneId:a.zoneId}}))};}
  function trailGeoJSON(){return{type:'FeatureCollection',features:agents.filter(a=>a.trail.length>1).slice(0,350).map(a=>({type:'Feature',geometry:{type:'LineString',coordinates:a.trail},properties:{id:a.id,type:a.type}}))};}
  function shelterGeoJSON(){return{type:'FeatureCollection',features:shelterIds.map(id=>({type:'Feature',geometry:{type:'Point',coordinates:zones.get(id).centroid},properties:{zoneId:id}}))};}
  function agentPoint(a){ const base=microzones.get(a.microId)?.point||zones.get(a.zoneId)?.centroid||[0,0];const dir=a.dir;const delta=(a.progress-.5)*.0016*dir;return[base[0]+delta,base[1]+(pseudo(a.id*307)-.5)*.00018]; }
  function microPoint(c,slot){const lane=(slot%3)-1,dir=slot<3?1:-1;return[c[0]+dir*.00045,c[1]+lane*.00033+dir*.00008];}

  function updateUI(m=metrics()){
    $('timeStat').textContent=formatTime(elapsed);$('agentStat').textContent=agents.length.toLocaleString('vi-VN');$('microStat').textContent=microzones.size.toLocaleString('vi-VN');$('avgSpeedStat').textContent=`${round(m.avgSpeed,1)} km/h`;$('congestionStat').textContent=`${round(m.congestionPct,0)}%`;$('nearMissStat').textContent=totalNearMiss.toLocaleString('vi-VN');
    $('vehicleMixStat').textContent=`${m.moto} / ${m.car} / ${m.heavy}`;$('followStat').textContent=m.follow;$('laneChangeStat').textContent=totalLaneChanges.toLocaleString('vi-VN');$('waitStat').textContent=m.wait;$('evacStat').textContent=`${m.evac} / ${m.sheltered}`;$('exposureStat').textContent=m.exposure;
    $('clockLabel').textContent=`${formatTime(elapsed)} / 01:00:00`;$('timeProgress').style.width=`${elapsed/MAX_SECONDS*100}%`;$('rainScreen').style.opacity=elapsed>0?clamp(Number($('rainIntensity').value)/120*.42,.02,.42):0;
    $('phaseLabel').textContent=elapsed===0?'Khởi tạo':m.congestionPct>55?'Ùn tắc nổi lên':m.disorder>70?'Rối loạn cao':elapsed<1200?'Tương tác cục bộ':elapsed<3000?'Tự tổ chức':'Ổn định động';
  }

  function updateSelectedAgent(){
    const a=agents.find(x=>x.id===selectedAgentId);
    if(!a){$('selectedAgentStatus').textContent='Click một tác tử';$('selectedAgentId').textContent='Chưa chọn';$('selectedAgentType').textContent='—';for(const id of ['selectedAgentZone','selectedAgentSpeed','selectedAgentGap','selectedAgentCompliance','selectedAgentPatience','selectedAgentSocial','selectedAgentDepth','selectedAgentTarget'])$(id).textContent='—';$('selectedAgentReason').textContent='Chọn một agent để xem chuỗi cảm nhận → tương tác → tổ chức → quyết định.';return;}
    const z=zones.get(a.zoneId), chaos=Number($('chaos').value)/100, compliance=clamp(a.baseCompliance-chaos*.55,.02,1);$('selectedAgentStatus').textContent=statusLabel(a.status);$('selectedAgentId').textContent=`Agent #${a.id}`;$('selectedAgentType').textContent=`${typeLabel(a.type)} · nhóm ${a.group==='RED'?'Đỏ':'Xanh'} · làn ${a.lane}`;$('selectedAgentZone').textContent=`${a.zoneId} / ${a.microId}`;$('selectedAgentSpeed').textContent=`${round(a.speed,1)} km/h`;$('selectedAgentGap').textContent=`${round(a.safeGap*lerp(1.2,.55,chaos),1)} m`;$('selectedAgentCompliance').textContent=`${round(compliance*100,0)}%`;$('selectedAgentPatience').textContent=`${round(a.patience*100,0)}%`;$('selectedAgentSocial').textContent=`${round(a.socialScore*100,0)}%`;$('selectedAgentDepth').textContent=`${round((z?.waterDepth||0)*100,1)} cm`;$('selectedAgentTarget').textContent=a.targetZone?`Vùng ${a.targetZone}`:'Tuyến mở';$('selectedAgentReason').textContent=a.reason;$('selectedAgentAvatar').style.background=a.type==='MOTORBIKE'?COLORS.MOTO:a.type==='CAR'?COLORS.CAR:COLORS.HEAVY;
  }
  function statusLabel(s){return({MOVE:'Di chuyển',FOLLOW:'Bám xe',CHANGE_LANE:'Đổi làn',WAIT:'Chờ / cản trở',EVACUATE:'Sơ tán',SHELTERED:'Đã trú ẩn'})[s]||s;}
  function typeLabel(t){return t==='MOTORBIKE'?'Xe máy':t==='CAR'?'Ô tô':t==='TRUCK'?'Xe tải':'Xe buýt';}

  function drawChart(){const c=$('chart'),dpr=window.devicePixelRatio||1,rect=c.getBoundingClientRect(),w=Math.max(260,rect.width),h=Math.max(120,rect.height);c.width=w*dpr;c.height=h*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,w,h);x.strokeStyle='rgba(124,163,175,.17)';x.lineWidth=1;for(let i=1;i<4;i++){const y=h*i/4;x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke();}drawSeries(x,history.speed,w,h,COLORS.MOTO);drawSeries(x,history.congestion,w,h,COLORS.CAR);drawSeries(x,history.disorder,w,h,COLORS.HEAVY);}
  function drawSeries(ctx,arr,w,h,color){if(!arr.length)return;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();arr.forEach((v,i)=>{const px=arr.length===1?0:i/(Math.max(1,arr.length-1))*w,py=h-clamp(v,0,100)/100*h;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();}

  function startRun(){if(running||!geo||elapsed>=MAX_SECONDS)return;running=true;$('runBtn').textContent='Tạm dừng';$('runBtn').classList.add('running');$('runState').textContent='Đang chạy';schedule();}
  function schedule(){if(!running)return;const s=Number($('speed').value);timer=setTimeout(()=>{step();schedule();},Math.max(6,1000/s));}
  function stopRun(update=true){running=false;if(timer)clearTimeout(timer);timer=null;if($('runBtn')){$('runBtn').textContent='Chạy 60 phút';$('runBtn').classList.remove('running');}if(update&&$('runState'))$('runState').textContent=elapsed>=MAX_SECONDS?'Hoàn tất':'Tạm dừng';}

  function fitData(){if(!geo)return;const b=new maplibregl.LngLatBounds();geo.features.forEach(f=>walkCoords(f.geometry.coordinates,c=>b.extend(c)));map.fitBounds(b,{padding:38,duration:650});}
  function walkCoords(a,fn){if(typeof a?.[0]==='number')fn(a);else if(Array.isArray(a))a.forEach(x=>walkCoords(x,fn));}
  function polygonCentroid(coords){let ring=coords;while(Array.isArray(ring?.[0]?.[0]?.[0]))ring=ring[0];if(!(Array.isArray(ring?.[0])&&typeof ring[0][0]==='number'))ring=ring[0];if(!Array.isArray(ring)||!ring.length)return[-77.01,38.90];let sx=0,sy=0,n=0;for(const p of ring){if(typeof p?.[0]==='number'){sx+=p[0];sy+=p[1];n++;}}return n?[sx/n,sy/n]:[-77.01,38.90];}
  function pseudo(seed){const x=Math.sin(seed*12.9898+78.233)*43758.5453;return x-Math.floor(x);}
  function formatTime(sec){sec=clamp(Math.floor(sec),0,MAX_SECONDS);const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
  function setVisibility(id,on){if(map.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');}

  $('setupBtn').addEventListener('click',()=>resetSimulation(true));$('stepBtn').addEventListener('click',()=>{stopRun(false);step();});$('runBtn').addEventListener('click',()=>running?stopRun(true):startRun());$('resetViewBtn').addEventListener('click',fitData);
  $('chaos').addEventListener('input',e=>{$('chaosValue').textContent=`${e.target.value}%`;});$('rainIntensity').addEventListener('input',e=>{$('rainValue').textContent=`${e.target.value} mm/h`;});$('threshold').addEventListener('input',e=>{$('thresholdValue').textContent=`${e.target.value}%`;});$('speed').addEventListener('input',e=>{$('speedValue').textContent=`${e.target.value} tick/s`;if(running){clearTimeout(timer);schedule();}});
  document.querySelectorAll('[data-chaos]').forEach(b=>b.addEventListener('click',()=>{$('chaos').value=b.dataset.chaos;$('chaosValue').textContent=`${b.dataset.chaos}%`;}));
  $('basemapToggle').addEventListener('change',e=>{for(const l of map.getStyle()?.layers||[])if(!l.id.startsWith('abm-'))map.setLayoutProperty(l.id,'visibility',e.target.checked?'visible':'none');});$('waterToggle').addEventListener('change',e=>setVisibility('abm-water',e.target.checked));$('microToggle').addEventListener('change',e=>setVisibility('abm-micro',e.target.checked));$('agentsToggle').addEventListener('change',e=>setVisibility('abm-agents',e.target.checked));$('trailsToggle').addEventListener('change',e=>setVisibility('abm-trails',e.target.checked));$('shelterToggle').addEventListener('change',e=>setVisibility('abm-shelters',e.target.checked));$('outlineToggle').addEventListener('change',e=>setVisibility('abm-outline',e.target.checked));window.addEventListener('resize',()=>{map.resize();drawChart();});
})();