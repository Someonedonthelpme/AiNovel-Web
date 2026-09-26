/**
 * A building's footprint is a combination of modules (DESIGN 6c §3f), not a
 * fixed shape: a module holds 1-3 workstations, and growing eats the
 * settlement's plot budget. Tile shapes and positions aren't decided yet —
 * this is the resource accounting underneath them.
 */

const WORKSTATIONS_PER_MODULE = 3;

/** How many modules pack `workstationCount` workstations, 1-3 each. */
export function modulesNeeded(workstationCount: number): number {
  return Math.ceil(workstationCount / WORKSTATIONS_PER_MODULE);
}

/** Does upgrading from `currentModules` to `nextModules` fit within `freePlots`? Only the delta is charged. */
export function canUpgrade(currentModules: number, nextModules: number, freePlots: number): boolean {
  return nextModules - currentModules <= freePlots;
}
