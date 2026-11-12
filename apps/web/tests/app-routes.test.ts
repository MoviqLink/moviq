import { describe, expect, it } from 'vitest';

import { parseAppPath } from '../src/app/routes';
import { dashboardSection } from '../src/app/DashboardShell';
import { hashSegments } from '../src/shared/routing/hash';
import { travellerHref, travellerSection } from '../src/shared/routing/hrefs';

const route = (hash: string) => parseAppPath(hashSegments(hash));
const section = (hash: string) => travellerSection(hashSegments(hash));

describe('web addresses', () => {
  it('open the home page with Sara at the root, and the conversation at #/plan', () => {
    expect(route('')).toEqual({ area: 'home' });
    expect(route(travellerHref.home)).toEqual({ area: 'home' });
    expect(route(travellerHref.plan)).toEqual({ area: 'plan' });
  });

  it('opens separate entry, explanation and demo dashboards', () => {
    expect(route('#/access')).toEqual({ area: 'access' });
    expect(route('#/access/extra')).toEqual({ area: 'not-found' });
    expect(route('#/how-it-works')).toEqual({ area: 'how-it-works' });
    expect(route('#/dashboard')).toEqual({ area: 'dashboard' });
    expect(route('#/business')).toEqual({ area: 'business' });
    expect(route('#/sandbox-help')).toEqual({ area: 'sandbox-help' });
    expect(route('#/sandbox-help/extra')).toEqual({ area: 'not-found' });
    expect(route('#/business/extra')).toEqual({ area: 'not-found' });
  });

  it('selects personal sections from the dashboard hash', () => {
    expect(dashboardSection('#/dashboard')).toBe('overview');
    for (const value of [
      'wallet',
      'purchases',
      'payments',
      'refunds',
      'trips',
      'calendar',
      'rewards',
    ]) {
      expect(dashboardSection(`#/dashboard?section=${value}`)).toBe(value);
    }
    expect(dashboardSection('#/dashboard?section=unknown')).toBe('overview');
  });

  it('open a trip by its id, even one that needs encoding, and My trips at #/trips', () => {
    expect(route(travellerHref.trip('trip-ok'))).toEqual({ area: 'trip', id: 'trip-ok' });
    expect(route(travellerHref.trip('a/b c'))).toEqual({ area: 'trip', id: 'a/b c' });
    expect(route(travellerHref.trips)).toEqual({ area: 'trips' });
  });

  it('open the city live at #/explore', () => {
    expect(route(travellerHref.explore)).toEqual({ area: 'explore' });
    expect(route('#/explore/x')).toEqual({ area: 'not-found' });
  });

  it('opens the ticket catalogue and demo wallet on separate addresses', () => {
    expect(route(travellerHref.tickets)).toEqual({ area: 'tickets', wallet: false });
    expect(route(travellerHref.ticketWallet)).toEqual({ area: 'tickets', wallet: true });
    expect(route('#/tickets/other')).toEqual({ area: 'not-found' });
  });

  it('open the credits at their address in either language', () => {
    expect(travellerHref.credits('en')).toBe('#/credits');
    expect(travellerHref.credits('es')).toBe('#/creditos');
    expect(route(travellerHref.credits('en'))).toEqual({ area: 'credits' });
    expect(route(travellerHref.credits('es'))).toEqual({ area: 'credits' });
  });

  it('keep the control room at #/ops with its own segments', () => {
    expect(route('#/ops')).toEqual({ area: 'ops', segments: [] });
    expect(route('#/ops/sources/mta-alerts')).toEqual({
      area: 'ops',
      segments: ['sources', 'mta-alerts'],
    });
  });

  it('say not found for anything else', () => {
    expect(route('#/trip')).toEqual({ area: 'not-found' });
    expect(route('#/trip/a/b')).toEqual({ area: 'not-found' });
    expect(route('#/trip/%E0%A4%A')).toEqual({ area: 'not-found' });
    expect(route('#/plan/x')).toEqual({ area: 'not-found' });
    expect(route('#/trips/x')).toEqual({ area: 'not-found' });
    expect(route('#/credits/x')).toEqual({ area: 'not-found' });
    expect(route('#/constructor')).toEqual({ area: 'not-found' });
    expect(route('#/main')).toEqual({ area: 'not-found' });
    expect(route('#/nope')).toEqual({ area: 'not-found' });
  });
});

describe("the traveller's navigation", () => {
  it('marks the panel for personal areas, Agents and the live map', () => {
    expect(section(travellerHref.dashboard)).toBe('dashboard');
    expect(section(travellerHref.trips)).toBe('dashboard');
    expect(section(travellerHref.trip('trip-ok'))).toBe('dashboard');
    expect(section(travellerHref.rewards)).toBe('dashboard');
    expect(section(travellerHref.ticketWallet)).toBe('dashboard');
    expect(section(travellerHref.agents)).toBe('agents');
    expect(section(travellerHref.explore)).toBe('explore');
    expect(section(travellerHref.home)).toBeNull();
  });

  it('marks nothing on the credits, nor on the control room, which is not for travellers', () => {
    expect(section(travellerHref.credits('en'))).toBeNull();
    expect(section('#/ops')).toBeNull();
    expect(section('#/ops/sources')).toBeNull();
  });
});
