const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'linesim-gpu-'));
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--enable-unsafe-webgpu']});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    let html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    html=html.replace(/\}\)\(\);\s*<\/script>/,'window.qa={simulate,spot,spotExact,runBestSearch,get P(){return P},get H(){return H},get course(){return COURSE},get stats(){return gpuSensorStats},get hits(){return spotFastHits},setField(enabled){spotField=enabled?COURSE.sensorField:null},get route(){return routePts}};})();</script>');
    const file=path.join(temp,'index.html');fs.writeFileSync(file,html);await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(()=>window.qa&&qa.H&&qa.stats.backend==='gpu',null,{timeout:30000});
    const sampling=await page.evaluate(()=>{
      let mismatches=0,maxError=0,state=17;
      for(let i=0;i<50000;i++){
        state=(Math.imul(state,1664525)+1013904223)>>>0;
        const point=qa.route[i*37%qa.route.length], dx=(state%1601-800)/100;
        state=(Math.imul(state,1664525)+1013904223)>>>0;
        const x=point[0]+dx,y=point[1]+(state%1601-800)/100;
        const a=qa.spotExact(x,y),b=qa.spot(x,y);maxError=Math.max(maxError,Math.abs(a-b));
        if(Math.round(100*a)!==Math.round(100*b))mismatches++;
      }
      return {mismatches,maxError,hits:qa.hits,stats:{...qa.stats}};
    });
    assert.equal(sampling.mismatches,0);assert.ok(sampling.hits>40000);assert.equal(sampling.stats.dispatches,1);
    const parity=await page.evaluate(()=>{
      const old={...qa.P};let identical=true;
      for(const c of [[.184,.0096,.2,85],[.16,.0144,.275,90],[.1,.003,.1,110]]){
        Object.assign(qa.P,{Kp:c[0],Kd:c[1],slow:c[2],speed:c[3]});
        qa.setField(false);const cpu=qa.simulate();qa.setField(true);const gpu=qa.simulate();
        identical&&=cpu.N===gpu.N&&JSON.stringify(cpu.route)===JSON.stringify(gpu.route)&&JSON.stringify(cpu.tracking)===JSON.stringify(gpu.tracking)&&
          ['x','y','th','pos','err','out','L','R','v','lost','ridx','sens'].every(k=>cpu[k].every((v,i)=>v===gpu[k][i]));
      }
      Object.assign(qa.P,old);return identical;
    });
    assert.ok(parity,'GPU-assisted sensor readings must preserve entire CPU trajectories');
    const results=[];
    for(const enabled of [false,true]){
      const result=await page.evaluate(enabled=>new Promise(resolve=>{
        qa.P.speed=45;qa.setField(enabled);const start=performance.now(),before={...qa.P};
        qa.runBestSearch((good,fallback)=>resolve({seconds:(performance.now()-start)/1000,good,fallback,before,after:{...qa.P},stats:{...qa.stats}}),()=>{},false);
      }),enabled);
      assert.ok(result.good&&result.good.pass===12);assert.deepEqual(result.after,result.before);results.push(result);
    }
    assert.deepEqual(results[1].good,results[0].good,'GPU-assisted search must select identical tune and scores');
    assert.ok(results[1].stats.workerSamples>0,'CPU workers must actually use the GPU-computed table');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({sampling,trajectoriesIdentical:parity,cpuSeconds:results[0].seconds,gpuAssistedSeconds:results[1].seconds,workerGpuSamples:results[1].stats.workerSamples,tune:results[1].good},null,2));
    await page.locator('#speedAuto').uncheck();
    await page.getByRole('button',{name:'เร็วสุด (ตามเวลา)',exact:true}).click();
    await page.waitForFunction(()=>/12 จาก 12 ครั้ง/.test(document.querySelector('#presetnote').textContent),null,{timeout:120000});
    assert.match(await page.locator('#gpuengine').textContent(),/GPU .*ตารางเซนเซอร์พร้อม/);
    await page.screenshot({path:'/tmp/linesim-gpu-verified.png',fullPage:true});
    await page.getByRole('button',{name:'จูนเอง',exact:true}).click();
    await page.selectOption('#course','junior');
    await page.waitForFunction(()=>qa.course.id==='junior'&&qa.course.sensorField&&qa.stats===qa.course.gpuStats);
    const junior=await page.evaluate(()=>{
      const hits=qa.hits;let match=true;
      for(let i=0;i<10000;i++){
        const q=qa.route[i*19%qa.route.length],x=q[0]+(i%31-15)/10,y=q[1]+(i%37-18)/10;
        match&&=Math.round(100*qa.spot(x,y))===Math.round(100*qa.spotExact(x,y));
      }
      qa.setField(false);const cpu=qa.simulate();qa.setField(true);const gpu=qa.simulate();
      match&&=cpu.N===gpu.N&&JSON.stringify(cpu.route)===JSON.stringify(gpu.route)&&cpu.err.every((v,i)=>v===gpu.err[i]);
      return {match,hits:qa.hits-hits};
    });
    assert.ok(junior.match&&junior.hits>9000,'Switching courses must use the new GPU field');
    console.log('GPU course switch: Junior readings and trajectory match CPU');
    const cpuFallback=await browser.newPage(),cpuErrors=[];cpuFallback.on('pageerror',e=>cpuErrors.push(e.message));
    await cpuFallback.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
    await cpuFallback.goto(pathToFileURL(file).href);
    await cpuFallback.waitForFunction(()=>window.qa&&qa.H&&qa.course.sensorField&&qa.stats.backend==='cpu');
    const cpuCacheParity=await cpuFallback.evaluate(()=>{
      qa.setField(false);const reference=qa.simulate();qa.setField(true);const cached=qa.simulate();
      return reference.N===cached.N&&JSON.stringify(reference.route)===JSON.stringify(cached.route)&&
        ['err','pos','x','y','th','L','R','sens'].every(k=>reference[k].every((v,i)=>v===cached[k][i]));
    });assert.ok(cpuCacheParity,'CPU table fallback must preserve full trajectory');
    await cpuFallback.locator('#p_speed').fill('45');
    await cpuFallback.getByRole('button',{name:'เร็วสุด (ตามเวลา)',exact:true}).click();
    await cpuFallback.waitForFunction(()=>/12 จาก 12 ครั้ง/.test(document.querySelector('#presetnote').textContent),null,{timeout:120000});
    assert.match(await cpuFallback.locator('#gpuengine').textContent(),/CPU .*ตารางเซนเซอร์พร้อม/);
    const cpuTune=await cpuFallback.evaluate(()=>[qa.P.Kp,qa.P.Kd,qa.P.slow,qa.P.speed]);
    assert.deepEqual(cpuTune,results[1].good.c);assert.deepEqual(cpuErrors,[]);
    await cpuFallback.close();console.log('GPU unavailable: CPU table preserves trajectory and 12/12 tune');
  }finally{await browser.close();fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
