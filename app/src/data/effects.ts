/* P2：效果类型词汇表（自动生成，勿手改）
 * 生成脚本：node tools/gen-effect-kinds.mjs（来源冻结判定核 + app/src/core/expansions 增量的 kind 字面量）
 * 目的：让数据表 / 规则原语有统一类型，逐步替代硬编码 if/else。
 */

export type EffectKind =
  | 'addLock'
  | 'addStacks'
  | 'allCrit'
  | 'allStatChanceDouble'
  | 'arrowsOnAtk'
  | 'atkHitPercentMaxHp'
  | 'atkStatusElse'
  | 'atkThreshStatus'
  | 'atkUseDealtStack'
  | 'attackBlock'
  | 'attackBlockFirst'
  | 'attackHitStatusTimed'
  | 'attrBlockIfHit'
  | 'attrPunishPP'
  | 'attrTriggerStatus'
  | 'beimingBlade'
  | 'benchAura'
  | 'benchHeal'
  | 'benchHealAll'
  | 'benchQuarterOnClear'
  | 'benchScaleHeal'
  | 'benchStrike'
  | 'blessConsumePp'
  | 'blessGain'
  | 'blessGainOnHit'
  | 'blessKillCost'
  | 'blessTurnEnd'
  | 'blindStack'
  | 'blockCrit'
  | 'blockSwitch'
  | 'blockSwitchBoth'
  | 'bothMaxHpDown'
  | 'buffGoneAttrBlock'
  | 'burnEndBranch'
  | 'capOnStatus'
  | 'chanceDodge'
  | 'chanceImmune'
  | 'chanceImmuneReflect'
  | 'chanceImmuneStatus'
  | 'clear'
  | 'clearBoth'
  | 'clearBothBoth'
  | 'clearBothThenFlat'
  | 'clearFoe'
  | 'clearOrFearDrain'
  | 'clearShield'
  | 'clearShieldFlat'
  | 'cond'
  | 'convertTaken'
  | 'copyAtk'
  | 'copyDef'
  | 'copySkill'
  | 'copyType'
  | 'cosmetic'
  | 'costHalfStats'
  | 'costHpStats'
  | 'counterMul'
  | 'critBonus'
  | 'critBonusTurns'
  | 'critBuff'
  | 'critChance'
  | 'critHealDealt'
  | 'critIfFirst'
  | 'critIfLower'
  | 'critIfPositive'
  | 'critImmune'
  | 'critPercent'
  | 'critRamp'
  | 'critThenSkillBlock'
  | 'critThenStarRage'
  | 'critThisHit'
  | 'cure'
  | 'damageBuff'
  | 'damageCap'
  | 'damageFlat'
  | 'deadAllyPriority'
  | 'dealt'
  | 'dealtMulFoeStatus'
  | 'deathCurse'
  | 'deathFear'
  | 'deathTeamGuard'
  | 'defFixedHeal'
  | 'defStatsPct'
  | 'delayedFlat'
  | 'delayedKill'
  | 'desperate'
  | 'disableFoeBuffs'
  | 'divineTurn'
  | 'dodge'
  | 'dodgePassive'
  | 'dodgeTimes'
  | 'dot'
  | 'doubleStages'
  | 'doubleStagesOnKill'
  | 'dragonAura'
  | 'drain'
  | 'drainFlat'
  | 'drainFlatRamp'
  | 'drainIfStatus'
  | 'drainMax'
  | 'drainOnCrit'
  | 'drainOnFoeAtk'
  | 'drainOnHit'
  | 'drainPct'
  | 'drainRandom'
  | 'drainTimed'
  | 'drainTurns'
  | 'dtzfSoul'
  | 'endClearStatus'
  | 'endDamageIfStatus'
  | 'endDamageLost'
  | 'endDamagePerSpeed'
  | 'endDrainIfLow'
  | 'endHeal'
  | 'endHealByDealt'
  | 'endHealCond'
  | 'endHealIfUp'
  | 'endHealLowPct'
  | 'endInvertFoe'
  | 'endPpRestore'
  | 'endRampFlat'
  | 'endShieldBranch'
  | 'enterBless'
  | 'enterClearLock'
  | 'enterRandomStatus'
  | 'enterShieldImmune'
  | 'entryBuff'
  | 'entryImmuneStatus'
  | 'entryShield'
  | 'entryShieldFlat'
  | 'entrySkillBlock'
  | 'entryStatDown'
  | 'entryStatus'
  | 'evadeIfFirst'
  | 'exec'
  | 'execChance'
  | 'execOnHit'
  | 'exile'
  | 'exiledPpDrain'
  | 'fateHengDef'
  | 'fateJieDef'
  | 'fateOnSwitch'
  | 'fateWheel'
  | 'fenjinOnClear'
  | 'fieldOnEnter'
  | 'firstDeathSurvive'
  | 'firstEntryNullAttack'
  | 'firstHealBlock'
  | 'firstNullify'
  | 'firstNullifyScale'
  | 'firstReviveTurn'
  | 'firstSkillNullify'
  | 'firstSpeedUp'
  | 'firstStatUp'
  | 'fixedPctPersistReduce'
  | 'flat'
  | 'flatByAtk'
  | 'flatByCurHp'
  | 'flatByDealt'
  | 'flatByDef'
  | 'flatByDefStages'
  | 'flatByMaxHp'
  | 'flatByOwnDefs'
  | 'flatByOwnStat'
  | 'flatBySelfLost'
  | 'flatByStatStages'
  | 'flatByStats'
  | 'flatByStats3'
  | 'flatByTargetCurHp'
  | 'flatByTargetCurHpRamp'
  | 'flatByTargetDefPct'
  | 'flatByTargetLost'
  | 'flatByTargetMax'
  | 'flatByTargetMaxHp'
  | 'flatByTargetMaxHpRamp'
  | 'flatDrainSelf'
  | 'flatPerEqualStat'
  | 'flatRandom'
  | 'flatRandomCond'
  | 'flatRandomHeal'
  | 'foeHealEnd'
  | 'foeMiss'
  | 'foeNoStatUp'
  | 'foePercentSelf'
  | 'foePriorityDown'
  | 'foeStatDown'
  | 'foeStatSet'
  | 'foeStatusSealOnAtk'
  | 'foeTypeBranch'
  | 'formSwitch'
  | 'formSystem'
  | 'fullHpGuard'
  | 'genderBranch'
  | 'genderImmune'
  | 'giveStatsAsDebuff'
  | 'guard'
  | 'guardFlat'
  | 'halfHpPrioHeal'
  | 'halfHpRoundLock'
  | 'heal'
  | 'healBlock'
  | 'healBlockPunish'
  | 'healBoth'
  | 'healByLost'
  | 'healByShield'
  | 'healChance'
  | 'healDown'
  | 'healFlat'
  | 'healOnFoeMiss'
  | 'healRandom'
  | 'healRandomCond'
  | 'healStatusFail'
  | 'highHpImmuneAllDown'
  | 'highHpPrioImmune'
  | 'hitStatusFixed'
  | 'hpBonus'
  | 'hpCutRandom'
  | 'hpScaleHao'
  | 'hunyuan'
  | 'ifFoeFirstReduce'
  | 'ifSelfFirstBoost'
  | 'ignoreDefPct'
  | 'ignoreDefPctTurns'
  | 'ignoreDefStack'
  | 'ignoreDefUp'
  | 'ignoreGuards'
  | 'ignoreImmune'
  | 'ignoreShield'
  | 'immuneAbove'
  | 'immuneAndReflect'
  | 'immuneBelow'
  | 'immuneBelowPassive'
  | 'immuneCrit'
  | 'immuneCritReflect'
  | 'immuneFixedPct'
  | 'immuneNextOrHalve'
  | 'immuneReflectStatus'
  | 'immuneStat'
  | 'immuneStatus'
  | 'immuneStatusIds'
  | 'immuneStatusIfNoDefUp'
  | 'invertFoeNegative'
  | 'invertFoeStages'
  | 'invertSelfDowns'
  | 'invertStages'
  | 'invertThenImmune'
  | 'invertToFoe'
  | 'itemFlip'
  | 'junGuard'
  | 'junNoWeakenNext'
  | 'junPunish'
  | 'junWei'
  | 'junYu'
  | 'junYuan'
  | 'junYun'
  | 'junZhen'
  | 'lastClearHeal'
  | 'lastFoeAttackBlock'
  | 'leiEndBoost'
  | 'leiRoundLock'
  | 'leiRoundToOne'
  | 'leiSteal'
  | 'level100Revive'
  | 'lockPpZero'
  | 'lowDamageBenchStrike'
  | 'lowHpExec'
  | 'lowHpExtraReduce'
  | 'lowHpReduceAllDown'
  | 'lowPowerPunish'
  | 'lowTrueDamage'
  | 'maxHpDown'
  | 'maxHpDownPct'
  | 'minDamage'
  | 'mirrorFoeStages'
  | 'mirrorHeal'
  | 'mirrorStat'
  | 'mistikeEntry'
  | 'mistikeReact'
  | 'morphDestroy'
  | 'morphGuard'
  | 'morphSpeed'
  | 'morphUltimate'
  | 'multiHit'
  | 'multiHitChance'
  | 'multiHitLowerHp'
  | 'multiHitShield'
  | 'mustHit'
  | 'mwAtkStatDown'
  | 'mwDeath'
  | 'mwDeathBless'
  | 'mwGuard'
  | 'mwPhaseTransfer'
  | 'nextCrit'
  | 'nextGuard'
  | 'nextGuardByDealt'
  | 'nextPet'
  | 'nextPetMaxHpDown'
  | 'noDamageDrain'
  | 'noDamageHeal'
  | 'noPpCost'
  | 'noWeak'
  | 'nyxEnter'
  | 'nyxField'
  | 'nyxHpBranch'
  | 'onDeathClearFoe'
  | 'onEnterClear'
  | 'onHitClearFoeStats'
  | 'onHitCondStatus'
  | 'onHitCritBuff'
  | 'onHitDamageUp'
  | 'onHitExtraFlat'
  | 'onHitFlatPct'
  | 'onHitHealChance'
  | 'onHitImmune'
  | 'onHitMaxHpDown'
  | 'onHitMultiStatDown'
  | 'onHitPercentHp'
  | 'onHitRandomStatDown'
  | 'onHitReflect'
  | 'onHitReflectPct'
  | 'onHitStatUp'
  | 'onHitStatus'
  | 'onHitStatusTimed'
  | 'onKillAttackBlock'
  | 'onKillHealNext'
  | 'onKillNextPriorityDown'
  | 'onKillPriority'
  | 'onKillSkillBlock'
  | 'onMissHeal'
  | 'oneHit'
  | 'oneHitIfFirst'
  | 'oneHitIfLower'
  | 'oppTo1'
  | 'pendingZhuoxin'
  | 'perTurnDrain'
  | 'perTurnFlatByStats'
  | 'perTurnPpZero'
  | 'perTurnPriorityDown'
  | 'perTurnStatDown'
  | 'perTurnStatDown2'
  | 'perTurnStatUp'
  | 'perTurnSteal'
  | 'perTurnStealStats'
  | 'percentHp'
  | 'permImmuneStatWhenFull'
  | 'power'
  | 'powerByStat'
  | 'powerChance'
  | 'powerChanceRamp'
  | 'powerLowHp'
  | 'powerPerBench'
  | 'powerPerFoeStage'
  | 'powerPerStack'
  | 'powerPerStatUp'
  | 'powerRandom'
  | 'powerRandomRamp'
  | 'pp'
  | 'ppCostMul'
  | 'ppDrain'
  | 'ppDrainFirst'
  | 'ppExtra'
  | 'ppRestoreAll'
  | 'ppRestoreChance'
  | 'ppRestoreSelf'
  | 'ppZero'
  | 'ppZeroOnFoeAtk'
  | 'ppZeroOnHit'
  | 'ppZeroPerMark'
  | 'ppZeroTimes'
  | 'preHitClearFoe'
  | 'prevDamageFlat'
  | 'prevDamageHalfAttack'
  | 'prioPpZero'
  | 'priority'
  | 'priorityAlways'
  | 'priorityBuff'
  | 'priorityChance'
  | 'priorityCond'
  | 'priorityDown'
  | 'priorityDownNoDamage'
  | 'priorityIfFoeSpeed'
  | 'priorityIfHigher'
  | 'priorityIfHpBelow'
  | 'priorityIfLow'
  | 'priorityIfPositive'
  | 'priorityStreak'
  | 'protectStats'
  | 'punishByCategory'
  | 'punishStatusSkill'
  | 'rageCrit'
  | 'rageHigh'
  | 'rageLow'
  | 'ramp'
  | 'rampDamage'
  | 'rampPct'
  | 'randomSelfOrFoe'
  | 'randomSelfOrTarget'
  | 'randomStatDown'
  | 'randomStatUp'
  | 'randomStatus'
  | 'randomUpFoeDown'
  | 'rebirth'
  | 'recoil'
  | 'reflectDamage'
  | 'reflectIfAlive'
  | 'reflectIfHit'
  | 'reflectLethal'
  | 'reflectNext'
  | 'reflectOnHitPct'
  | 'regen'
  | 'regenPerSibling'
  | 'regenRandom'
  | 'regenRatio'
  | 'regenShield'
  | 'restoreStages'
  | 'returnStats'
  | 'reviveChance'
  | 'reviveOnce'
  | 'revivePowerBuff'
  | 'reviveTeammate'
  | 'roundLock'
  | 'sacrificeImmune'
  | 'sacrificeNextPet'
  | 'selfCostDamage'
  | 'selfCostPercent'
  | 'selfCostPriority'
  | 'selfKo'
  | 'selfKoHalfShield'
  | 'selfKoOnMiss'
  | 'shield'
  | 'shieldBreakClear'
  | 'shieldPriority'
  | 'shieldToDamage'
  | 'skillBlock'
  | 'skillBlockChance'
  | 'skillNullNext'
  | 'speed'
  | 'speedToHp'
  | 'stackPassive'
  | 'stacksOnKill'
  | 'stacksOnResult'
  | 'starAtkSum'
  | 'starAura'
  | 'starDial'
  | 'starEntry'
  | 'starGift'
  | 'starImmunity'
  | 'starLowDamage'
  | 'starPhil'
  | 'starPhysDrain'
  | 'starPowerKeep'
  | 'starPunish'
  | 'starRageBonus'
  | 'starRageDouble'
  | 'starRageMode'
  | 'starRageOnNull'
  | 'starSeaMark'
  | 'starSpecialPrio'
  | 'startDamageDouble'
  | 'startStageBranch'
  | 'startTakenMul'
  | 'stat'
  | 'statDownLock'
  | 'status'
  | 'statusGuardTimes'
  | 'statusRamp'
  | 'statusResist'
  | 'statusShorten'
  | 'statusSkillEndHeal'
  | 'statusSkillImmuneNext'
  | 'statusSkillMiss'
  | 'stealPositive'
  | 'stealShield'
  | 'stealStats'
  | 'subFull'
  | 'summonYu'
  | 'summonZhan'
  | 'survive'
  | 'swapHp'
  | 'swapHpPct'
  | 'swapPos'
  | 'swapType'
  | 'switchOutShield'
  | 'taken'
  | 'takenTurns'
  | 'targetDamageDown'
  | 'teFixedUse'
  | 'thorns'
  | 'treatFoeStatAsDown'
  | 'trueDamage'
  | 'twinCorps'
  | 'typeFixedDamage'
  | 'typePower'
  | 'useHeal'
  | 'useHighestStat'
  | 'ward'
  | 'wudaoAdvance'
  | 'wudaoDealt'
  | 'wudaoHeal'
  | 'wudaoOpen'
  | 'wudaoPP'
  | 'wudaoSkillDmg'
  | 'wukongForm'
  | 'wukongFormDetail'
  | 'wukongTurn'
  | 'yuBuff'
  | 'yuMain'
  | 'yuSub'
  | 'yueMain'
  | 'yueSub'
  | 'zhanBuff'
  | 'zhuoxinBuff';

export const EFFECT_KINDS: readonly EffectKind[] = [
  'addLock',
  'addStacks',
  'allCrit',
  'allStatChanceDouble',
  'arrowsOnAtk',
  'atkHitPercentMaxHp',
  'atkStatusElse',
  'atkThreshStatus',
  'atkUseDealtStack',
  'attackBlock',
  'attackBlockFirst',
  'attackHitStatusTimed',
  'attrBlockIfHit',
  'attrPunishPP',
  'attrTriggerStatus',
  'beimingBlade',
  'benchAura',
  'benchHeal',
  'benchHealAll',
  'benchQuarterOnClear',
  'benchScaleHeal',
  'benchStrike',
  'blessConsumePp',
  'blessGain',
  'blessGainOnHit',
  'blessKillCost',
  'blessTurnEnd',
  'blindStack',
  'blockCrit',
  'blockSwitch',
  'blockSwitchBoth',
  'bothMaxHpDown',
  'buffGoneAttrBlock',
  'burnEndBranch',
  'capOnStatus',
  'chanceDodge',
  'chanceImmune',
  'chanceImmuneReflect',
  'chanceImmuneStatus',
  'clear',
  'clearBoth',
  'clearBothBoth',
  'clearBothThenFlat',
  'clearFoe',
  'clearOrFearDrain',
  'clearShield',
  'clearShieldFlat',
  'cond',
  'convertTaken',
  'copyAtk',
  'copyDef',
  'copySkill',
  'copyType',
  'cosmetic',
  'costHalfStats',
  'costHpStats',
  'counterMul',
  'critBonus',
  'critBonusTurns',
  'critBuff',
  'critChance',
  'critHealDealt',
  'critIfFirst',
  'critIfLower',
  'critIfPositive',
  'critImmune',
  'critPercent',
  'critRamp',
  'critThenSkillBlock',
  'critThenStarRage',
  'critThisHit',
  'cure',
  'damageBuff',
  'damageCap',
  'damageFlat',
  'deadAllyPriority',
  'dealt',
  'dealtMulFoeStatus',
  'deathCurse',
  'deathFear',
  'deathTeamGuard',
  'defFixedHeal',
  'defStatsPct',
  'delayedFlat',
  'delayedKill',
  'desperate',
  'disableFoeBuffs',
  'divineTurn',
  'dodge',
  'dodgePassive',
  'dodgeTimes',
  'dot',
  'doubleStages',
  'doubleStagesOnKill',
  'dragonAura',
  'drain',
  'drainFlat',
  'drainFlatRamp',
  'drainIfStatus',
  'drainMax',
  'drainOnCrit',
  'drainOnFoeAtk',
  'drainOnHit',
  'drainPct',
  'drainRandom',
  'drainTimed',
  'drainTurns',
  'dtzfSoul',
  'endClearStatus',
  'endDamageIfStatus',
  'endDamageLost',
  'endDamagePerSpeed',
  'endDrainIfLow',
  'endHeal',
  'endHealByDealt',
  'endHealCond',
  'endHealIfUp',
  'endHealLowPct',
  'endInvertFoe',
  'endPpRestore',
  'endRampFlat',
  'endShieldBranch',
  'enterBless',
  'enterClearLock',
  'enterRandomStatus',
  'enterShieldImmune',
  'entryBuff',
  'entryImmuneStatus',
  'entryShield',
  'entryShieldFlat',
  'entrySkillBlock',
  'entryStatDown',
  'entryStatus',
  'evadeIfFirst',
  'exec',
  'execChance',
  'execOnHit',
  'exile',
  'exiledPpDrain',
  'fateHengDef',
  'fateJieDef',
  'fateOnSwitch',
  'fateWheel',
  'fenjinOnClear',
  'fieldOnEnter',
  'firstDeathSurvive',
  'firstEntryNullAttack',
  'firstHealBlock',
  'firstNullify',
  'firstNullifyScale',
  'firstReviveTurn',
  'firstSkillNullify',
  'firstSpeedUp',
  'firstStatUp',
  'fixedPctPersistReduce',
  'flat',
  'flatByAtk',
  'flatByCurHp',
  'flatByDealt',
  'flatByDef',
  'flatByDefStages',
  'flatByMaxHp',
  'flatByOwnDefs',
  'flatByOwnStat',
  'flatBySelfLost',
  'flatByStatStages',
  'flatByStats',
  'flatByStats3',
  'flatByTargetCurHp',
  'flatByTargetCurHpRamp',
  'flatByTargetDefPct',
  'flatByTargetLost',
  'flatByTargetMax',
  'flatByTargetMaxHp',
  'flatByTargetMaxHpRamp',
  'flatDrainSelf',
  'flatPerEqualStat',
  'flatRandom',
  'flatRandomCond',
  'flatRandomHeal',
  'foeHealEnd',
  'foeMiss',
  'foeNoStatUp',
  'foePercentSelf',
  'foePriorityDown',
  'foeStatDown',
  'foeStatSet',
  'foeStatusSealOnAtk',
  'foeTypeBranch',
  'formSwitch',
  'formSystem',
  'fullHpGuard',
  'genderBranch',
  'genderImmune',
  'giveStatsAsDebuff',
  'guard',
  'guardFlat',
  'halfHpPrioHeal',
  'halfHpRoundLock',
  'heal',
  'healBlock',
  'healBlockPunish',
  'healBoth',
  'healByLost',
  'healByShield',
  'healChance',
  'healDown',
  'healFlat',
  'healOnFoeMiss',
  'healRandom',
  'healRandomCond',
  'healStatusFail',
  'highHpImmuneAllDown',
  'highHpPrioImmune',
  'hitStatusFixed',
  'hpBonus',
  'hpCutRandom',
  'hpScaleHao',
  'hunyuan',
  'ifFoeFirstReduce',
  'ifSelfFirstBoost',
  'ignoreDefPct',
  'ignoreDefPctTurns',
  'ignoreDefStack',
  'ignoreDefUp',
  'ignoreGuards',
  'ignoreImmune',
  'ignoreShield',
  'immuneAbove',
  'immuneAndReflect',
  'immuneBelow',
  'immuneBelowPassive',
  'immuneCrit',
  'immuneCritReflect',
  'immuneFixedPct',
  'immuneNextOrHalve',
  'immuneReflectStatus',
  'immuneStat',
  'immuneStatus',
  'immuneStatusIds',
  'immuneStatusIfNoDefUp',
  'invertFoeNegative',
  'invertFoeStages',
  'invertSelfDowns',
  'invertStages',
  'invertThenImmune',
  'invertToFoe',
  'itemFlip',
  'junGuard',
  'junNoWeakenNext',
  'junPunish',
  'junWei',
  'junYu',
  'junYuan',
  'junYun',
  'junZhen',
  'lastClearHeal',
  'lastFoeAttackBlock',
  'leiEndBoost',
  'leiRoundLock',
  'leiRoundToOne',
  'leiSteal',
  'level100Revive',
  'lockPpZero',
  'lowDamageBenchStrike',
  'lowHpExec',
  'lowHpExtraReduce',
  'lowHpReduceAllDown',
  'lowPowerPunish',
  'lowTrueDamage',
  'maxHpDown',
  'maxHpDownPct',
  'minDamage',
  'mirrorFoeStages',
  'mirrorHeal',
  'mirrorStat',
  'mistikeEntry',
  'mistikeReact',
  'morphDestroy',
  'morphGuard',
  'morphSpeed',
  'morphUltimate',
  'multiHit',
  'multiHitChance',
  'multiHitLowerHp',
  'multiHitShield',
  'mustHit',
  'mwAtkStatDown',
  'mwDeath',
  'mwDeathBless',
  'mwGuard',
  'mwPhaseTransfer',
  'nextCrit',
  'nextGuard',
  'nextGuardByDealt',
  'nextPet',
  'nextPetMaxHpDown',
  'noDamageDrain',
  'noDamageHeal',
  'noPpCost',
  'noWeak',
  'nyxEnter',
  'nyxField',
  'nyxHpBranch',
  'onDeathClearFoe',
  'onEnterClear',
  'onHitClearFoeStats',
  'onHitCondStatus',
  'onHitCritBuff',
  'onHitDamageUp',
  'onHitExtraFlat',
  'onHitFlatPct',
  'onHitHealChance',
  'onHitImmune',
  'onHitMaxHpDown',
  'onHitMultiStatDown',
  'onHitPercentHp',
  'onHitRandomStatDown',
  'onHitReflect',
  'onHitReflectPct',
  'onHitStatUp',
  'onHitStatus',
  'onHitStatusTimed',
  'onKillAttackBlock',
  'onKillHealNext',
  'onKillNextPriorityDown',
  'onKillPriority',
  'onKillSkillBlock',
  'onMissHeal',
  'oneHit',
  'oneHitIfFirst',
  'oneHitIfLower',
  'oppTo1',
  'pendingZhuoxin',
  'perTurnDrain',
  'perTurnFlatByStats',
  'perTurnPpZero',
  'perTurnPriorityDown',
  'perTurnStatDown',
  'perTurnStatDown2',
  'perTurnStatUp',
  'perTurnSteal',
  'perTurnStealStats',
  'percentHp',
  'permImmuneStatWhenFull',
  'power',
  'powerByStat',
  'powerChance',
  'powerChanceRamp',
  'powerLowHp',
  'powerPerBench',
  'powerPerFoeStage',
  'powerPerStack',
  'powerPerStatUp',
  'powerRandom',
  'powerRandomRamp',
  'pp',
  'ppCostMul',
  'ppDrain',
  'ppDrainFirst',
  'ppExtra',
  'ppRestoreAll',
  'ppRestoreChance',
  'ppRestoreSelf',
  'ppZero',
  'ppZeroOnFoeAtk',
  'ppZeroOnHit',
  'ppZeroPerMark',
  'ppZeroTimes',
  'preHitClearFoe',
  'prevDamageFlat',
  'prevDamageHalfAttack',
  'prioPpZero',
  'priority',
  'priorityAlways',
  'priorityBuff',
  'priorityChance',
  'priorityCond',
  'priorityDown',
  'priorityDownNoDamage',
  'priorityIfFoeSpeed',
  'priorityIfHigher',
  'priorityIfHpBelow',
  'priorityIfLow',
  'priorityIfPositive',
  'priorityStreak',
  'protectStats',
  'punishByCategory',
  'punishStatusSkill',
  'rageCrit',
  'rageHigh',
  'rageLow',
  'ramp',
  'rampDamage',
  'rampPct',
  'randomSelfOrFoe',
  'randomSelfOrTarget',
  'randomStatDown',
  'randomStatUp',
  'randomStatus',
  'randomUpFoeDown',
  'rebirth',
  'recoil',
  'reflectDamage',
  'reflectIfAlive',
  'reflectIfHit',
  'reflectLethal',
  'reflectNext',
  'reflectOnHitPct',
  'regen',
  'regenPerSibling',
  'regenRandom',
  'regenRatio',
  'regenShield',
  'restoreStages',
  'returnStats',
  'reviveChance',
  'reviveOnce',
  'revivePowerBuff',
  'reviveTeammate',
  'roundLock',
  'sacrificeImmune',
  'sacrificeNextPet',
  'selfCostDamage',
  'selfCostPercent',
  'selfCostPriority',
  'selfKo',
  'selfKoHalfShield',
  'selfKoOnMiss',
  'shield',
  'shieldBreakClear',
  'shieldPriority',
  'shieldToDamage',
  'skillBlock',
  'skillBlockChance',
  'skillNullNext',
  'speed',
  'speedToHp',
  'stackPassive',
  'stacksOnKill',
  'stacksOnResult',
  'starAtkSum',
  'starAura',
  'starDial',
  'starEntry',
  'starGift',
  'starImmunity',
  'starLowDamage',
  'starPhil',
  'starPhysDrain',
  'starPowerKeep',
  'starPunish',
  'starRageBonus',
  'starRageDouble',
  'starRageMode',
  'starRageOnNull',
  'starSeaMark',
  'starSpecialPrio',
  'startDamageDouble',
  'startStageBranch',
  'startTakenMul',
  'stat',
  'statDownLock',
  'status',
  'statusGuardTimes',
  'statusRamp',
  'statusResist',
  'statusShorten',
  'statusSkillEndHeal',
  'statusSkillImmuneNext',
  'statusSkillMiss',
  'stealPositive',
  'stealShield',
  'stealStats',
  'subFull',
  'summonYu',
  'summonZhan',
  'survive',
  'swapHp',
  'swapHpPct',
  'swapPos',
  'swapType',
  'switchOutShield',
  'taken',
  'takenTurns',
  'targetDamageDown',
  'teFixedUse',
  'thorns',
  'treatFoeStatAsDown',
  'trueDamage',
  'twinCorps',
  'typeFixedDamage',
  'typePower',
  'useHeal',
  'useHighestStat',
  'ward',
  'wudaoAdvance',
  'wudaoDealt',
  'wudaoHeal',
  'wudaoOpen',
  'wudaoPP',
  'wudaoSkillDmg',
  'wukongForm',
  'wukongFormDetail',
  'wukongTurn',
  'yuBuff',
  'yuMain',
  'yuSub',
  'yueMain',
  'yueSub',
  'zhanBuff',
  'zhuoxinBuff'
];

export const isEffectKind = (v: unknown): v is EffectKind =>
  typeof v === 'string' && EFFECT_KINDS.indexOf(v as EffectKind) >= 0;

export interface EffectRule {
  kind: EffectKind;
  [param: string]: unknown;
}

/** 一条解析规则：正则 → 效果模板（P2 的表格形态，逐步替换 if/else） */
export interface RuleEntry {
  name: string;
  pattern: RegExp;
  build: (m: RegExpExecArray) => EffectRule | EffectRule[] | null;
}
