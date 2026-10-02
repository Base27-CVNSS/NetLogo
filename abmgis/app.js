(() => {
  'use strict';

  const COLORS = { RED:'#f05a5a', BLUE:'#4d8cff', SHELTER:'#62d18b' };
  const MAX_MINUTES = 60;
  const els = id => document.getElementById(id);
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const lerp = (a,b,t) => a + (b-a)*t;
  const round = (v,n=1) => Number(v).toFixed(n);

  const protocol = new pmtiles.Protocol({ metadata:true });
  maplibregl.addProtocol('pmtiles', protocol.tile);

  const map = new maplibregl.Map({
    container:'map',
    style:'https://demotiles.maplibre.org/pmtiles/vector/style.json',
    center:[-77.0147,38.9026], zoom:10.7, minZoom:7, maxZoom:18,
    attributionControl:false
  });
  map.addControl(new maplibregl.NavigationControl({showCompass:true}),'top-right');
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');

  let geo=null, neighbors=new Map(), zones=new Map(), agents=[];
  let running=false, timer=null, minute=0, totalMoves=0, selectedAgentId=null;
  let histories={happy:[],water:[]};
  let shelterIds=[];

  function log(message){
    const row=document.createElement('div');
    row.innerHTML=`<time>${formatTime(minute)}</time>${message}`;
    els('log').prepend(row);
    while(els('log').children.length>60) els('log').lastElementChild.remove();
  }

  function setBadge(type,text){
    const b=els('runtimeBadge');
    b.className='badge'+(type?` ${type}`:'');
    b.innerHTML=`<i></i>${text}`;
  }

  map.on('error', e => {
    const msg=String(e?.error?.message||'').toLowerCase();
    if(msg.includes('pmtiles')){
      setBadge('error','PMTiles lỗi · nền dự phòng');
      try{ map.setStyle('https://tiles.openfreemap.org/styles/liberty'); }catch(_e){}
    }
  });

  Promise.all([
    fetch('./data/dc.geojson').then(r=>{if(!r.ok)throw new Error('dc.geojson');return r.json();}),
    fetch('./data/neighbors.json').then(r=>{if(!r.ok)throw new Error('neighbors.json');return r.json();})
  ]).then(([g,pairs])=>{
    geo=g;
    for(const f of geo.features){
      const id=Number(f.properties.ID);
      if(!neighbors.has(id)) neighbors.set(id,new Set());
    }
    for(const [a,b] of pairs){
      if(!neighbors.has(a)) neighbors.set(a,new Set());
      neighbors.get(a).add(b);
    }
    buildWorld();
    resetSimulation(false);
    addLayers();
    fitData();
    log(`Đã nạp ${geo.features.length} vùng, ${pairs.length.toLocaleString('vi-VN')} quan hệ topology và ${agents.length} agent.`);
  }).catch(err=>{
    setBadge('error','Không tải được dữ liệu');
    log(`Lỗi dữ liệu: ${err.message}`);
  });

  map.on('style.load',()=>{
    if(geo){ addLayers(); renderAll(); }
    if(!els('runtimeBadge').classList.contains('error')) setBadge('ok','ABMGIS runtime sẵn sàng');
  });

  function buildWorld(){
    zones.clear();
    const centers=[];
    for(const f of geo.features){
      const id=Number(f.properties.ID);
      const centroid=polygonCentroid(f.geometry.coordinates);
      centers.push({id,centroid});
    }
    const lngs=centers.map(x=>x.centroid[0]), lats=centers.map(x=>x.centroid[1]);
    const minLng=Math.min(...lngs), maxLng=Math.max(...lngs), minLat=Math.min(...lats), maxLat=Math.max(...lats);

    for(const f of geo.features){
      const id=Number(f.properties.ID);
      const centroid=centers.find(x=>x.id===id).centroid;
      const nx=(centroid[0]-minLng)/(maxLng-minLng||1);
      const ny=(centroid[1]-minLat)/(maxLat-minLat||1);
      const terrain=clamp(0.10 + 0.54*ny + 0.18*nx + pseudo(id*17)*0.18,0,1);
      const drainage=clamp(0.28 + pseudo(id*31)*0.62,0,1);
      const impervious=clamp(0.45 + pseudo(id*47)*0.46,0,1);
      zones.set(id,{
        id,feature:f,centroid,terrain,drainage,impervious,
        rainAccum:0, waterStore:0, waterDepth:0, access:1,
        initialSOC:f.properties.SOC, shelter:false
      });
    }

    // Chọn các vùng cao + thoát nước tốt + kết nối tốt làm shelter minh họa.
    shelterIds=[...zones.values()]
      .map(z=>({id:z.id,score:z.terrain*0.55+z.drainage*0.30+clamp((neighbors.get(z.id)?.size||0)/12,0,1)*0.15}))
      .sort((a,b)=>b.score-a.score).slice(0,6).map(x=>x.id);
    shelterIds.forEach(id=>zones.get(id).shelter=true);
  }

  function resetSimulation(writeLog=true){
    stopRun(false);
    minute=0; totalMoves=0; selectedAgentId=null; histories={happy:[],water:[]};
    for(const z of zones.values()){
      z.rainAccum=0; z.waterStore=0; z.waterDepth=0; z.access=1;
    }
    agents=[];
    let seq=1;
    for(const z of zones.values()){
      if(z.initialSOC==='UNOCCUPIED') continue;
      const group=z.initialSOC==='RED'?'RED':'BLUE';
      agents.push({
        id:seq++, group, homeZone:z.id, zoneId:z.id,
        socialTolerance:clamp(Number(els('threshold')?.value||35)/100 + (pseudo(z.id*71)-0.5)*0.16,0.10,0.90),
        floodTolerance:0.10 + pseudo(z.id*97)*0.23,
        mobility:0.55 + pseudo(z.id*111)*0.45,
        informed:pseudo(z.id*131)>0.35,
        status:'STAY', targetZone:null, path:[], trail:[z.centroid],
        socialScore:1, utility:1, exposure:0, reason:'Khởi tạo tại vùng cư trú ban đầu.'
      });
    }
    updateEnvironmentGeo();
    const m=metrics(); histories.happy.push(m.happyPct); histories.water.push(m.meanDepthNorm);
    updateUI(m); renderAll(); drawChart(); updateSelectedAgent();
    if(writeLog) log('Khởi tạo ABMGIS Rain-60: agent độc lập, GIS là môi trường động.');
  }

  function step(){
    if(!geo || minute>=MAX_MINUTES){ stopRun(); return; }
    minute++;
    updateHydrology();
    decideAndMoveAgents();
    const m=metrics();
    histories.happy.push(m.happyPct); histories.water.push(m.meanDepthNorm);
    updateEnvironmentGeo(); renderAll(); updateUI(m); drawChart(); updateSelectedAgent();
    if(minute%5===0 || minute===1 || minute===60){
      log(`Mưa ${round(m.rainAccum,0)} mm · ngập max ${round(m.maxDepth*100,0)} cm · ${m.evacuating} đang sơ tán · ${m.sheltered} đã trú ẩn.`);
    }
    if(minute>=MAX_MINUTES){
      stopRun(false); els('runState').textContent='Hoàn tất 60 phút';
      log('Kết thúc kịch bản 60 phút. Quan sát mẫu di chuyển, phơi nhiễm và mức phân tách sau tác động mưa.');
    }
  }

  function updateHydrology(){
    const intensity=Number(els('rainIntensity').value); // mm/h
    const rainPerMinute=intensity/60;
    const previous=new Map([...zones].map(([id,z])=>[id,z.waterStore]));

    for(const z of zones.values()) z.rainAccum+=rainPerMinute;

    for(const z of zones.values()){
      const lowland=1-z.terrain;
      const runoff=rainPerMinute*(0.35+0.60*z.impervious)*(0.75+1.10*lowland);
      let neighborInflow=0;
      for(const nid of neighbors.get(z.id)||[]){
        const nz=zones.get(nid); if(!nz) continue;
        if(nz.terrain>z.terrain){
          neighborInflow += Math.max(0,(previous.get(nid)||0)-(previous.get(z.id)||0))*0.018;
        }
      }
      const drainOut=(0.18+0.68*z.drainage)*(0.65+0.35*z.terrain);
      z.waterStore=Math.max(0,z.waterStore+runoff+neighborInflow-drainOut);
      // Chuyển storage minh họa sang depth; giới hạn 0.8 m để giữ ổn định trực quan.
      z.waterDepth=clamp((z.waterStore/1000)*5.2,0,0.8);
      z.access=clamp(1-z.waterDepth/0.42,0.05,1);
    }
  }

  function decideAndMoveAgents(){
    const occ=occupancyMap();
    shuffle(agents);
    for(const a of agents){
      const z=zones.get(a.zoneId); if(!z) continue;
      a.socialTolerance=clamp(Number(els('threshold').value)/100 + (pseudo(a.id*53)-0.5)*0.16,0.10,0.90);
      a.socialScore=socialScore(a,occ);
      const floodUrgency=z.waterDepth/Math.max(0.05,a.floodTolerance);
      const socialUnhappy=a.socialScore<a.socialTolerance;
      const unsafe=floodUrgency>=1;
      const currentUtility=utility(a,z,a.socialScore,0);
      a.utility=currentUtility;
      a.targetZone=null;

      if(z.shelter && unsafe===false){
        a.status='SHELTERED';
        a.reason='Đã ở điểm trú ẩn an toàn; ưu tiên ở lại.';
      } else if(unsafe){
        const route=findSafestShelterRoute(a.zoneId);
        if(route.length>1){
          a.status='EVACUATE'; a.targetZone=route[route.length-1]; a.path=route.slice(1);
          a.reason=`Ngập ${round(z.waterDepth*100,0)} cm vượt ngưỡng chịu ${round(a.floodTolerance*100,0)} cm; ưu tiên an toàn và đi tới shelter.`;
        } else {
          a.status='TRAPPED'; a.reason='Ngập vượt ngưỡng nhưng chưa tìm được tuyến tốt hơn trong graph hiện tại.';
        }
      } else if(socialUnhappy){
        const candidates=[...(neighbors.get(a.zoneId)||[])]
          .map(id=>zones.get(id)).filter(Boolean)
          .filter(c=>c.waterDepth<a.floodTolerance*0.9 && (occ.get(c.id)||0)===0);
        let best=null, bestU=currentUtility;
        for(const c of candidates){
          const sc=socialScoreAt(a,c.id,occ);
          const u=utility(a,c,sc,1);
          if(u>bestU+0.025){ best=c; bestU=u; }
        }
        if(best){
          a.status='RELOCATE'; a.targetZone=best.id; a.path=[best.id];
          a.reason=`Không hài lòng xã hội (${round(a.socialScore*100,0)}% < ${round(a.socialTolerance*100,0)}%); chọn vùng lân cận có utility cao hơn.`;
        } else {
          a.status='STAY'; a.reason='Chưa hài lòng xã hội nhưng không có vùng trống lân cận đủ an toàn và tốt hơn.';
        }
      } else {
        a.status='STAY'; a.reason='Môi trường còn trong ngưỡng chịu đựng và cấu trúc xã hội đạt yêu cầu.';
      }

      // Di chuyển tối đa 1 cạnh topology mỗi phút.
      if(a.path.length && a.mobility>0.5){
        const next=a.path.shift();
        if(zones.has(next)){
          a.zoneId=next; totalMoves++;
          const p=agentPoint(a,occ);
          a.trail.push(p);
          if(a.trail.length>18) a.trail.shift();
        }
      }

      const now=zones.get(a.zoneId);
      if(now?.shelter && (a.status==='EVACUATE'||a.status==='SHELTERED')){
        a.status='SHELTERED'; a.path=[]; a.targetZone=now.id;
      }
      if(now?.waterDepth>0.20) a.exposure++;
    }
  }

  function utility(a,z,social,moveCost){
    const progress=minute/MAX_MINUTES;
    const hazard=clamp(z.waterDepth/Math.max(0.05,a.floodTolerance),0,2)/2;
    const safety=1-hazard;
    const socialW=lerp(0.46,0.16,clamp(progress+hazard*0.5,0,1));
    const safetyW=lerp(0.34,0.62,clamp(progress+hazard*0.5,0,1));
    const accessW=0.15;
    const moveW=0.05;
    return socialW*social + safetyW*safety + accessW*z.access - moveW*moveCost;
  }

  function socialScore(a,occ){ return socialScoreAt(a,a.zoneId,occ); }
  function socialScoreAt(a,zoneId,occ){
    let same=0,total=0;
    const ids=new Set([zoneId,...(neighbors.get(zoneId)||[])]);
    for(const other of agents){
      if(other.id===a.id || !ids.has(other.zoneId)) continue;
      total++; if(other.group===a.group) same++;
    }
    return total? same/total : 1;
  }

  function findSafestShelterRoute(start){
    if(shelterIds.includes(start)) return [start];
    const dist=new Map([[start,0]]), prev=new Map(), open=[start];
    while(open.length){
      open.sort((a,b)=>(dist.get(a)??Infinity)-(dist.get(b)??Infinity));
      const cur=open.shift();
      if(shelterIds.includes(cur)){
        const path=[cur]; let x=cur;
        while(prev.has(x)){x=prev.get(x);path.push(x);} return path.reverse();
      }
      for(const nid of neighbors.get(cur)||[]){
        const z=zones.get(nid); if(!z) continue;
        const cost=1 + z.waterDepth*18 + (1-z.access)*4;
        const nd=(dist.get(cur)||0)+cost;
        if(nd<(dist.get(nid)??Infinity)){
          dist.set(nid,nd); prev.set(nid,cur); if(!open.includes(nid)) open.push(nid);
        }
      }
    }
    return [start];
  }

  function occupancyMap(){
    const m=new Map(); for(const a of agents)m.set(a.zoneId,(m.get(a.zoneId)||0)+1); return m;
  }

  function metrics(){
    const occ=occupancyMap();
    let happy=0,same=0,evacuating=0,sheltered=0,exposure=0,riskAgents=0;
    for(const a of agents){
      a.socialScore=socialScore(a,occ);
      same+=a.socialScore;
      if(a.socialScore>=a.socialTolerance) happy++;
      if(a.status==='EVACUATE') evacuating++;
      if(a.status==='SHELTERED') sheltered++;
      exposure+=a.exposure;
      if((zones.get(a.zoneId)?.waterDepth||0)>0.20) riskAgents++;
    }
    const depths=[...zones.values()].map(z=>z.waterDepth);
    const maxDepth=Math.max(0,...depths), meanDepth=depths.reduce((s,v)=>s+v,0)/(depths.length||1);
    const intensity=Number(els('rainIntensity')?.value||60);
    return {
      happyPct:agents.length?happy/agents.length*100:100,
      samePct:agents.length?same/agents.length*100:100,
      evacuating,sheltered,exposure,riskAgents,maxDepth,meanDepth,
      meanDepthNorm:clamp(meanDepth/0.30*100,0,100),
      rainAccum:[...zones.values()][0]?.rainAccum||0
    };
  }

  function addLayers(){
    if(!geo || !map.isStyleLoaded()) return;
    if(!map.getSource('abm-zones')) map.addSource('abm-zones',{type:'geojson',data:geo,promoteId:'ID'});
    if(!map.getLayer('abm-water')) map.addLayer({id:'abm-water',type:'fill',source:'abm-zones',paint:{
      'fill-color':['interpolate',['linear'],['coalesce',['get','waterDepth'],0],
        0,'#263941',0.05,'#8fd3ff',0.12,'#55aef0',0.25,'#247bc0',0.5,'#0b3f7a'],
      'fill-opacity':['case',['boolean',['feature-state','hover'],false],0.92,0.72]
    }});
    if(!map.getLayer('abm-outline')) map.addLayer({id:'abm-outline',type:'line',source:'abm-zones',paint:{'line-color':'#e7f0f3','line-width':['case',['boolean',['feature-state','hover'],false],2.1,0.55],'line-opacity':0.7}});

    if(!map.getSource('abm-shelters')) map.addSource('abm-shelters',{type:'geojson',data:shelterGeoJSON()});
    if(!map.getLayer('abm-shelters')) map.addLayer({id:'abm-shelters',type:'circle',source:'abm-shelters',paint:{'circle-radius':6,'circle-color':COLORS.SHELTER,'circle-stroke-color':'#ffffff','circle-stroke-width':1.5}});

    if(!map.getSource('abm-trails')) map.addSource('abm-trails',{type:'geojson',data:trailGeoJSON()});
    if(!map.getLayer('abm-trails')) map.addLayer({id:'abm-trails',type:'line',source:'abm-trails',paint:{'line-color':['match',['get','group'],'RED',COLORS.RED,COLORS.BLUE],'line-width':1.5,'line-opacity':0.42}});

    if(!map.getSource('abm-agents')) map.addSource('abm-agents',{type:'geojson',data:agentGeoJSON()});
    if(!map.getLayer('abm-agents')) map.addLayer({id:'abm-agents',type:'circle',source:'abm-agents',paint:{
      'circle-radius':['case',['==',['get','status'],'EVACUATE'],6.2,5],
      'circle-color':['match',['get','group'],'RED',COLORS.RED,COLORS.BLUE],
      'circle-stroke-color':['case',['==',['get','status'],'SHELTERED'],COLORS.SHELTER,'#ffffff'],
      'circle-stroke-width':['case',['==',['get','status'],'EVACUATE'],2.2,1.2],
      'circle-opacity':0.96
    }});
    bindInteractions();
    renderAll();
  }

  let interactionsBound=false, hoveredZone=null;
  function bindInteractions(){
    if(interactionsBound) return; interactionsBound=true;
    map.on('mousemove','abm-water',e=>{
      if(!e.features?.length)return;
      map.getCanvas().style.cursor='crosshair';
      if(hoveredZone!==null) map.setFeatureState({source:'abm-zones',id:hoveredZone},{hover:false});
      const f=e.features[0], id=Number(f.properties.ID); hoveredZone=id;
      map.setFeatureState({source:'abm-zones',id},{hover:true});
      const z=zones.get(id), count=agents.filter(a=>a.zoneId===id).length;
      els('hoverWard').textContent=`Vùng ${id}`;
      els('hoverDepth').textContent=z?`${round(z.waterDepth*100,1)} cm`:'—';
      els('hoverAgents').textContent=`${count} agent`;
      els('hoverDrain').textContent=z?`${round(z.drainage*100,0)}%`:'—';
    });
    map.on('mouseleave','abm-water',()=>{
      map.getCanvas().style.cursor='';
      if(hoveredZone!==null)map.setFeatureState({source:'abm-zones',id:hoveredZone},{hover:false}); hoveredZone=null;
    });
    map.on('click','abm-agents',e=>{
      if(!e.features?.length)return;
      selectedAgentId=Number(e.features[0].properties.id); updateSelectedAgent();
    });
    map.on('mouseenter','abm-agents',()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','abm-agents',()=>map.getCanvas().style.cursor='');
    map.on('click','abm-shelters',e=>{
      if(!e.features?.length)return;
      const p=e.features[0].properties;
      new maplibregl.Popup({offset:8}).setLngLat(e.lngLat).setHTML(`<b>Điểm trú ẩn · Vùng ${p.zoneId}</b><br><small>Vị trí minh họa được chọn theo địa hình/thoát nước/kết nối trong mô hình.</small>`).addTo(map);
    });
  }

  function updateEnvironmentGeo(){
    if(!geo)return;
    for(const f of geo.features){
      const z=zones.get(Number(f.properties.ID));
      if(z){f.properties.waterDepth=z.waterDepth;f.properties.rainAccum=z.rainAccum;f.properties.drainage=z.drainage;f.properties.access=z.access;f.properties.shelter=z.shelter?1:0;}
    }
  }

  function renderAll(){
    updateEnvironmentGeo();
    const zsrc=map.getSource('abm-zones'); if(zsrc)zsrc.setData(geo);
    const asrc=map.getSource('abm-agents'); if(asrc)asrc.setData(agentGeoJSON());
    const tsrc=map.getSource('abm-trails'); if(tsrc)tsrc.setData(trailGeoJSON());
    const ssrc=map.getSource('abm-shelters'); if(ssrc)ssrc.setData(shelterGeoJSON());
  }

  function agentGeoJSON(){
    const occ=occupancyMap(), within=new Map();
    return {type:'FeatureCollection',features:agents.map(a=>{
      const key=a.zoneId; const idx=within.get(key)||0; within.set(key,idx+1);
      const base=zones.get(a.zoneId)?.centroid||[0,0];
      const p=jitterPoint(base,idx,Math.max(1,occ.get(key)||1));
      return {type:'Feature',geometry:{type:'Point',coordinates:p},properties:{id:a.id,group:a.group,status:a.status,zoneId:a.zoneId}};
    })};
  }

  function trailGeoJSON(){
    return {type:'FeatureCollection',features:agents.filter(a=>a.trail.length>1).map(a=>({type:'Feature',geometry:{type:'LineString',coordinates:a.trail},properties:{id:a.id,group:a.group}}))};
  }

  function shelterGeoJSON(){
    return {type:'FeatureCollection',features:shelterIds.map(id=>({type:'Feature',geometry:{type:'Point',coordinates:zones.get(id).centroid},properties:{zoneId:id}}))};
  }

  function agentPoint(a){
    return zones.get(a.zoneId)?.centroid||[0,0];
  }

  function jitterPoint(base,index,total){
    if(total<=1)return base;
    const ang=(index/total)*Math.PI*2 + (index%3)*0.4;
    const r=0.00065+Math.min(total,8)*0.00004;
    return [base[0]+Math.cos(ang)*r,base[1]+Math.sin(ang)*r];
  }

  function updateUI(m=metrics()){
    els('timeStat').textContent=formatTime(minute);
    els('rainStat').textContent=`${round(m.rainAccum,0)} mm`;
    els('agentStat').textContent=agents.length;
    els('evacStat').textContent=m.evacuating;
    els('depthStat').textContent=`${round(m.maxDepth*100,0)} cm`;
    els('exposureStat').textContent=m.exposure;
    els('happyStat').textContent=`${round(m.happyPct,1)}%`;
    els('sameStat').textContent=`${round(m.samePct,1)}%`;
    els('moveStat').textContent=totalMoves;
    els('shelteredStat').textContent=m.sheltered;
    els('riskAgentStat').textContent=m.riskAgents;
    els('clockLabel').textContent=`${formatTime(minute)} / 01:00`;
    els('timeProgress').style.width=`${minute/MAX_MINUTES*100}%`;
    els('rainScreen').style.opacity=minute>0?clamp(Number(els('rainIntensity').value)/120*0.48,0.08,0.48):0;
    els('phaseLabel').textContent=minute===0?'Khởi tạo':minute<15?'Mưa bắt đầu':minute<35?'Tích nước & thích nghi':minute<60?'Sơ tán & tái cấu trúc':'Kết thúc';
  }

  function updateSelectedAgent(){
    const a=agents.find(x=>x.id===selectedAgentId);
    if(!a){
      els('selectedAgentStatus').textContent='Click một agent'; els('selectedAgentId').textContent='Chưa chọn'; els('selectedAgentGroup').textContent='—'; els('selectedAgentZone').textContent='—'; els('selectedAgentSocial').textContent='—'; els('selectedAgentDepth').textContent='—'; els('selectedAgentTolerance').textContent='—'; els('selectedAgentUtility').textContent='—'; els('selectedAgentTarget').textContent='—'; els('selectedAgentReason').textContent='Chọn một chấm Đỏ/Xanh trên bản đồ để xem vì sao agent quyết định ở lại, tái định cư hoặc sơ tán.'; els('selectedAgentAvatar').style.background='#1f3742'; return;
    }
    const z=zones.get(a.zoneId);
    els('selectedAgentStatus').textContent=statusLabel(a.status);
    els('selectedAgentId').textContent=`Agent #${a.id}`;
    els('selectedAgentGroup').textContent=`Nhóm ${a.group==='RED'?'Đỏ':'Xanh'} · home ${a.homeZone}`;
    els('selectedAgentZone').textContent=`${a.zoneId}`;
    els('selectedAgentSocial').textContent=`${round(a.socialScore*100,0)}%`;
    els('selectedAgentDepth').textContent=`${round((z?.waterDepth||0)*100,1)} cm`;
    els('selectedAgentTolerance').textContent=`${round(a.floodTolerance*100,0)} cm`;
    els('selectedAgentUtility').textContent=round(a.utility,2);
    els('selectedAgentTarget').textContent=a.targetZone?`Vùng ${a.targetZone}`:'Ở lại';
    els('selectedAgentReason').textContent=a.reason;
    els('selectedAgentAvatar').style.background=a.group==='RED'?COLORS.RED:COLORS.BLUE;
  }

  function statusLabel(s){return ({STAY:'Ở lại',RELOCATE:'Tái định cư',EVACUATE:'Đang sơ tán',SHELTERED:'Đã trú ẩn',TRAPPED:'Bị cô lập'})[s]||s;}

  function drawChart(){
    const c=els('chart'),dpr=window.devicePixelRatio||1,rect=c.getBoundingClientRect();const w=Math.max(250,rect.width),h=Math.max(120,rect.height);
    c.width=w*dpr;c.height=h*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,w,h);
    x.strokeStyle='rgba(124,163,175,.17)';x.lineWidth=1;for(let i=1;i<4;i++){const y=h*i/4;x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke();}
    drawSeries(x,histories.happy,w,h,'#2fd3d2'); drawSeries(x,histories.water,w,h,'#5cb8ff');
  }
  function drawSeries(ctx,arr,w,h,color){if(!arr.length)return;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();arr.forEach((v,i)=>{const px=arr.length===1?0:i/(MAX_MINUTES)*w;const py=h-clamp(v,0,100)/100*h;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();}

  function startRun(){if(running||!geo||minute>=MAX_MINUTES)return;running=true;els('runBtn').textContent='Tạm dừng';els('runBtn').classList.add('running');els('runState').textContent='Đang chạy';schedule();}
  function schedule(){if(!running)return;const s=Number(els('speed').value);timer=setTimeout(()=>{step();schedule();},1000/s);}
  function stopRun(update=true){running=false;if(timer)clearTimeout(timer);timer=null;if(els('runBtn')){els('runBtn').textContent='Chạy 60 phút';els('runBtn').classList.remove('running');}if(update&&els('runState'))els('runState').textContent=minute>=60?'Hoàn tất':'Tạm dừng';}

  function fitData(){if(!geo)return;const b=new maplibregl.LngLatBounds();geo.features.forEach(f=>walkCoords(f.geometry.coordinates,c=>b.extend(c)));map.fitBounds(b,{padding:38,duration:650});}
  function walkCoords(a,fn){if(typeof a?.[0]==='number')fn(a);else if(Array.isArray(a))a.forEach(x=>walkCoords(x,fn));}
  function polygonCentroid(coords){
    let ring=coords; while(Array.isArray(ring?.[0]?.[0]?.[0]))ring=ring[0]; if(Array.isArray(ring?.[0]?.[0])&&typeof ring[0][0]==='number'){} else ring=ring[0];
    if(!Array.isArray(ring)||!ring.length)return[-77.01,38.90]; let sx=0,sy=0,n=0; for(const p of ring){if(typeof p?.[0]==='number'){sx+=p[0];sy+=p[1];n++;}} return n?[sx/n,sy/n]:[-77.01,38.90];
  }
  function pseudo(seed){const x=Math.sin(seed*12.9898+78.233)*43758.5453;return x-Math.floor(x);}
  function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function formatTime(m){const mm=String(clamp(m,0,60)).padStart(2,'0');return `00:${mm}`.replace('00:60','01:00');}

  els('setupBtn').addEventListener('click',()=>resetSimulation(true));
  els('stepBtn').addEventListener('click',()=>{stopRun(false);step();});
  els('runBtn').addEventListener('click',()=>running?stopRun(true):startRun());
  els('resetViewBtn').addEventListener('click',fitData);
  els('rainIntensity').addEventListener('input',e=>{els('rainValue').textContent=`${e.target.value} mm/h`;});
  els('threshold').addEventListener('input',e=>{els('thresholdValue').textContent=`${e.target.value}%`;});
  els('speed').addEventListener('input',e=>{els('speedValue').textContent=`${e.target.value} phút/s`;if(running){clearTimeout(timer);schedule();}});
  document.querySelectorAll('[data-rain]').forEach(b=>b.addEventListener('click',()=>{els('rainIntensity').value=b.dataset.rain;els('rainValue').textContent=`${b.dataset.rain} mm/h`;}));
  els('basemapToggle').addEventListener('change',e=>{for(const l of map.getStyle()?.layers||[])if(!l.id.startsWith('abm-'))map.setLayoutProperty(l.id,'visibility',e.target.checked?'visible':'none');});
  els('waterToggle').addEventListener('change',e=>setVisibility('abm-water',e.target.checked));
  els('agentsToggle').addEventListener('change',e=>setVisibility('abm-agents',e.target.checked));
  els('trailsToggle').addEventListener('change',e=>setVisibility('abm-trails',e.target.checked));
  els('shelterToggle').addEventListener('change',e=>setVisibility('abm-shelters',e.target.checked));
  els('outlineToggle').addEventListener('change',e=>setVisibility('abm-outline',e.target.checked));
  function setVisibility(id,on){if(map.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');}
  window.addEventListener('resize',()=>{map.resize();drawChart();});
})();
