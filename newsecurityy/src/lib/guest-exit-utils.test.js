import { DIRECTION_ENTRY, DIRECTION_EXIT } from './constants';
import { buildIndependentExitConfirmation, resolveGuestExitUiState } from './guest-exit-utils';

describe('resolveGuestExitUiState', () => {
  test('forces anonymous users into vehicle exit mode when guest exit is active', () => {
    expect(resolveGuestExitUiState({
      session: null,
      guestExitMode: true,
      currentPage: 'dashboard',
      mainTab: 'visitor',
      vehicleDirection: DIRECTION_ENTRY,
    })).toEqual({
      active: true,
      showLogin: false,
      currentPage: 'main',
      mainTab: 'vehicle',
      vehicleDirection: DIRECTION_EXIT,
      canUseEntryFlows: false,
      canUseVisitorFlows: false,
      canEditHistory: false,
      canOpenPrivilegedPages: false,
    });
  });

  test('keeps normal navigation when a session exists', () => {
    expect(resolveGuestExitUiState({
      session: { user: { email: 'guard@example.com' } },
      guestExitMode: true,
      currentPage: 'dashboard',
      mainTab: 'visitor',
      vehicleDirection: DIRECTION_ENTRY,
    })).toEqual({
      active: false,
      showLogin: false,
      currentPage: 'dashboard',
      mainTab: 'visitor',
      vehicleDirection: DIRECTION_ENTRY,
      canUseEntryFlows: true,
      canUseVisitorFlows: true,
      canEditHistory: true,
      canOpenPrivilegedPages: true,
    });
  });
});

describe('buildIndependentExitConfirmation', () => {
  test('warns when exit is being created without an active inside record', () => {
    expect(buildIndependentExitConfirmation('34 ABC 123')).toEqual({
      title: 'Çıkış Uyarısı',
      message: '34 ABC 123 içeride görünmüyor.\n\nYine de çıkış kaydı oluşturulsun mu?',
    });
  });
});
