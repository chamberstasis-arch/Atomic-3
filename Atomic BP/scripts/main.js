import { initAllScoreboards } from "./scoreboards/index.js";
import { initInventorySaves } from "./features/inventory/saves.js";
import { initChestUi } from "./features/chest-ui/index.js";
import { initAntiCheat } from "./features/anticheat/index.js";
import { initCommands } from "./modules/commands/index.js";
import { initSkillRegeneration } from "./features/skills/regeneration/index.js";
import { skillRegenConfig } from "./features/skills/regeneration/config.js";
import { initSkillsCore } from "./features/skills/core/index.js";
import { skillsCoreConfig } from "./features/skills/core/config.js";
import { initSkillMining } from "./features/skills/mining/index.js";
import { miningSkillConfig } from "./features/skills/mining/config.js";
import { initSkillForaging } from "./features/skills/foraging/index.js";
import { foragingSkillConfig } from "./features/skills/foraging/config.js";
import { initSkillFarming } from "./features/skills/farming/index.js";
import { farmingSkillConfig } from "./features/skills/farming/config.js";
import { initCustomEmojis } from "./features/custom-emojis/index.js";
import { initCustomItems } from "./features/custom-items/index.js";
import { customItemsConfig } from "./features/custom-items/config.js";
import { initHolograms } from "./features/holograms/index.js";
import { hologramsConfig } from "./features/holograms/config.js";
import { initLecture } from "./features/skills/lecture/index.js";
import { lectureConfig } from "./features/skills/lecture/config.js";
import { initDamageCalc } from "./features/skills/combat/calc/index.js";
import { damageCalcConfig } from "./features/skills/combat/calc/config.js";
import { initVanillaDamageCancel } from "./features/skills/combat/damageCancel/index.js";
import { initCombatHealth } from "./features/skills/combat/health/index.js";
import { initDamageDealt } from "./features/skills/combat/damage_dealt/index.js";
import { initDamageTitle } from "./features/skills/combat/damage_title/index.js";
import { initEffects } from "./features/skills/combat/effects/index.js";
import { initAchievements } from "./features/achievements/index.js";
import { initDeathSystem } from "./systems/death/index.js";
import deathConfig from "./systems/death/config.js";
import { initSpawnpointsSystem } from "./systems/spawnpoints/index.js";
import spawnpointsConfig from "./systems/spawnpoints/config.js";
import { initOnJoinFirstTime } from "./systems/onJoinFirstTime/index.js";
import onJoinFirstTimeConfig from "./systems/onJoinFirstTime/config.js";
import { initTitlesPrioritySystem } from "./systems/titlesPriority/index.js";
import titlesPriorityConfig from "./systems/titlesPriority/config.js";

initAllScoreboards();
initChestUi();
initCommands();
initAntiCheat();
initCustomEmojis();
initCustomItems(customItemsConfig);
initHolograms(hologramsConfig);
initTitlesPrioritySystem(titlesPriorityConfig);
// Orden de skills: scoreboards -> lecture -> core -> skills -> regeneration -> combat
initLecture(lectureConfig);
initSkillsCore(skillsCoreConfig);
initSkillMining(miningSkillConfig);
initSkillForaging(foragingSkillConfig);
initSkillFarming(farmingSkillConfig);
initSkillRegeneration(skillRegenConfig);
initDamageCalc(damageCalcConfig);
initVanillaDamageCancel();
initCombatHealth();
initDamageTitle();
initEffects();
initDamageDealt({ debug: false });
initAchievements();
initDeathSystem(deathConfig);
initSpawnpointsSystem(spawnpointsConfig);
initOnJoinFirstTime(onJoinFirstTimeConfig);
initInventorySaves({
    slots: 10,
    loopTicks: 5,
    keyPrefix: "atomic3:inv:"
});