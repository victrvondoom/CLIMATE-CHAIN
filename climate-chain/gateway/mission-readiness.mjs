import { getMemoryConflicts, searchMemoryRecords, verifyMemoryIntegrity } from './agent-memory.mjs';

export class MissionMemoryReadinessError extends Error {
  constructor(code, message, status = 503, action = 'Open Memory Studio and verify the local vault before retrying.', conflicts = []) {
    super(message);
    this.name = 'MissionMemoryReadinessError';
    this.code = code;
    this.status = status;
    this.action = action;
    this.conflicts = conflicts;
  }
}

export async function attachFreshMissionMemory(engine, missionId, project = 'climate-chain') {
  const mission = await engine.getMission(missionId);
  let integrity;
  try { integrity = await verifyMemoryIntegrity(); }
  catch { throw new MissionMemoryReadinessError('CLIMATE_CHAIN_MEMORY_UNAVAILABLE', 'The local engineering memory vault could not be read.'); }
  if (!integrity.valid || !integrity.complete) {
    throw new MissionMemoryReadinessError('CLIMATE_CHAIN_MEMORY_UNAVAILABLE', 'The local engineering memory vault did not pass integrity checks.');
  }
  const query = [mission.title, mission.description, ...mission.tasks.map((task) => `${task.title} ${task.type}`)].join(' ').slice(0, 2400);
  let recall;
  try { recall = await searchMemoryRecords({ query, project, limit: 20 }); }
  catch { throw new MissionMemoryReadinessError('CLIMATE_CHAIN_MEMORY_UNAVAILABLE', 'Mission memory recall could not be completed.'); }
  if (!recall.complete) throw new MissionMemoryReadinessError('CLIMATE_CHAIN_MEMORY_UNAVAILABLE', 'Mission memory recall was incomplete.');
  let conflicts;
  try { conflicts = await getMemoryConflicts({ project }); }
  catch { throw new MissionMemoryReadinessError('CLIMATE_CHAIN_MEMORY_UNAVAILABLE', 'Memory conflict checks could not be completed.'); }
  if (!conflicts.complete) throw new MissionMemoryReadinessError('CLIMATE_CHAIN_MEMORY_UNAVAILABLE', 'Memory conflict checks did not complete.');
  const recalledIds = new Set(recall.entries.map((entry) => entry.id));
  const relevantConflicts = conflicts.conflicts.filter((conflict) => conflict.records.some((record) => recalledIds.has(record.id)));
  if (relevantConflicts.length) {
    throw new MissionMemoryReadinessError(
      'MISSION_MEMORY_CONFLICT',
      'Relevant engineering memories conflict; resolve or supersede them before running this mission.',
      409,
      'Open Memory Studio, resolve the listed conflicts, then refresh the mission memory gate.',
      relevantConflicts.map((conflict) => conflict.id),
    );
  }
  const prepared = await engine.attachMemoryContext(missionId, {
    memoryIds: recall.entries.map((entry) => entry.id), manifestSha256: recall.manifestSha256,
    retrievedAt: recall.trace.at,
  });
  return { mission: prepared, memoryIds: recall.entries.map((entry) => entry.id), manifestSha256: recall.manifestSha256, retrievedAt: recall.trace.at };
}
