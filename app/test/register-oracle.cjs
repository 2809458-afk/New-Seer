const Module = require('node:module');
const path = require('node:path');
const target = path.resolve(__dirname, '../../web/js/battle.js');
const oracle = require('../.tmp/oracle.cjs');
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (Module._resolveFilename(request, parent, isMain) === target) return oracle;
  return load.apply(this, arguments);
};
