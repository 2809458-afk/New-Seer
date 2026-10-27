/* schema1 存档测试：node test/save-store.test.js */
global.self = global;
require('../js/save-store.js');
const S = global.SeerSave;

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}

function sample(teamFirst, suit) {
  return { schema: 1, team: [teamFirst, 3986, 3550, 0, 0, 0, 0, 0, 0, 0, 0, 0], builds: { 5000: { level: 100, nature: -1, ev: {} } }, suit: suit || 0 };
}

console.log('— 首次运行 / 往返 —');
{
  const st = S.memStorage();
  const store = S.createStore(st);
  ok(store.load() === null, '空存储返回 null（首次运行）');
  ok(store.isReadOnly() === false, '空存储不是只读');
  const r = store.save(sample(5000, 3));
  ok(r.ok === true, '首次保存成功：' + r.message);
  const back = store.load();
  ok(back && back.team[0] === 5000 && back.suit === 3, '读回队伍与套装');
  ok(st.getItem(store.keys.backup) === null, '首次保存不产生备份');
}

console.log('— 第二次保存生成 .bak，且备份是上一版 —');
{
  const st = S.memStorage();
  const store = S.createStore(st);
  store.save(sample(5000, 3));
  store.save(sample(5000, 7));
  const bak = JSON.parse(st.getItem(store.keys.backup));
  ok(bak.suit === 3, '备份保留上一次的套装值（3）');
  ok(store.load().suit === 7, '主存档是新的（7）');
}

console.log('— 主存档损坏 → 回退 .bak —');
{
  const st = S.memStorage();
  const store = S.createStore(st);
  store.save(sample(5000, 3));
  store.save(sample(5000, 7));
  st.setItem(store.keys.main, '{坏掉的 JSON');
  const back = store.load();
  ok(back && back.suit === 3, '从备份恢复（套装 3）');
  ok(/备份/.test(store.messageOf()), '提示来自备份：' + store.messageOf());
  ok(store.isReadOnly() === false, '回退后仍可保存');
}

console.log('— 未知 schema：只读且绝不覆盖 —');
{
  const st = S.memStorage();
  const store = S.createStore(st);
  const future = JSON.stringify({ schema: 2, team: [], builds: {} });
  st.setItem(store.keys.main, future);
  const loaded = store.load();
  ok(loaded === null, '未知版本不加载');
  ok(store.isReadOnly() === true, '进入只读');
  const r = store.save(sample(5000, 1));
  ok(r.ok === false, '拒绝保存：' + r.message);
  ok(st.getItem(store.keys.main) === future, '原文件保持原样（未被覆盖）');
}

console.log('— 主存档与备份都损坏：只读且保留原文件 —');
{
  const st = S.memStorage();
  const store = S.createStore(st);
  st.setItem(store.keys.main, 'not json');
  st.setItem(store.keys.backup, '{"schema":1}');
  ok(store.load() === null, '两者都不可用时返回 null');
  ok(store.isReadOnly() === true, '进入只读');
  ok(st.getItem(store.keys.main) === 'not json', '原文件保留');
}

console.log('— 导出 / 导入 —');
{
  const st = S.memStorage();
  const store = S.createStore(st);
  store.save(sample(5000, 5));
  const text = store.exportText();
  ok(/schema/.test(text) && /"suit": 5/.test(text), '导出为可读 JSON');
  const good = store.importText(text);
  ok(good.ok && good.data.suit === 5, '导入回读套装 5');
  ok(store.importText('{"schema":3,"team":[],"builds":{}}').ok === false, '导入未知版本被拒');
  ok(store.importText('{"schema":1}').ok === false, '导入缺字段被拒');
  ok(store.importText('不是 JSON').ok === false, '导入坏 JSON 被拒');
}

if (fails) { console.error('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
