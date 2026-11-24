const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'linesim-opt-'));
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--enable-unsafe-webgpu']});
  try{
    const snapshots=[];
    for(const [name,file] of [['before','index.html'],['after','index.html']]){
      const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      let html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
      if(name==='before') {
        html=html.replace('nearestRoutePoint(qx, qy, lo, hi, rlast, nearest);\n        bi = nearest.index; bdist = nearest.d2;',
          'for(var ri=lo;ri<=hi;ri++){var dx=routePts[ri][0]-qx,dy=routePts[ri][1]-qy,dd2=dx*dx+dy*dy;if(dd2<bdist){bdist=dd2;bi=ri;}}');
        html=html.replaceAll('trialCache.get(candidates[next].join("|"))','undefined').replaceAll('trialCache.get(candidates[index].join("|"))','undefined');
      }
      const expose=name==='after'?'nearestRoutePoint,ensureRouteIndex,':'';
      html=html.replace(/\}\)\(\);\s*<\/script>/,`window.qa={${expose}simulate,runBestSearch,get P(){return P},get H(){return H},get route(){return routePts},get course(){return COURSE},get stats(){return gpuSensorStats}};})();</script>`);
      const target=path.join(temp,name+'.html');fs.writeFileSync(target,html);await page.goto(pathToFileURL(target).href);
      await page.waitForFunction(()=>window.qa&&qa.H&&qa.stats.backend==='gpu',null,{timeout:30000});
      if(name==='after'){
        const nearest=await page.evaluate(()=>{
          qa.ensureRouteIndex();let state=1337;
          function random(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
          for(let k=0;k<20000;k++){
            const hint=Math.floor(random()*qa.route.length),point=qa.route[hint],x=point[0]+(random()-.5)*60,y=point[1]+(random()-.5)*60;
            const lo=Math.max(0,hint-120),hi=Math.min(qa.route.length-1,hint+160),result={};let bi=-1,d2=1e9;
            for(let i=lo;i<=hi;i++){const dx=qa.route[i][0]-x,dy=qa.route[i][1]-y,d=dx*dx+dy*dy;if(d<d2){d2=d;bi=i}}
            qa.nearestRoutePoint(x,y,lo,hi,hint,result);
            if(bi!==result.index||d2!==result.d2)return false;
          }
          return true;
        });assert.ok(nearest,'Indexed route queries must exactly match linear queries');
      }
      const trace=await page.evaluate(()=>{
        const old={...qa.P};Object.assign(qa.P,{Kp:.23,Kd:.0144,slow:.275,speed:90});const h=qa.simulate();Object.assign(qa.P,old);
        return {N:h.N,route:h.route,tracking:h.tracking,err:Array.from(h.err),x:Array.from(h.x),y:Array.from(h.y)};
      });
      const search=await page.evaluate(()=>new Promise(resolve=>{const start=performance.now();qa.runBestSearch((good,fallback)=>resolve({seconds:(performance.now()-start)/1000,good,fallback}),()=>{},true)}));
      assert.ok(search.good&&search.good.pass===12);assert.deepEqual(errors,[]);
      snapshots.push({name,trace,search});
      if(name==='after') {
        for(const course of ['junior','elem','mid','formula']) {
          await page.selectOption('#course',course);
          await page.waitForFunction(id=>qa.course.id===id&&qa.course.ready,course);
          const exact=await page.evaluate(()=>{
            qa.ensureRouteIndex();const result={};
            for(let k=0;k<3000;k++) {
              const hint=k*139%qa.route.length,p=qa.route[hint],x=p[0]+(k%17-8)*.71,y=p[1]+(k%19-9)*.83;
              const lo=Math.max(0,hint-120),hi=Math.min(qa.route.length-1,hint+160);let bi=-1,d2=1e9;
              for(let i=lo;i<=hi;i++){const dx=qa.route[i][0]-x,dy=qa.route[i][1]-y,d=dx*dx+dy*dy;if(d<d2){d2=d;bi=i}}
              qa.nearestRoutePoint(x,y,lo,hi,hint,result);if(bi!==result.index||d2!==result.d2)return false;
            }
            return true;
          });assert.ok(exact,course+' indexed queries must match linear search');
        }
      }
      await page.close();
    }
    assert.deepEqual(snapshots[1].trace,snapshots[0].trace,'Optimized route search must preserve full trajectory');
    assert.deepEqual(snapshots[1].search.good,snapshots[0].search.good,'Caching and route index must preserve winner and every score');
    assert.deepEqual(snapshots[1].search.fallback,snapshots[0].search.fallback);
    console.log(JSON.stringify({beforeSeconds:snapshots[0].search.seconds,afterSeconds:snapshots[1].search.seconds,speedup:snapshots[0].search.seconds/snapshots[1].search.seconds,routeQueries:32000,identicalTrajectory:true,identicalScores:true,tune:snapshots[1].search.good.c},null,2));
  }finally{await browser.close();fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
