import { describe, it, expect } from 'vitest';
import { STAFF_CAPABILITIES } from '@rushpoint/shared';
import { buildStaffCodeRows, toggleCapability } from '../staffCodes';

// staff-capabilities: the Run Console's staff codes panel. What it shows must match what the
// server's gate will actually do, or an organizer believes a marshal cannot add points when they can.
describe('buildStaffCodeRows', () => {
  const codes = [
    { id: 'c2', label: 'Judges', pin: '222222', capabilities: ['review'], multiUse: true, disabled: false, createdAt: '2026-09-26T10:05:00Z' },
    { id: 'c1', label: 'North gate', pin: '111111', capabilities: ['chat', 'hold'], multiUse: true, disabled: true, createdAt: '2026-09-26T10:00:00Z' },
    { id: 'old', name: 'Staff 1', pin: '333333', used: true, createdAt: '2026-09-26T09:00:00Z' },
  ];
  const grants = [
    { id: 'u1', codeId: 'c1', name: 'Dana', removed: false, joinedAt: '2026-09-26T10:10:00Z' },
    { id: 'u2', codeId: 'c1', name: 'Noa', removed: true, joinedAt: '2026-09-26T10:11:00Z' },
    { id: 'u3', codeId: 'c2', name: 'Avi', removed: false, joinedAt: '2026-09-26T10:12:00Z' },
  ];
  const rows = buildStaffCodeRows(codes, grants);

  it('lists codes oldest first', () => {
    expect(rows.map((r) => r.id)).toEqual(['old', 'c1', 'c2']);
  });
  it('counts only people who were not removed', () => {
    expect(rows.find((r) => r.id === 'c1')!.people.map((p) => p.name)).toEqual(['Dana']);
  });
  it('shows the always-granted capabilities as part of what a code can do', () => {
    const judges = rows.find((r) => r.id === 'c2')!;
    expect(judges.capabilities).toContain('review');
    expect(judges.capabilities).toContain('safety');
    expect(judges.capabilities).not.toContain('score');
  });
  it('a code from before capabilities is shown as full and legacy, so nobody believes it is limited', () => {
    const old = rows.find((r) => r.id === 'old')!;
    expect(old.legacy).toBe(true);
    expect([...old.capabilities].sort()).toEqual([...STAFF_CAPABILITIES].sort());
    expect(old.label).toBe('Staff 1');
  });
  it('carries the disabled state', () => {
    expect(rows.find((r) => r.id === 'c1')!.disabled).toBe(true);
  });
  it('survives junk documents instead of throwing', () => {
    expect(() => buildStaffCodeRows([{ id: 'x' } as never, null as never], [null as never])).not.toThrow();
  });
});

describe('toggleCapability', () => {
  it('adds and removes an ordinary capability', () => {
    expect(toggleCapability(['chat'], 'score', true)).toEqual(['score', 'chat'].sort((a, b) => STAFF_CAPABILITIES.indexOf(a as never) - STAFF_CAPABILITIES.indexOf(b as never)));
    expect(toggleCapability(['chat', 'score'], 'score', false)).toEqual(['chat']);
  });
  it('never removes an always-granted one', () => {
    expect(toggleCapability(['safety', 'chat'], 'safety', false)).toContain('safety');
  });
});
