# New-Seer

赛尔号同人战斗项目，当前主线为 `app/`：React DOM Overlay + Phaser + TypeScript。core负责规则、PP、换人和胜负，UI与游戏表现只消费状态。

已接入4941只精灵的基础资料、27354个技能效果表、12格队伍（前6出战）、背包搜索分页与实际战斗。2026-10-27合入圣甲·盖亚、大威势明王、大轮明王、混元天尊、启灵元神及星光·鲁斯王实现。

## 运行

```powershell
cd app
npm ci
npm test
npm run test:regression
npm run build
npm run preview -- --host 127.0.0.1 --port 4186 --strictPort
```

开发模式运行 `npm run dev -- --host 127.0.0.1`，访问 `http://127.0.0.1:5183/`。构建预览为 `http://127.0.0.1:4186/`。

## 外置资源

本仓库包含运行数据、版本清单、技能预编译表及回归所需的少量动画夹具。完整约860MB立绘不随源码上传，需将已有资源包放在 `web/assets/pets/<id>.png`。缺少原图时背包使用占位，战斗规则仍可运行。

保留已提交的manifest可先运行检查和构建。完整立绘到位，或数据/判定核增量变更后，再运行 `npm run assets` 统一生成效果词表、立绘manifest和技能表。不要在未放入完整资源时重新生成立绘清单。

Chrome可用时，启动预览服务后运行 `npm run test:smoke -- --pets --soak`，覆盖六只精灵实战与200场同种子长跑；完整冒烟需要立绘资源。

## 验证与导航

- 53套回归、1664断言；15组app检查；27354技能完整效果数组与11894组固定队伍战斗对拍。
- `web/js/battle.js`为冻结参照；app构建时严格应用 `app/src/core/expansions/pets-20261027.patch`，保留既有规则修正。
- 接手先读[AGENTS.md](AGENTS.md)、[当前状态](docs/WORK_STATE.md)，迁移任务再读[迁移入口](docs/MIGRATION_MAP.md)。
- [运行与部署](docs/APP_RUNTIME.md)、[本次精灵合并](docs/PET_EXPANSION_20261027.md)、[上传清单](docs/GITHUB_UPLOAD_LIST.md)。
