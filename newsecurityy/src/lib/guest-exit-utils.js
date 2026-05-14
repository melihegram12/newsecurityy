import { DIRECTION_EXIT } from './constants';

export function resolveGuestExitUiState({
  session = null,
  guestExitMode = false,
  currentPage = 'dashboard',
  mainTab = 'vehicle',
  vehicleDirection = DIRECTION_EXIT,
} = {}) {
  const active = !session && guestExitMode;

  return {
    active,
    showLogin: !session && !guestExitMode,
    currentPage: active ? 'main' : currentPage,
    mainTab: active ? 'vehicle' : mainTab,
    vehicleDirection: active ? DIRECTION_EXIT : vehicleDirection,
    canUseEntryFlows: !active,
    canUseVisitorFlows: !active,
    canEditHistory: !active,
    canOpenPrivilegedPages: !active,
  };
}

export function buildIndependentExitConfirmation(identifier = 'Bu araç') {
  return {
    title: 'Çıkış Uyarısı',
    message: `${identifier} içeride görünmüyor.\n\nYine de çıkış kaydı oluşturulsun mu?`,
  };
}
