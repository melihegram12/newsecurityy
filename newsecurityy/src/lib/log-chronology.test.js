import { calculateStayMinutes, getChronologyIssue } from './utils';

describe('getChronologyIssue', () => {
  test('returns null for valid chronology', () => {
    expect(getChronologyIssue('2026-03-20T08:00:00.000Z', '2026-03-20T09:30:00.000Z')).toBeNull();
  });

  test('flags reverse chronology', () => {
    expect(getChronologyIssue('2026-03-20T10:00:00.000Z', '2026-03-20T09:30:00.000Z')).toBe('exit_before_entry');
  });

  test('flags invalid timestamps when exit exists', () => {
    expect(getChronologyIssue('gecersiz', '2026-03-20T09:30:00.000Z')).toBe('invalid_timestamp');
  });
});

describe('calculateStayMinutes', () => {
  test('returns positive minutes for valid rows', () => {
    expect(calculateStayMinutes('2026-03-20T08:00:00.000Z', '2026-03-20T09:30:00.000Z')).toBe(90);
  });

  test('clamps invalid reverse durations to zero', () => {
    expect(calculateStayMinutes('2026-03-20T10:00:00.000Z', '2026-03-20T09:30:00.000Z')).toBe(0);
  });
});
