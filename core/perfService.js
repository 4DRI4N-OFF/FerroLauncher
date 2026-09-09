const os = require('os');

const PRESETS = {
  equilibrado: [],
  rendimiento: [
    '-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200', '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch',
    '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1',
  ],
  patata: [
    '-XX:+UseSerialGC', '-XX:+TieredCompilation', '-XX:TieredStopAtLevel=1',
    '-XX:+DisableExplicitGC', '-XX:MaxGCPauseMillis=500',
  ],
  zgc: ['-XX:+UnlockExperimentalVMOptions', '-XX:+UseZGC', '-XX:+DisableExplicitGC'],
};

const LABELS = ['equilibrado', 'rendimiento', 'patata', 'zgc'];

function suggestRam() {
  const totalGb = os.totalmem() / 1073741824;
  const freeGb = os.freemem() / 1073741824;
  const suggestedMb = Math.min(12288, Math.max(2048, Math.round(Math.min(totalGb * 0.5, freeGb * 0.7) * 2) * 512));
  return { totalGb: Math.round(totalGb * 10) / 10, freeGb: Math.round(freeGb * 10) / 10, suggestedMb };
}

// ZGC solo en Java 17+; si no, cae a G1 (rendimiento)
function flagsFor(preset, javaMajor) {
  const p = LABELS.includes(preset) ? preset : 'equilibrado';
  if (p === 'zgc' && !(javaMajor >= 17)) return PRESETS.rendimiento;
  return PRESETS[p];
}

module.exports = { PRESETS, LABELS, suggestRam, flagsFor };
