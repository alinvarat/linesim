const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    html=html.replace(/\}\)\(\);\s*<\/script>/,'window.qa={evaluateTune,tuneMetrics,tuneState,restoreTune,VSEEDS,runBestSearch,get P(){return P},get H(){return H}};})();</script>');
    await page.setContent(html);await page.waitForFunction(()=>window.qa&&qa.H);await page.evaluate(()=>{qa.P.mu=2;qa.P.load=.8;qa.P.loadReal=.8;qa.P.lat=12;qa.P.yawInertia=.00075;qa.P.recMs=0});
    const scoring=await page.evaluate(()=>{
      function metric(N,values={}){
        return qa.tuneMetrics({N,err:new Int16Array(N),lost:new Uint8Array(N),ridx:new Uint16Array(N),tracking:{offTime:0,maxGap:0,curveOffTime:0,curveMaxGap:0,curveN:0,curveSq:0,lostTime:0,lostMaxGap:0,curveLostTime:0,curveLostMaxGap:0,...values}}).score;
      }
      return {fast:metric(200),slow:metric(400),off:metric(200,{offTime:.5}),curve:metric(200,{offTime:.5,curveOffTime:.5}),loss:metric(200,{lostTime:.5,lostMaxGap:.5}),continuous:metric(200,{offTime:.5,curveOffTime:.5,lostTime:.5,curveLostTime:.5,curveLostMaxGap:.5}),broken:metric(200,{offTime:.5,curveOffTime:.5,lostTime:.5,curveLostTime:.5,curveLostMaxGap:.1})};
    });
    assert.ok(scoring.fast<scoring.slow,'Reward shorter actual lap time');
    assert.ok(scoring.fast<scoring.off,'Penalize geometric loss even when sensor lost=0');
    assert.ok(scoring.curve>scoring.off,'Keep a soft centering cost on curves');
    assert.ok(scoring.loss>scoring.curve,'Seeing the line while offset must be better than actual line loss');
    assert.ok(scoring.continuous>scoring.broken,'Penalize long continuous gaps');
    const result=await page.evaluate(()=>new Promise(resolve=>{
      const before={...qa.P},sv=qa.tuneState();
      const baseline=qa.evaluateTune([.1,.004,0,45],qa.VSEEDS,true,sv,false);delete baseline._runs;qa.restoreTune(sv);
      const started=performance.now();let svUsed=null;qa.runBestSearch((good,fallback)=>{
        // The baseline must be scored with the same real-reference yardsticks the search used, otherwise it escapes the chatter/lag rules.
        const sv2={...svUsed};const baselineSame=qa.evaluateTune([.1,.004,0,45],qa.VSEEDS,true,sv2,true);delete baselineSame._runs;qa.restoreTune(sv2);
        resolve({seconds:(performance.now()-started)/1000,baseline:baselineSame,baselineRaw:baseline,good,fallback,before,after:{...qa.P}});
      },()=>{},true,{onSetup:s=>{svUsed=s}});
    }));
    assert.ok(result.good && result.good.pass===12);
    assert.deepEqual(result.after,result.before);
    assert.equal(result.baseline.pass,12,'Reference tune must finish all start cases');
    assert.ok(Number.isFinite(result.good.lostTime)&&result.good.lostTime>=0,'Report actual loss separately; the weighted objective may trade it against time');
    assert.ok(Number.isFinite(result.good.curveLostTime)&&Number.isFinite(result.good.curveLostMaxGap),'Report actual line loss on curves independently from centering');
    assert.ok(result.good.score<result.baseline.score);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({searchSeconds:result.seconds,before:result.baseline,after:result.good},null,2));
    await page.close();
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
