import { formatTrDateTime, getEntryLocation, matchesByTab } from './utils';
import { getLogBindingId } from './log-sync-utils';

export const SUB_TAB_TO_SUB_CATEGORY = {
  guest: 'Misafir Araç',
  staff: 'Personel Aracı',
  management: 'Yönetim Aracı',
  service: 'Servis Aracı',
  sealed: 'Mühürlü Araç',
  company: 'Şirket Aracı',
};

export function matchesVehicleSubCategory(log = {}, vehicleSubTab = '') {
  if (!vehicleSubTab) return true;
  const expectedSubCategory = SUB_TAB_TO_SUB_CATEGORY[vehicleSubTab];
  if (!expectedSubCategory) return true;
  const actualSubCategory = String(log?.sub_category || '');
  return actualSubCategory === expectedSubCategory
    || actualSubCategory.startsWith(`${expectedSubCategory} `)
    || actualSubCategory.startsWith(`${expectedSubCategory}(`);
}

const EXIT_LOCATION_DRIVER_TYPES = new Set(['driver', 'supervisor', 'manual']);

export function shouldCreateIndependentExit({
  mainTab = 'vehicle',
  isExitDirection = false,
  vehicleSubTab = '',
} = {}) {
  return mainTab === 'vehicle'
    && Boolean(isExitDirection)
    && vehicleSubTab === 'company';
}

export function shouldAskVehicleExitLocation({
  mainTab = 'vehicle',
  isExitDirection = false,
  vehicleSubTab = '',
  driverType = '',
} = {}) {
  return mainTab === 'vehicle'
    && Boolean(isExitDirection)
    && vehicleSubTab === 'management'
    && EXIT_LOCATION_DRIVER_TYPES.has(driverType);
}

export function shouldAskVehicleEntryLocation({
  mainTab = 'vehicle',
  isEntryDirection = false,
  vehicleSubTab = '',
  driverType = '',
} = {}) {
  return mainTab === 'vehicle'
    && Boolean(isEntryDirection)
    && (
      vehicleSubTab === 'company'
      || (vehicleSubTab === 'management' && driverType !== 'owner')
    );
}

export function getExitCandidates(activeLogs = [], mainTab = 'vehicle', vehicleSubTab = '') {
  return [...(Array.isArray(activeLogs) ? activeLogs : [])]
    .filter((log) => {
      if (log?.type !== mainTab || log?.exit_at) return false;
      // Araç sekmesinde alt kategoriye göre de filtrele
      if (mainTab === 'vehicle' && vehicleSubTab) {
        if (!matchesVehicleSubCategory(log, vehicleSubTab)) return false;
      }
      return true;
    })
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
  vehicleSubTab = '',
} = {}) {
  const exitCandidates = getExitCandidates(activeLogs, mainTab, vehicleSubTab);
  const matchesSelectedLogId = (log) =>
    getLogBindingId(log) === String(selectedExitLogId)
    || String(log?.id || '') === String(selectedExitLogId);
  const hasIdentifier = Boolean(rawIdentifier && String(rawIdentifier).trim());

  if (selectedExitLogId) {
    const record = exitCandidates.find(matchesSelectedLogId)
      || getExitCandidates(allLogs, mainTab, vehicleSubTab).find(matchesSelectedLogId)
      || null;

    if (!record) {
      return { record: null, matches: [], reason: 'selected_not_found' };
    }

    if (!hasIdentifier || matchesByTab(record, rawIdentifier, mainTab)) {
      return { record, matches: [record], reason: 'selected' };
    }
  }

  if (!hasIdentifier) {
    return { record: null, matches: [], reason: 'missing_input' };
  }

  const matches = exitCandidates.filter((log) => matchesByTab(log, rawIdentifier, mainTab));

  if (matches.length === 1) {
    return { record: matches[0], matches, reason: 'identifier' };
  }

  if (matches.length > 1) {
    return { record: null, matches, reason: 'ambiguous' };
  }

  // Cross sub-tab fallback: Araç plakası/ismi mevcut alt-sekmede bulunamadıysa,
  // diğer alt-sekmelerde aktif kayıt var mı diye bak. Operatörün gün-sonu vardiya
  // değişiminde yanlış sekmede olması veya kaydın farklı kategoride girilmiş
  // olması durumunda "araç içerde ama çıkış yapamıyor" senaryosunu engeller.
  if (mainTab === 'vehicle' && vehicleSubTab) {
    const allActiveCandidates = getExitCandidates(activeLogs, mainTab, '');
    const crossMatches = allActiveCandidates.filter((log) => matchesByTab(log, rawIdentifier, mainTab));
    if (crossMatches.length === 1) {
      return { record: crossMatches[0], matches: crossMatches, reason: 'identifier_cross_subtab' };
    }
    if (crossMatches.length > 1) {
      return { record: null, matches: crossMatches, reason: 'ambiguous_cross_subtab' };
    }
  }

  return { record: null, matches: [], reason: 'not_found' };
}
