import { describe, expect, it } from 'vitest';
import { CLIMATE_MODULES } from '../modules';
import { DEFAULT_VIEW, DESTINATIONS, LIBRARY_GROUPS, destinationFor, isDestination, resolveView } from './library';

// Every view the sidebar offered before the dashboard merge. A view missing from the
// library would strand a page, so this list is the preservation contract.
const LEGACY_VIEWS = ['earth', 'session', 'overview', 'memory', 'ledger', 'studio', 'mission', 'cascade', 'connections', 'capabilities', 'waste', 'fire', 'water', 'air'];

describe('dashboard library', () => {
  it('keeps every legacy view as a destination', () => {
    for (const id of LEGACY_VIEWS) expect(isDestination(id), id).toBe(true);
  });

  it('lists every native module once, under its module id and name', () => {
    for (const item of CLIMATE_MODULES) {
      expect(destinationFor(`module:${item.id}`)?.label, item.id).toBe(item.name);
    }
    expect(DESTINATIONS.filter((item) => item.group === 'modules')).toHaveLength(CLIMATE_MODULES.length);
  });

  it('gives every destination a unique id', () => {
    const ids = DESTINATIONS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every destination in a group the rail renders', () => {
    const groups = new Set(LIBRARY_GROUPS.map((group) => group.id));
    for (const item of DESTINATIONS) expect(groups.has(item.group), item.id).toBe(true);
  });

  it('files each module under a stage it declares', () => {
    for (const item of CLIMATE_MODULES) {
      expect(item.stages.length, item.id).toBeGreaterThan(0);
      expect(item.stages, item.id).toContain(destinationFor(`module:${item.id}`)?.stage);
    }
  });

  it('resolves legacy hashes with or without the leading #', () => {
    expect(resolveView('#waste')).toBe('waste');
    expect(resolveView('mission')).toBe('mission');
    expect(resolveView('#earth')).toBe('earth');
    const firstModule = CLIMATE_MODULES[0].id;
    expect(resolveView(`#module:${firstModule}`)).toBe(`module:${firstModule}`);
  });

  it('rejects hashes that name nothing, so the app falls back to the default view', () => {
    expect(resolveView('')).toBeNull();
    expect(resolveView('#')).toBeNull();
    expect(resolveView('#nope')).toBeNull();
    expect(resolveView('#module:does-not-exist')).toBeNull();
  });

  it('lands on the command center by default', () => {
    expect(DEFAULT_VIEW).toBe('overview');
  });

  it('registers the Climate Integrity Lab and 200-Year Timeline as evidence destinations alongside legacy views', () => {
    expect(destinationFor('integrity')?.group).toBe('evidence');
    expect(resolveView('#integrity')).toBe('integrity');
    expect(destinationFor('timeline')?.group).toBe('evidence');
    expect(resolveView('#timeline')).toBe('timeline');
    expect(destinationFor('lab')?.group).toBe('evidence');
    expect(resolveView('#lab')).toBe('lab');
    expect(DESTINATIONS.filter((item) => item.group !== 'modules')).toHaveLength(LEGACY_VIEWS.length + 3);
  });
});
