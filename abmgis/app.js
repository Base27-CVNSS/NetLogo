(() => {
  'use strict';

  const COLORS = { RED: '#f05a5a', BLUE: '#4d8cff', UNOCCUPIED: '#7d8790' };
  const els = id => document.getElementById(id);
  const protocol = new pmtiles.Protocol({ metadata: true });
  maplibregl.addProtocol('pmtiles', protocol.tile);

  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/pmtiles/vector/style.json',
    center: [-77.0147, 38.9026], zoom: 10.7, minZoom: 7, maxZoom: 18,
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  let geo = null, initialStates = new Map(), states = new Map(), neighbors = new Map();
  let running = false, timer = null, tick = 0, moves = 0, history = [];
  let loadedOverlay = false, currentMetrics = null;

  function log(message) {
    const row = document.createElement('div');
    row.innerHTML = `<time>T${String(tick).padStart(3,'0')}</time>${message}`;
    els('log').prepend(row);
    while (els('log').children.length > 40) els('log').lastElementChild.remove();
  }

  function setBadge(type, text) {
    const b = els('runtimeBadge');
    b.className = 'badge' + (type ? ` ${type}` : '');
    b.innerHTML = `<i></i>${text}`;
  }

  map.on('error', e => {
    if (!loadedOverlay && String(e?.error?.message || '').toLowerCase().includes('pmtiles')) {
      setBadge('error', 'PMTiles lỗi · dùng nền dự phòng');
      map.setStyle('https://tiles.openfreemap.org/styles/liberty');
    }
  });

  Promise.all([
    fetch('./data/dc.geojson').then(r => { if(!r.ok) throw new Error('dc.geojson'); return r.json(); }),
    fetch('./data/neighbors.json').then(r => { if(!r.ok) throw new Error('neighbors.json'); return r.json(); })
  ]).then(([g, pairs]) => {
    geo = g;
    for (const f of geo.features) {
      const id = Number(f.properties.ID);
      initialStates.set(id, f.properties.SOC);
      if (!neighbors.has(id)) neighbors.set(id, new Set());
    }
    for (const [a,b] of pairs) {
      if (!neighbors.has(a)) neighbors.set(a,new Set());
      neighbors.get(a).add(b);
    }
    resetSimulation(false);
    tryAddOverlay();
    log(`Đã nạp ${geo.features.length} vùng và ${pairs.length.toLocaleString('vi-VN')} quan hệ láng giềng.`);
  }).catch(err => {
    setBadge('error','Không tải được dữ liệu mô phỏng');
    log(`Lỗi dữ liệu: ${err.message}`);
  });

  map.on('style.load', () => {
    tryAddOverlay();
    if (!els('runtimeBadge').classList.contains('error')) setBadge('ok','PMTiles · MapLibre sẵn sàng');
  });

  function tryAddOverlay() {
    if (!geo || !map.isStyleLoaded()) return;
    if (map.getSource('abm-areas')) return;
    map.addSource('abm-areas', { type:'geojson', data: geo, promoteId: 'ID' });
    map.addLayer({ id:'abm-fill', type:'fill', source:'abm-areas', paint:{
      'fill-color':['match',['get','SOC'],'RED',COLORS.RED,'BLUE',COLORS.BLUE,COLORS.UNOCCUPIED],
      'fill-opacity':['case',['boolean',['feature-state','hover'],false],.92,.72]
    }});
    map.addLayer({ id:'abm-outline', type:'line', source:'abm-areas', paint:{ 'line-color':'#e8f2f3','line-width':['case',['boolean',['feature-state','hover'],false],2.2,.55],'line-opacity':.7 }});
    map.addLayer({ id:'abm-labels', type:'symbol', source:'abm-areas', minzoom:11.5, layout:{ 'text-field':['to-string',['get','ID']], 'text-size':10, 'visibility':'none' }, paint:{ 'text-color':'#e8f5f7','text-halo-color':'#07141c','text-halo-width':1.2 }});
    loadedOverlay = true;
    bindMapInteractions();
    fitData();
    updateMap();
  }

  let hoveredId = null;
  function bindMapInteractions() {
    map.on('mousemove','abm-fill', e => {
      if (!e.features?.length) return;
      map.getCanvas().style.cursor = 'pointer';
      if (hoveredId !== null) map.setFeatureState({source:'abm-areas',id:hoveredId},{hover:false});
      const f=e.features[0]; hoveredId=Number(f.properties.ID);
      map.setFeatureState({source:'abm-areas',id:hoveredId},{hover:true});
      els('hoverWard').textContent = `Vùng ${hoveredId}${f.properties.WARD_ID ? ' · '+f.properties.WARD_ID : ''}`;
      els('hoverState').textContent = stateLabel(states.get(hoveredId));
      els('hoverNeighbors').textContent = `${neighbors.get(hoveredId)?.size || 0} vùng`;
    });
    map.on('mouseleave','abm-fill',() => {
      map.getCanvas().style.cursor='';
      if(hoveredId!==null) map.setFeatureState({source:'abm-areas',id:hoveredId},{hover:false});
      hoveredId=null;
    });
    map.on('click','abm-fill',e=>{
      if(!e.features?.length) return;
      const id=Number(e.features[0].properties.ID); const st=states.get(id); const ns=[...(neighbors.get(id)||[])];
      const red=ns.filter(n=>states.get(n)==='RED').length, blue=ns.filter(n=>states.get(n)==='BLUE').length, empty=ns.length-red-blue;
      new maplibregl.Popup({closeButton:false,offset:8}).setLngLat(e.lngLat).setHTML(`<div style="font:12px system-ui;min-width:160px"><b>Vùng ${id}</b><br>Trạng thái: ${stateLabel(st)}<hr style="border:0;border-top:1px solid #ddd">Láng giềng: ${ns.length}<br>Đỏ ${red} · Xanh ${blue} · Trống ${empty}</div>`).addTo(map);
    });
  }

  function stateLabel(s){ return s==='RED'?'Nhóm Đỏ':s==='BLUE'?'Nhóm Xanh':'Chưa cư trú'; }
  function fitData(){ if(!geo) return; const b=new maplibregl.LngLatBounds(); geo.features.forEach(f=>walkCoords(f.geometry.coordinates,c=>b.extend(c))); map.fitBounds(b,{padding:38,duration:700}); }
  function walkCoords(a,fn){ if(typeof a?.[0]==='number') fn(a); else if(Array.isArray(a)) a.forEach(x=>walkCoords(x,fn)); }

  function resetSimulation(writeLog=true) {
    states = new Map(initialStates);
    tick = 0; moves = 0; history = [];
    stopRun(false);
    currentMetrics = metrics();
    history.push(currentMetrics.happyPct);
    updateUI(); updateMap(); drawChart();
    if(writeLog) log('Khởi tạo lại trạng thái ban đầu từ NetLogo.');
  }

  function metrics() {
    let agents=0, happy=0, sameSum=0, red=0, blue=0, empty=0;
    const threshold = Number(els('threshold')?.value || 35)/100;
    for (const [id,st] of states) {
      if(st==='UNOCCUPIED'){empty++;continue;}
      agents++; if(st==='RED') red++; else blue++;
      let r=0,b=0;
      for(const n of neighbors.get(id)||[]) { const ns=states.get(n); if(ns==='RED')r++; else if(ns==='BLUE')b++; }
      const total=r+b; const same= total===0 ? 1 : (st==='RED'?r:b)/total;
      sameSum+=same; if(same>=threshold) happy++;
    }
    return {agents,happy,happyPct:agents?happy/agents*100:100,samePct:agents?sameSum/agents*100:100,red,blue,empty};
  }

  function step() {
    if(!geo) return;
    const threshold=Number(els('threshold').value)/100;
    const unhappy=[];
    for(const [id,st] of states){
      if(st==='UNOCCUPIED') continue;
      let r=0,b=0;
      for(const n of neighbors.get(id)||[]){const ns=states.get(n);if(ns==='RED')r++;else if(ns==='BLUE')b++;}
      const same=(r+b)===0?1:(st==='RED'?r:b)/(r+b);
      if(same<threshold) unhappy.push(id);
    }
    shuffle(unhappy);
    let movedThis=0;
    for(const id of unhappy){
      const color=states.get(id);
      if(color==='UNOCCUPIED') continue;
      const choices=[...(neighbors.get(id)||[])].filter(n=>states.get(n)==='UNOCCUPIED');
      if(!choices.length) continue;
      const target=choices[Math.floor(Math.random()*choices.length)];
      states.set(id,'UNOCCUPIED'); states.set(target,color); movedThis++; moves++;
    }
    tick++;
    currentMetrics=metrics(); history.push(currentMetrics.happyPct); if(history.length>180) history.shift();
    updateUI(); updateMap(); drawChart();
    log(`Bước ${tick}: ${movedThis} tác tử di chuyển · ${currentMetrics.happyPct.toFixed(1)}% hài lòng.`);
    if(currentMetrics.happy===currentMetrics.agents){ stopRun(false); els('phaseLabel').textContent='Cân bằng'; log('Hệ thống đạt trạng thái tất cả tác tử hài lòng.'); }
  }

  function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

  function updateMap(){
    if(!geo || !map.getSource('abm-areas')) return;
    for(const f of geo.features) f.properties.SOC=states.get(Number(f.properties.ID))||f.properties.SOC;
    map.getSource('abm-areas').setData(geo);
  }

  function updateUI(){
    currentMetrics=currentMetrics||metrics(); const m=currentMetrics;
    els('tickStat').textContent=tick; els('agentStat').textContent=m.agents; els('happyStat').textContent=`${m.happyPct.toFixed(1)}%`; els('emptyStat').textContent=m.empty; els('moveStat').textContent=moves; els('sameStat').textContent=`${m.samePct.toFixed(1)}%`;
    els('redCount').textContent=m.red; els('blueCount').textContent=m.blue; els('emptyCount').textContent=m.empty;
    const total=states.size||188; els('redBar').style.width=`${m.red/total*100}%`; els('blueBar').style.width=`${m.blue/total*100}%`; els('emptyBar').style.width=`${m.empty/total*100}%`;
    els('phaseLabel').textContent=m.happyPct===100?'Cân bằng':tick===0?'Khởi tạo':m.happyPct>80?'Ổn định dần':m.happyPct>55?'Tái cấu trúc':'Phân tách mạnh';
  }

  function drawChart(){
    const c=els('chart'), dpr=window.devicePixelRatio||1, rect=c.getBoundingClientRect(); const w=Math.max(250,rect.width),h=Math.max(120,rect.height);
    c.width=w*dpr;c.height=h*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,w,h);
    x.strokeStyle='rgba(124,163,175,.18)';x.lineWidth=1;for(let i=1;i<4;i++){const y=h*i/4;x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke();}
    if(history.length<1)return;x.strokeStyle='#2fd3d2';x.lineWidth=2;x.beginPath();history.forEach((v,i)=>{const px=history.length===1?0:i/(history.length-1)*w;const py=h-(v/100*h);i?x.lineTo(px,py):x.moveTo(px,py);});x.stroke();
    const v=history[history.length-1];x.fillStyle='#eaf4f7';x.font='600 11px system-ui';x.fillText(`${v.toFixed(1)}%`,Math.max(4,w-44),Math.max(12,h-(v/100*h)-7));
  }

  function startRun(){ if(running||!geo)return; running=true; els('runBtn').textContent='Tạm dừng';els('runBtn').classList.add('running');els('runState').textContent='Đang chạy'; schedule(); }
  function schedule(){ if(!running)return; const s=Number(els('speed').value); timer=setTimeout(()=>{step();schedule();},1000/s); }
  function stopRun(update=true){ running=false;if(timer)clearTimeout(timer);timer=null;if(els('runBtn')){els('runBtn').textContent='Chạy liên tục';els('runBtn').classList.remove('running');}if(update&&els('runState'))els('runState').textContent='Tạm dừng'; }

  els('setupBtn').addEventListener('click',()=>resetSimulation(true));
  els('stepBtn').addEventListener('click',()=>{stopRun(false);step();});
  els('runBtn').addEventListener('click',()=>running?stopRun(true):startRun());
  els('resetViewBtn').addEventListener('click',fitData);
  els('threshold').addEventListener('input',e=>{els('thresholdValue').textContent=`${e.target.value}%`;currentMetrics=metrics();updateUI();});
  els('speed').addEventListener('input',e=>{els('speedValue').textContent=`${e.target.value} bước/s`;if(running){clearTimeout(timer);schedule();}});
  document.querySelectorAll('[data-threshold]').forEach(b=>b.addEventListener('click',()=>{els('threshold').value=b.dataset.threshold;els('thresholdValue').textContent=`${b.dataset.threshold}%`;currentMetrics=metrics();updateUI();}));
  els('areasToggle').addEventListener('change',e=>setVisibility('abm-fill',e.target.checked));
  els('outlineToggle').addEventListener('change',e=>setVisibility('abm-outline',e.target.checked));
  els('labelsToggle').addEventListener('change',e=>setVisibility('abm-labels',e.target.checked));
  els('basemapToggle').addEventListener('change',e=>{
    for(const l of map.getStyle()?.layers||[]) if(!l.id.startsWith('abm-')) map.setLayoutProperty(l.id,'visibility',e.target.checked?'visible':'none');
  });
  function setVisibility(id,on){if(map.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');}
  window.addEventListener('resize',()=>{map.resize();drawChart();});
})();