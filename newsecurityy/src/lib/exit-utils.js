import { formatTrDateTime, getEntryLocation, matchesByTab } from './utils';
import { getLogBindingId } from './log-sync-utils';

export function getExitCandidates(activeLogs = [], mainTab = 'vehicle') {
  return [...(Array.isArray(activeLogs) ? activeLogs : [])]
    .filter((log) => log?.type === mainTab && !log?.exit_at)
    .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0));
}

export function buildExitOptionLabel(log = {}) {
  const identifier = log.plate || log.name || 'Kimliksiz Kayıt';
  const details = [
    log.driver || null,
    log.host || null,
    getEntryLocation(log) || null,
    log.created_at ? formatTrDateTime(log.created_at) : null,
  ].filter(Boolean);

  return details.length > 0 ? `${identifier} | ${details.join(' | ')}` : identifier;
}

export function resolveExitRecord({
  selectedExitLogId = '',
  activeLogs = [],
  allLogs = [],
  mainTab = 'vehicle',
  rawIdentifier = '',
} = {}) {
  const exitCandidates = getExitCandidates(activeLogs, mainTab);
  const matchesSelectedLogId = (log) =>
    getLogBindingId(log) === String(selectedExitLogId)
    || String(log?.id || '') === String(selectedExitLogId);

  if (selectedExitLogId) {
    const record = exitCandidates.find(matchesSelectedLogId)
      || (Array.isArray(allLogs) ? allLogs.find(matchesSelectedLogId) : null)
      || null;

    return record
      ? { record, matches: [record], reason: 'selected' }
      : { record: null, matches: [], reason: 'selected_not_found' };
  }

  if (!rawIdentifier || !String(rawIdentifier).trim()) {
    return { record: null, matches: [], reason: 'missing_input' };
  }

  const matches = exitCandidates.filter((log) => matchesByTab(log, rawIdentifier, mainTab));

  if (matches.length === 1) {
    return { record: matches[0], matches, reason: 'identifier' };
  }

  if (matches.length > 1) {
    return { record: null, matches, reason: 'ambiguous' };
  }

  return { record: null, matches: [], reason: 'not_found' };
}
