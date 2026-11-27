// Real Chrome/Puppeteer QA. All new files stay in token-radar; existing browser is in scratch-tr3.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { economicCase } from '../lib/v3.ts';
const root = fileURLToPath(new URL('../', import.meta.url)), scratch = resolve(root, '../scratch-tr3');
const { default: puppeteer } = await import(pathToFileURL(join(scratch, 'node_modules/puppeteer/lib/puppeteer/puppeteer.js')).href);
const out = resolve(root, process.argv[2] || 'v3-preview2'), probe = process.argv.includes('--probe');
const evidenceDir = join(root, 'v3-evidence'); mkdirSync(evidenceDir, { recursive: true });
const board = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8')).rows;
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const started = new Date().toISOString(), errors = [], network = [], captures = [];
const executable = join(scratch, 'browser-cache/chrome/linux-158.0.8127.88/chrome-linux64/chrome');
const browser = await puppeteer.launch({ executablePath: executable, headless: true, pipe: true,
  userDataDir: join(root, 'v3-browser-profile'), args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 }); await page.setOfflineMode(true);
  page.on('pageerror', e => errors.push(String(e))); await page.setRequestInterception(true);
  page.on('request', r => { if (/^https?:/.test(r.url())) { network.push(r.url()); r.abort(); } else r.continue(); });
  const url = pathToFileURL(join(out, 'dashboard/index.html')).href;
  async function go(hash = '') { await page.goto(url + hash, { waitUntil: 'load' }); await page.waitForFunction(() => window.RADAR_INTEGRITY?.checksum === true); }
  async function screen(name) {
    await page.evaluate(() => document.fonts.ready);
    const path = probe ? join(evidenceDir, 'probe-' + name) : join(root, 'screenshots', name);
    await page.screenshot({ path, type: 'png', fullPage: false });
    const b = readFileSync(path); const record = { name, bytes: b.length, width: b.readUInt32BE(16), height: b.readUInt32BE(20), sha256: sha(path) };
    assert(b.length >= 60000 && b.length <= 512000); captures.push(record);
  }
  await go(); await page.waitForSelector('#radar-table tbody tr');
  const boardState = await page.evaluate(() => ({ top: document.querySelector('#radar-table tbody tr')?.dataset.slug,
    columns: document.querySelectorAll('#radar-table th').length, kpis: document.querySelectorAll('.kpis>.kpi').length,
    visibleRows: [...document.querySelectorAll('#radar-table tbody tr')].filter(r => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }).length,
    tableTop: document.querySelector('#radar-table').getBoundingClientRect().top, scrollWidth: document.documentElement.scrollWidth,
    viewport: [innerWidth, innerHeight], integrity: window.RADAR_INTEGRITY,
    presetCounts: [...document.querySelectorAll('.preset')].map(n => n.textContent), selected: document.querySelector('.preset.selected')?.dataset.preset,
    evidenceTables: ['value-ablation','odds-ablation','range-honesty'].map(id => document.querySelectorAll('#' + id + ' tbody tr').length) }));
  assert.equal(boardState.top, board[0].slug); assert.equal(boardState.selected, 'Mid'); assert.equal(boardState.columns, 11); assert.equal(boardState.kpis, 6);
  await screen('1-board.png'); await page.click('#radar-table tbody tr:first-child'); await page.waitForSelector('#farm-plan');
  const detailState = await page.evaluate(() => ({ name: document.querySelector('.detail-name').textContent, planSteps: document.querySelectorAll('#farm-plan li').length,
    peers: document.querySelectorAll('#nearest-peers tbody tr').length, decomposition: document.querySelectorAll('#decomposition tbody tr').length,
    visibleMatrixCells: [...document.querySelectorAll('#scenario-matrix td')].filter(c => { const b = c.getBoundingClientRect(); return b.top >= 0 && b.bottom <= 900; }).length,
    lastPlanBottom: document.querySelector('#farm-plan li:last-child').getBoundingClientRect().bottom,
    detailBottom: document.querySelector('.detail-footer').getBoundingClientRect().bottom, scrollWidth: document.documentElement.scrollWidth }));
  assert.equal(detailState.name, board[0].name); await screen('2-detail.png');
  let detailQA = {}, controlsQA = {}, exportsQA = {}, scenarioQA = {};
  if (!probe) {
    const expected = board.map(r => ({ slug: r.slug, scenarios: [[10000,.07,12],[50000,.15,12],[50000,.25,12],[25000,.105,26]].map(([d,s,w]) => economicCase(r,d,s,w)),
      matrix: [.07,.15,.25].flatMap(s => [1000,10000,50000,100000].map(d => economicCase(r,d,s,12))) }));
    const actual = await page.evaluate(() => window.RADAR.rows.map(r => ({ slug: r.slug, scenarios: [[10000,.07,12],[50000,.15,12],[50000,.25,12],[25000,.105,26]].map(([d,s,w]) => window.RADAR_SCENARIO(r,d,s,w)) })));
    for (let i = 0; i < actual.length; i++) for (let j = 0; j < 4; j++) {
      for (const k of Object.keys(expected[i].scenarios[j])) { const a = actual[i].scenarios[j][k], b = expected[i].scenarios[j][k];
        if (typeof b === 'number') assert(Math.abs(a - b) < 1e-7, `${expected[i].slug}:${j}:${k}`); else assert.equal(a,b); }
    }
    scenarioQA = { rows: actual.length, scenarios: 4, comparisons: actual.length * 4,
      grid: [[10000,.07],[50000,.15],[50000,.25]].map(([deposit, share]) => ({ deposit, share, counts: Object.fromEntries(['FARM','MARGINAL','SKIP'].map(k => [k,board.filter(r => economicCase(r,deposit,share,12).verdict === k).length])) })) };
    detailQA = await page.evaluate(expected => {
      const failures = []; let cells = 0;
      for (const [i,r] of window.RADAR.rows.entries()) {
        location.hash = '#p=' + encodeURIComponent(r.slug); dispatchEvent(new Event('hashchange'));
        const lis = [...document.querySelectorAll('#farm-plan li')]; if (lis.length !== 6) failures.push(r.slug + ':steps');
        lis.forEach((li,j) => { if (!li.querySelector('.badge') || li.querySelectorAll('.chip').length !== 2) failures.push(r.slug + ':chips');
          const wanted = r.farm_plan.steps[j].text.replaceAll('$10,000','$50,000'); if (li.querySelector('p').textContent !== wanted) failures.push(r.slug + ':plan text'); });
        const ds = [...document.querySelectorAll('#decomposition tbody tr')]; if (ds.length !== 7) failures.push(r.slug + ':decomposition');
        const rows = [...document.querySelectorAll('#scenario-matrix td')]; if (rows.length !== 12) failures.push(r.slug + ':matrix count');
        rows.forEach((td,j) => { if (Math.abs(Number(td.dataset.net) - expected[i].matrix[j].net_usd) > 1e-7 || td.dataset.verdict !== expected[i].matrix[j].verdict) failures.push(r.slug + ':matrix'); cells++; });
      }
      return { details: window.RADAR.rows.length, cells, failures };
    }, expected); assert.deepEqual(detailQA.failures, []);
    await go();
    for (const name of ['Conservative','Aggressive','Mid']) {
      await page.click(`[data-preset="${name}"]`); const p = {Conservative:[10000,.07],Mid:[50000,.15],Aggressive:[50000,.25]}[name];
      const actualRows = await page.$$eval('#radar-table tr[data-slug]', nodes => nodes.map(n=>({slug:n.dataset.slug,verdict:n.children[9].textContent,net:Number(n.children[10].dataset.net)})));
      for (const a of actualRows) { const s = economicCase(board.find(r=>r.slug===a.slug), ...p, 12); assert.equal(a.verdict,s.verdict); assert(Math.abs(a.net-s.net_usd)<1e-7); }
    }
    await page.select('#deposit','25000');
    await page.$eval('#share',n=>{n.value='.105';n.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.$eval('#weeks',n=>{n.value='26';n.dispatchEvent(new Event('input',{bubbles:true}));});
    const custom = await page.$$eval('#radar-table tr[data-slug]', nodes => nodes.map(n=>({slug:n.dataset.slug,net:Number(n.children[10].dataset.net)})));
    for(const a of custom)assert(Math.abs(a.net-economicCase(board.find(r=>r.slug===a.slug),25000,.105,26).net_usd)<1e-7);
    await page.type('#q','no-such-protocol-xyz'); assert(await page.$('.empty')); await page.click('.reset');
    await page.select('#category',board[0].category || 'Other'); assert.equal(await page.$$eval('#radar-table tbody tr',n=>n.length), board.filter(r=>r.category===board[0].category).length);
    await page.click('.reset'); await page.click('#radar-table th:nth-child(3) button'); assert.equal(await page.$eval('#radar-table tbody tr',n=>n.dataset.slug),board.slice().sort((a,b)=>b.tvl_usd-a.tvl_usd)[0].slug);
    await page.click('[data-view="priced"]'); const pricedCount = await page.$$eval('#benchmark-table tbody tr',n=>n.length); assert.equal(pricedCount,119);
    controlsQA = { customRows: custom.length, slidersLive: true, emptySearch: true, category: true, sort: true, pricedCount };
    await go();
    const downloadDir = join(evidenceDir,'probe-downloads-'+Date.now()); mkdirSync(downloadDir);
    const client = await browser.target().createCDPSession(); await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir,eventsEnabled:true});
    for(const [selector,name]of [['#export-csv','radar-v3.csv'],['#export-json','radar-v3.json'],['#export-evidence','v3-evidence.json']]){
      let timer; const event = new Promise((resolve,reject)=>{const f=e=>{if(e.state==='completed'){clearTimeout(timer);client.off('Browser.downloadProgress',f);resolve();}};client.on('Browser.downloadProgress',f);timer=setTimeout(()=>reject(new Error('download timeout '+name)),10000);});
      await page.click(selector); await event;
      const b = readFileSync(join(downloadDir,name)); assert(b.length>100); exportsQA[name]={bytes:b.length,sha256:sha(join(downloadDir,name))};
    }
    const exported = JSON.parse(readFileSync(join(downloadDir,'radar-v3.json'),'utf8')); assert.equal(exported.scenario.name,'Mid'); assert.equal(exported.rows.length,board.length);
    for(const r of exported.rows)assert(Math.abs(r.active_economics.net_usd-economicCase(r,50000,.15,12).net_usd)<1e-7);
  }
  await go('#verdict=FARM'); const filterState = await page.evaluate(() => ({rows:[...document.querySelectorAll('#radar-table tbody tr')].map(r=>r.dataset.slug),summary:document.getElementById('filter-summary').textContent,hash:location.hash,selected:document.querySelector('.preset.selected').dataset.preset}));
  assert.deepEqual(filterState.rows,board.filter(r=>economicCase(r,50000,.15,12).verdict==='FARM').map(r=>r.slug)); await screen('3-filtered.png');
  assert.deepEqual(errors,[]); assert.deepEqual(network,[]);
  const evidence = { started, completed:new Date().toISOString(), browser:await browser.version(), executable, rendered_output:out,
    board_sha256:sha(join(out,'board.json')),data_sha256:sha(join(out,'data.js')),dashboard_sources:Object.fromEntries(readdirSync(join(out,'dashboard')).map(f=>[f,sha(join(out,'dashboard',f))])),
    boardState,detailState,filterState,scenarioQA,detailQA,controlsQA,exportsQA,errors,network,captures,
    layout_pass:boardState.visibleRows>=10&&detailState.visibleMatrixCells===12&&detailState.lastPlanBottom<=900&&boardState.scrollWidth<=1280&&detailState.scrollWidth<=1280 };
  writeFileSync(join(evidenceDir,probe?'probe.json':'capture-v3.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
  if(!probe)assert(evidence.layout_pass,'1280x900 layout must pass');
} catch(error) { console.error(JSON.stringify({errors,network})); throw error; }
finally { await browser.close(); }
