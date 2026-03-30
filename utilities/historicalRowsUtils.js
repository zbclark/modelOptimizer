const { extractHistoricalRowsFromSnapshotPayload } = require('./extractHistoricalRows');
const { normalizeFinishPosition } = require('./parsingUtils');

const normalizeHistoricalRoundRow = row => {
  if (!row || typeof row !== 'object') return null;
  const dgId = row.dg_id || row.dgId || row.player_id || row.playerId || row.id;
  const eventId = row.event_id || row.eventId || row.tournament_id || row.tournamentId;
  if (!dgId || !eventId) return null;
  const yearValue = row.year ?? row.season ?? row.season_year ?? row.seasonYear;
  const roundNum = row.round_num ?? row.roundNum ?? row.round;
  const finText = row.fin_text ?? row.finish ?? row.finishPosition ?? row.fin;
  const finishPosition = normalizeFinishPosition(row.finish_position ?? row.finishPosition ?? finText);
  const eventCompleted = row.event_completed ?? row.eventCompleted ?? row.end_date ?? row.completed;
  return {
    ...row,
    dg_id: String(dgId).trim(),
    player_name: row.player_name || row.playerName || row.name || null,
    event_id: String(eventId).trim(),
    year: yearValue ?? row.year,
    season: row.season ?? row.year ?? yearValue,
    round_num: roundNum ?? row.round_num,
    fin_text: finText ?? row.fin_text,
    finish_position: finishPosition,
    event_completed: eventCompleted ?? row.event_completed
  };
};

module.exports = {
  extractHistoricalRowsFromSnapshotPayload,
  normalizeHistoricalRoundRow
};
