/* 离线数据 → 引擎/API 口径的形状归一
 *
 * data/types.json 存的是 {relations: [{target, multiple}]}，而引擎（和 api.seerapi.com）
 * 期待 {relations: [{target_type: {id}, multiple}]}。直接喂原始数据会得到空克制表，
 * 所有伤害按 ×1 结算 —— 曾经导致轨迹对拍完全测不到克制。
 */
'use strict';

function apiTypes(items) {
  return (items || []).map(function (t) {
    return {
      id: t.id,
      name: t.name,
      relations: (t.relations || []).map(function (r) {
        var id = r.target_type && r.target_type.id != null ? r.target_type.id : r.target;
        return { target_type: { id: id }, multiple: r.multiple };
      })
    };
  });
}

module.exports = { apiTypes: apiTypes };
