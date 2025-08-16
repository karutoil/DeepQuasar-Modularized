import vm from 'vm';

/**
 * Evaluate a custom formula expression safely inside a sandbox.
 * Allowed vars: level, baseXP, growthFactor
 */
export function evaluateFormula({ level, baseXP, growthFactor, expression }) {
  if (!expression || typeof expression !== 'string') return baseXP * level;
  // Very small sandbox using vm with timeout
  try {
    const sandbox = { level: Number(level), baseXP: Number(baseXP), growthFactor: Number(growthFactor), result: 0 };
    vm.createContext(sandbox);
    const code = `result = (function(){ try { return (${expression}); } catch(e) { return ${Number(baseXP) * Number(level)} } })()`;
    vm.runInContext(code, sandbox, { timeout: 50 });
    const res = Number(sandbox.result) || 0;
    return Math.floor(res);
  } catch (err) {
    return Math.floor(baseXP * level);
  }
}

export function validateConfigPatch(patch) {
  // minimal validation
  const out = {};
  if (patch.xpPerMessage !== undefined) out.xpPerMessage = Number(patch.xpPerMessage);
  if (patch.cooldownSeconds !== undefined) out.cooldownSeconds = Number(patch.cooldownSeconds);
  if (patch.xpCapPerWindow !== undefined) out.xpCapPerWindow = Number(patch.xpCapPerWindow);
  if (patch.minMessageLength !== undefined) out.minMessageLength = Number(patch.minMessageLength);
  if (patch.formula) out.formula = patch.formula;
  if (patch.roleRewards) out.roleRewards = patch.roleRewards;
  if (patch.exclusions) out.exclusions = patch.exclusions;
  if (patch.toggles) out.toggles = patch.toggles;
  return out;
}
