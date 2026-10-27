import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { oracleEsbuildPlugin } from '../config/oracle.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(app, '../docs/maintenance');
mkdirSync(out, { recursive: true });
const profile = resolve(app, '.tmp', `smoke-${Date.now()}`);
mkdirSync(profile, { recursive: true });
const chrome = process.env.SEER_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.env.SEER_BASE || 'http://127.0.0.1:4186';
const prefix = base.includes(':5183') ? 'app-dev' : 'app';
writeFileSync(resolve(out, prefix + '-smoke.json'), JSON.stringify({ pass: false, status: 'running', base }));
if (process.argv.includes('--soak')) writeFileSync(resolve(out, 'app-soak.json'), JSON.stringify({ pass: false, status: 'running' }));
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check',
  '--enable-precise-memory-info', '--disable-background-timer-throttling',
  '--js-flags=--expose-gc',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stderr = '';
browser.stderr.on('data', (data) => { stderr += data; });
let ws;
try {
  const portFile = resolve(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  while (!existsSync(portFile) && Date.now() < deadline && browser.exitCode === null) await sleep(100);
  assert(existsSync(portFile), 'Chrome failed to start: ' + stderr.slice(-1500));
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const pending = new Map();
  const errors = [];
  let nextId = 0;
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(String(data));
    if (msg.id) { const item = pending.get(msg.id); if (item) { clearTimeout(item.timer); pending.delete(msg.id); msg.error ? item.reject(new Error(JSON.stringify(msg.error))) : item.resolve(msg.result); } }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text + ': ' + JSON.stringify(msg.params.exceptionDetails.exception));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(JSON.stringify(msg.params.args));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, objectGroup: 'seer-smoke' });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const until = async (expression) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(150); }
    throw new Error('UI timeout: ' + expression + '\n' + await evaluate('document.body.innerText'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: base });
  await until('document.querySelectorAll(".pet-card").length === 60 && !!document.querySelector("canvas")');
  await until('Array.from(document.querySelectorAll(".pet-art")).some(i => i.naturalWidth > 0)');
  const imagesReady = 'document.querySelectorAll(".pet-card img").length === 60 && Array.from(document.querySelectorAll(".pet-card img")).every(i => i.naturalWidth > 0)';
  await until(imagesReady);
  await evaluate('document.querySelectorAll(".bag-search button")[1].click()');
  await until('document.querySelector(".pet-no").textContent === "#61"');
  await until(imagesReady);
  await evaluate('document.querySelectorAll(".bag-search button")[0].click()');
  await until('document.querySelector(".pet-no").textContent === "#1"');
  await evaluate(`(() => {
    const input = document.querySelector('.bag-search input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '3011');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await until('document.querySelectorAll(".pet-card").length === 1 && document.querySelector(".pet-art.missing").textContent === "暂无立绘"');
  await evaluate(`(() => {
    const input = document.querySelector('.bag-search input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await until('document.querySelectorAll(".pet-card").length === 60');
  await until(imagesReady);
  await evaluate('document.querySelectorAll(".pet-card")[0].click()');
  await until('document.querySelector(".side.me .name").textContent === "布布种子"');
  await evaluate('document.querySelectorAll(".pet-card")[1].click()');
  assert.match(await evaluate('document.querySelector(".bag-head").innerText'), /已选 2 \/ 12/);
  const bag = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(out, prefix + '-bag.png'), Buffer.from(bag.data, 'base64'));
  await evaluate('document.querySelectorAll(".actions button")[1].click()');
  await until('document.querySelectorAll(".skills button").length > 1');
  const before = await evaluate('document.querySelector(".skills button").textContent');
  await evaluate('document.querySelector(".skills button").click()');
  assert.notEqual(await evaluate('document.querySelector(".skills button").textContent'), before, 'PP did not change');
  await until('document.querySelector(".turn").textContent === "第 1 回合"');
  let actions = 1;
  while (actions < 400 && !(await evaluate('document.querySelector(".battle-panel p").textContent.includes("战斗结束")'))) {
    await evaluate(`(() => {
      const forced = document.querySelector('.battle-panel p').textContent.includes('下一只');
      const options = Array.from(document.querySelectorAll(forced ? '.bench button' : '.skills button')).filter(b => !b.disabled);
      const attack = options.find(b => !b.textContent.includes('待机')) || options[0];
      if (attack) attack.click();
    })()`);
    await sleep(20);
    actions++;
  }
  const result = await evaluate('document.querySelector(".battle-panel p").textContent');
  assert.match(result, /战斗结束/);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(out, prefix + '-battle.png'), Buffer.from(shot.data, 'base64'));
  const petResults = [];
  if (process.argv.includes('--pets')) {
    const rawPets = JSON.parse(readFileSync(resolve(app, '../data/pets.json'), 'utf8')).items;
    const skillMap = new Map(JSON.parse(readFileSync(resolve(app, '../data/skills.json'), 'utf8')).items.map((s) => [s.id, s]));
    for (const id of [3056, 3237, 3576, 3788, 3986, 4648]) {
      const pet = rawPets.find((p) => p.id === id);
      const chosen = [...new Set([...(pet.skills || []).map((s) => s.id), ...(pet.fifth || [])])].map((id) => skillMap.get(id)).filter(Boolean).slice(-5);
      const order = chosen.map((s, index) => ({ index, power: s.power || 0 })).sort((a, b) => b.power - a.power).map((s) => s.index);
      await evaluate('document.querySelectorAll(".actions button")[0].click()');
      await until('!!document.querySelector(".bag-search input")');
      await evaluate(`(() => {
        document.querySelectorAll('.team-slots button').forEach(b => { if (!b.disabled) b.click(); });
        const input = document.querySelector('.bag-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${id}');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await until(`document.querySelectorAll('.pet-card').length === 1 && document.querySelector('.pet-no').textContent === '#${id}'`);
      await evaluate('document.querySelector(".pet-card").click()');
      await until(`document.querySelector('.side.me .name').textContent === ${JSON.stringify(pet.name)}`);
      await evaluate('document.querySelectorAll(".actions button")[1].click()');
      await until('!!document.querySelector(".battle-panel p")');
      let count = 0;
      while (count < 120 && !(await evaluate('document.querySelector(".battle-panel p").textContent.includes("战斗结束")'))) {
        await evaluate(`(() => {
          const buttons = document.querySelectorAll('.skills button');
          const order = ${JSON.stringify(order)};
          const index = order.find(i => buttons[i] && !buttons[i].disabled);
          if (index != null) buttons[index].click();
          else Array.from(buttons).find(b => !b.disabled)?.click();
        })()`);
        await sleep(20); count++;
      }
      const result = await evaluate('document.querySelector(".battle-panel p").textContent');
      assert.match(result, /战斗结束/, pet.name);
      petResults.push({ id, name: pet.name, actions: count, result });
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(out, 'app-pet-expansion.png'), Buffer.from(shot.data, 'base64'));
    writeFileSync(resolve(out, 'app-pet-expansion-smoke.json'), JSON.stringify({ pass: true, pets: petResults, errors }, null, 2));
  }
  assert.deepEqual(errors, [], 'browser errors');
  const report = { pass: true, base, canvas: await evaluate('!!document.querySelector("canvas")'), actions, result, errors };
  if (petResults.length) report.pets = petResults;
  if (process.argv.includes('--soak')) {
    const { build } = await import('esbuild');
    const bundle = await build({ entryPoints: [resolve(app, 'test/soak.ts')], bundle: true, format: 'iife', platform: 'browser', write: false, plugins: [oracleEsbuildPlugin()] });
    await evaluate(bundle.outputFiles[0].text);
    await evaluate('(async () => { globalThis.seerRunSoak = await globalThis.seerSoakReady; })()');
    await evaluate('for (let i = 0; i < 200; i++) seerRunSoak(); undefined');
    // 预编译并复用脚本；每批异步栈退栈后由 CDP 完整 GC，再读取 heap。
    const compile = async (expression, sourceURL) => {
      const result = await send('Runtime.evaluate', { expression: expression + '\n//# sourceURL=' + sourceURL, objectGroup: 'seer-soak-functions' });
      assert(result.result.objectId, JSON.stringify(result.exceptionDetails)); return result.result.objectId;
    };
    const batchScript = await compile(`(async function () {
      let total = 0, count = 0;
      for (let i = 0; i < 20; i++) { const durations = seerRunSoak(); for (const ms of durations) { total += ms; count++; } }
      let first = 0, last = 0;
      for (let i = 0; i < 12; i++) { const now = await new Promise(requestAnimationFrame); if (!i) first = now; last = now; }
      return { settleMs:total/count, fps:11000/(last-first) };
    })`, 'seer-soak-batch.js');
    const heapScript = await compile('(function () { return performance.memory.usedJSHeapSize; })', 'seer-soak-heap.js');
    const run = async (objectId) => {
      const r = await send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function () { return this(); }', returnByValue: true, awaitPromise: true, objectGroup: 'seer-soak' });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      await send('Runtime.releaseObjectGroup', { objectGroup: 'seer-soak' });
      return r.result.value;
    };
    const samples = [];
    for (let batch = -10; batch < 10; batch++) {
      const timing = await run(batchScript);
      await send('HeapProfiler.collectGarbage');
      const heap = await run(heapScript);
      if (batch >= 0) samples.push({ battles:(batch+1)*20, usedJSHeapSize:heap, ...timing });
    }
    const first = samples.slice(0, 3), last = samples.slice(-3);
    const avg = (rows, key) => rows.reduce((n, r) => n + r[key], 0) / rows.length;
    const heapGrowth = avg(last, 'usedJSHeapSize') / avg(first, 'usedJSHeapSize') - 1;
    writeFileSync(resolve(out, 'app-soak.json'), JSON.stringify({ pass: false, status: 'checking', samples }, null, 2));
    console.log('200 seeded battles: ' + JSON.stringify(samples));
    assert(heapGrowth < .1, 'heap growth exceeds 10%');
    assert(!samples.every((s, i) => i === 0 || s.usedJSHeapSize > samples[i - 1].usedJSHeapSize), 'heap is monotonically increasing');
    assert(avg(last, 'settleMs') < avg(first, 'settleMs') * 2 + .2, 'settlement time regressed');
    assert(avg(last, 'fps') > avg(first, 'fps') * .8, 'FPS regressed');
    const soak = { pass: true, battles: 200, warmup: 400, seed: 7919, deterministic: true, heapGrowth, samples };
    writeFileSync(resolve(out, 'app-soak.json'), JSON.stringify(soak, null, 2));
    writeFileSync(resolve(out, 'app-soak.csv'), 'battles,usedJSHeapSize,settleMs,fps\n' + samples.map((s) => `${s.battles},${s.usedJSHeapSize},${s.settleMs},${s.fps}`).join('\n'));
    report.soak = { battles: 200, heapGrowth };
  }
  writeFileSync(resolve(out, prefix + '-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  writeFileSync(resolve(out, prefix + '-smoke.json'), JSON.stringify({ pass: false, base, error: String(error) }, null, 2));
  if (process.argv.includes('--soak')) {
    const previous = JSON.parse(readFileSync(resolve(out, 'app-soak.json'), 'utf8'));
    writeFileSync(resolve(out, 'app-soak.json'), JSON.stringify({ ...previous, pass: false, error: String(error) }, null, 2));
  }
  throw error;
} finally {
  ws?.close(); browser.kill();
  writeFileSync(resolve(out, prefix + '-chrome.log'), stderr);
  if (browser.exitCode === null) await new Promise((done) => { browser.once('exit', done); setTimeout(done, 1000); });
  if (!profile.startsWith(resolve(app, '.tmp') + sep)) throw new Error('unsafe Chrome profile cleanup path');
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
  catch { console.warn('测试配置目录仍被 Chrome 占用：' + profile); }
}
