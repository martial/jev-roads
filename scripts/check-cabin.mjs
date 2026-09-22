import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const url = process.env.SHOTS_URL ?? 'http://localhost:5185';
mkdirSync('shots-out/cabin', { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'], defaultViewport: { width: 1440, height: 900 } });
const errors = [];
let page;
try {
  page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const path = new URL(req.url()).pathname;
    const json = body => req.respond({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/health') return void json({ configured: false });
    if (path === '/api/driver/health') return void json({ configured: true, voice: 'off' });
    if (path === '/api/driver/cast') return void json(null);
    if (path === '/api/driver/line') return void json({ text: 'Mind the upholstery, mate. The dog has been here longer than you.', mood: 'grumble', gesture: 'hand', audio: null, model: 'test', engine: 'test', wordsMs: 1, voiceMs: 0 });
    if (path.startsWith('/api/driver/') || path === '/api/drive') return void json({});
    void req.continue();
  });
  const start = async () => {
    await page.waitForFunction(()=>Boolean(window.jevRoads));
    // Vite may append an HMR timestamp. Import the store the application actually loaded.
    await page.evaluate(async()=>{window.cabinTestStore=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/store.ts').name);});
    await page.waitForFunction(() => { const {get}=window.cabinTestStore; return get().status==='ready' && get().built===1; }, { timeout: 60000 });
    await page.evaluate(async () => {
      const g = window.jevRoads.game;
      g.setSky('midday','clear'); g.startRide(g.ride.destinations()[0].label);
      g.ride.setPhoneEnabled(false);
      window.cabinTestStore.set({gps:false,quoteSeen:true});
    });
    await page.waitForFunction(() => window.jevRoads.game.ride.phase === 'riding');
    await page.waitForSelector('.cabin-objects');
  };
  const press = async item => {
    await page.$eval('.cabin-objects', e => { e.open = true; });
    await page.click(`[data-cabin="${item}"]`);
  };
  const clickObject = async item => {
    const point = await page.evaluate(async item => {
      const THREE = window.jevRoads.THREE;
      const v=window.jevRoads.game.view, mesh=v.cockpit.hotspots.find(m=>m.name===item);
      const p=mesh.getWorldPosition(new THREE.Vector3()).project(v.camera);
      const rect=document.querySelector('canvas.scene').getBoundingClientRect();
      const clientX=rect.left+(p.x+1)*rect.width/2, clientY=rect.top+(1-p.y)*rect.height/2;
      return {clientX,clientY,hit:v.hit({clientX,clientY})};
    },item);
    assert.equal(point.hit,item,`${item} raycast at ${JSON.stringify(point)}`);
    assert.ok(point.clientX>0 && point.clientX<1440 && point.clientY>0 && point.clientY<900,`${item} is visible`);
    await page.mouse.move(point.clientX,point.clientY);
    await page.waitForFunction(item=>document.querySelector('.ride-hint')?.textContent.toLowerCase().includes(item==='dog'?'dog':item==='tree'?'pine':item),{},item);
    await page.mouse.click(point.clientX,point.clientY);
  };
  for (const edition of ['uk','fr']) {
    await page.goto(`${url}/?edition=${edition}&maps=google&scene=reconstructed`,{waitUntil:'domcontentloaded'});
    if(edition==='fr') {
      await page.waitForFunction(()=>Boolean(window.jevRoads));
      await page.evaluate(()=>window.jevRoads.open({name:'Preignac',lat:44.5854,lon:-0.2962}));
    }
    await start();
    await page.screenshot({path:`shots-out/cabin/${edition}-before.png`});
    await press('tree');
    await page.waitForFunction(()=>Math.abs(window.jevRoads.game.view.cockpit.physics.twist.angle)>.05);
    await new Promise(r=>setTimeout(r,600));
    await clickObject('tree');
    await page.screenshot({path:`shots-out/cabin/${edition}-tree.png`});
    await press('dog');
    await page.waitForFunction(()=>window.jevRoads.game.ride.view().cabin.dogPetted);
    await new Promise(r=>setTimeout(r,650));
    await clickObject('dog');
    await press('glovebox');
    await page.waitForFunction(()=>window.jevRoads.game.view.cockpit.gloveAngle>1.2 && window.jevRoads.game.view.cockpit.gloveContents.visible);
    await page.screenshot({path:`shots-out/cabin/${edition}-glovebox.png`});
    await new Promise(r=>setTimeout(r,700));
    await clickObject('glovebox');
    await page.waitForFunction(()=>window.jevRoads.game.view.cockpit.gloveAngle<.08);
    await press('visor');
    await page.waitForFunction(()=>window.jevRoads.game.view.cockpit.visorAngle>1.2);
    await page.screenshot({path:`shots-out/cabin/${edition}-visor.png`});
    await new Promise(r=>setTimeout(r,600));
    await clickObject('visor');
    await page.waitForFunction(()=>window.jevRoads.game.view.cockpit.visorAngle<.08);
    console.log(`PASS ${edition}: tree flick, dog nod, glovebox reveal and visor fold; UI controls and 3D raycasts`);
    await page.evaluate(()=>{window.jevRoads.game.ride.sympathie=50;});
    for (const item of ['meter','newspaper','vents','mirror']) {
      await page.evaluate(item=>window.jevRoads.game.view.touchCabin(item,true),item);
      await new Promise(r=>setTimeout(r,500));
      await clickObject(item);
      await page.waitForSelector('.choice');
      assert.equal(await page.$$eval('.choice-lines button',els=>els.length),3);
      assert.equal(await page.evaluate(()=>window.jevRoads.game.ride.view().offer.topic),item);
      if (item==='meter') {
        await new Promise(r=>setTimeout(r,600));
        await page.screenshot({path:`shots-out/cabin/${edition}-meter-questions.png`});
        const before=await page.evaluate(()=>window.jevRoads.game.ride.sympathie);
        const number=await page.evaluate(()=>window.jevRoads.game.ride.view().offer.lines.findIndex(l=>l.kind==='provocative')+1);
        const sent = page.waitForRequest(req=>new URL(req.url()).pathname==='/api/driver/line' && JSON.parse(req.postData()).passenger_says?.includes('rig the meter'),{timeout:20000});
        await page.keyboard.press(String(number));
        await page.waitForSelector('.choice',{hidden:true});
        const after=await page.evaluate(()=>({points:window.jevRoads.game.ride.sympathie,verdict:window.jevRoads.game.ride.view().verdict}));
        assert.ok(Math.abs(before-after.points-8)<.5); assert.equal(after.verdict.points,-8);
        await sent;
      } else {
        const before=await page.evaluate(()=>window.jevRoads.game.ride.sympathie);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.choice',{hidden:true});
        assert.ok(Math.abs(before-await page.evaluate(()=>window.jevRoads.game.ride.sympathie))<.5);
      }
    }
    console.log(`PASS ${edition}: four physical topics, three choices each, meter provocation -8, Escape costs nothing`);
  }
  await page.setViewport({width:390,height:844});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.focus('.cabin-objects summary');
  await page.keyboard.press('Space');
  assert.ok(await page.$eval('.cabin-objects',e=>e.open));
  assert.ok(await page.$eval('.cabin-objects-menu',e=>{const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<innerHeight;}));
  await page.screenshot({path:'shots-out/cabin/mobile-controls.png'});
  await page.focus('[data-cabin="glovebox"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.jevRoads.game.ride.view().cabin.gloveboxOpen);
  assert.equal(await page.$eval('.cabin-objects',e=>e.open),false);
  assert.ok(await page.$eval('.cabin-objects summary',e=>e===document.activeElement));
  await page.waitForFunction(()=>window.jevRoads.game.view.cockpit.gloveAngle>1.2);
  await page.screenshot({path:'shots-out/cabin/mobile-glovebox.png'});
  await press('meter');
  await page.waitForSelector('.choice');
  await page.screenshot({path:'shots-out/cabin/mobile-meter-questions.png'});
  assert.ok(await page.$$eval('.choice-lines button',els=>els.every(e=>{const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})), 'All three mobile answers fit inside the viewport');
  await page.click('.choice-dismiss');
  assert.deepEqual(errors,[]);
  console.log('PASS mobile layout, keyboard menu and controls, no browser errors');
} catch (error) {
  console.error('Browser state', await page?.evaluate(()=>({text:document.body.innerText.slice(-2200),status:window.cabinTestStore?.get().status,phase:window.jevRoads?.game.ride.phase})).catch(()=>null), errors);
  await page?.screenshot({path:'shots-out/cabin/failure.png'}).catch(()=>{});
  throw error;
} finally { await browser.close(); }
