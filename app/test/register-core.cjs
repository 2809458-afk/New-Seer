// 给原样保留的 web/test 接入新 core，子进程 golden 同样继承 NODE_OPTIONS。
const Module = require('node:module');
const path = require('node:path');
const target = path.resolve(__dirname, '../../web/js/battle.js');
const core = require('../.tmp/core.cjs');
const load = Module._load;
Module._load = function (request, parent, isMain) {
  const resolved = Module._resolveFilename(request, parent, isMain);
  if (resolved === target) return core.default;
  return load.apply(this, arguments);
};
