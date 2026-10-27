/* schema1 文件后端（Tauri）：与 localStorage 后端同一套语义，只是 IO 异步 */
'use strict';
global.self = global;
require('../js/save-store.js');
const S = global.SeerSave;

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}
const DATA = { schema: 1, team: [{ petId: 1, skills: [] }], builds: {}, suit: null, loadouts: [] };

(async function () {
  const io = S.memFileIo();
  const store = S.createFileStore(io, { main: 'g/save.json', backup: 'g/save.json.bak', temp: 'g/save.json.tmp' });

  // 1) 首次运行
  ok((await store.loadAsync()) === null, '首次运行没有存档');
  ok(store.load() === null, '同步 load() 在未加载时返回 null');

  // 2) 保存 → 回读
  let r = await store.saveAsync(DATA);
  ok(r.ok, '第一次保存成功');
  ok(io.files['g/save.json'] != null, '主存档文件已写入');
  ok(io.files['g/save.json.tmp'] == null, '临时文件已清理');
  ok(JSON.parse(io.files['g/save.json']).team.length === 1, '主存档内容正确');

  // 3) 再存一份 → 上一份转 .bak
  r = await store.saveAsync(Object.assign({}, DATA, { team: [{ petId: 2, skills: [] }] }));
  ok(r.ok && io.files['g/save.json.bak'] != null, '第二次保存把上一份转成 .bak');
  ok(JSON.parse(io.files['g/save.json.bak']).team[0].petId === 1, '.bak 保存的是上一份内容');
  ok(JSON.parse(io.files['g/save.json']).team[0].petId === 2, '主存档是新的内容');

  // 4) 主存档损坏 → 回退 .bak
  io.files['g/save.json'] = '{ broken';
  const recovered = await store.loadAsync();
  ok(recovered && recovered.team[0].petId === 1, '主存档损坏时从 .bak 恢复');
  ok(/备份恢复/.test(store.messageOf()), '恢复时给出提示：' + store.messageOf());

  // 5) 未知版本 → 只读，不覆盖
  io.files['g/save.json'] = JSON.stringify({ schema: 2, team: [], builds: {} });
  const unknown = await store.loadAsync();
  ok(unknown === null && store.isReadOnly(), 'schema 2 存档按只读处理');
  const guard = await store.saveAsync(DATA);
  ok(!guard.ok && JSON.parse(io.files['g/save.json']).schema === 2, '只读时不覆盖更高版本存档');

  // 6) clear 清空三个文件
  await store.clear();
  ok(io.files['g/save.json'] == null && io.files['g/save.json.bak'] == null, 'clear 删除主存档与备份');

  // 7) 形状校验
  const bad = await store.saveAsync({ schema: 1, team: 'x', builds: {} });
  ok(!bad.ok, '非法形状拒绝写入');

  // 8) 浏览器后端仍然可用（双后端共存）
  const mem = S.memStorage();
  const local = S.createStore(mem);
  local.save({ schema: 1, team: [], builds: {} });
  ok(!!local.load(), 'localStorage 后端不受影响');
  ok(typeof S.inTauri === 'function' && S.inTauri() === false, '非 Tauri 环境下 inTauri() 为 false');

  if (fails) { console.error('失败 ' + fails + ' 项'); process.exit(1); }
  console.log('全部通过');
})();
