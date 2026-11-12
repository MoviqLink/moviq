import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { DAY, MINUTE, MTA_PROVIDER, count } from '../mta/provider.js';
import { listFailures, readJsonList } from './json-list.js';
import { PORTAL_FAILURES } from './portal.js';

/** `service_status_code`: installed, functioning and in service; any other code is not. */
export const IN_SERVICE = 'IFIS';

const LEVELS = ['access', 'street', 'mezzanine', 'platform'] as const;

/** One row of the MTA elevator and escalator inventory on data.ny.gov, the columns asked for. */
const inventoryRow = z.object({
  equipment_code: z.string().min(1),
  elevator_or_escalator: z.enum(['Elevator', 'Escalator']),
  ada_compliant: z.enum(['YES', 'NO']).optional(),
  service_status_code: z.string().regex(/^[A-Z]{4}$/),
  redundant_elevator_access: z.string().optional(),
  redundant_elevator_street: z.string().optional(),
  redundant_elevator_mezzanine: z.string().optional(),
  redundant_elevator_platform: z.string().optional(),
});

type InventoryRow = z.infer<typeof inventoryRow>;

const codes = z.array(z.string().min(1));
const backupsSchema = z.object({ access: codes, street: codes, mezzanine: codes, platform: codes });

const pieceSchema = z.object({
  kind: z.enum(['elevator', 'escalator']),
  /** `ada_compliant`, or null where the inventory does not say. */
  ada: z.boolean().nullable(),
  /** `service_status_code`: `IFIS` in service; `IFOS`, `INOS` out of service; `RNOS` removed. */
  status: z.string().regex(/^[A-Z]{4}$/),
  /**
   * The elevators that give the same access in its place, by level: from the street, at the
   * mezzanine, at the platform, and `access` for the whole path. Empty where none is listed.
   */
  backups: backupsSchema,
});

const elevatorInventorySchema = z.object({
  readAt: instantSchema,
  /** By the equipment code the outages feed and the equipment list name (`EL232`). */
  equipment: z.record(z.string().min(1), pieceSchema),
});

export type ElevatorInventory = z.infer<typeof elevatorInventorySchema>;
type InventoryPiece = z.infer<typeof pieceSchema>;

/** 759 pieces on 11/11/2026, 482 of them elevators; a list with far fewer is cut. */
const MINIMUM_ELEVATORS = 400;

/** "108, 109, 110", "718X/716", "17X+" or "EL204, EL296" as equipment codes (`EL108`). */
function backupCodes(text: string | undefined): string[] {
  return (text ?? '')
    .split(/[,/]/)
    .map((part) => part.trim().replace(/\+$/, ''))
    .filter((part) => part !== '')
    .map((part) => (part.startsWith('EL') ? part : `EL${part}`));
}

function pieceOf(row: InventoryRow): InventoryPiece {
  return {
    kind: row.elevator_or_escalator === 'Elevator' ? 'elevator' : 'escalator',
    ada: row.ada_compliant === undefined ? null : row.ada_compliant === 'YES',
    status: row.service_status_code,
    backups: {
      access: backupCodes(row.redundant_elevator_access),
      street: backupCodes(row.redundant_elevator_street),
      mezzanine: backupCodes(row.redundant_elevator_mezzanine),
      platform: backupCodes(row.redundant_elevator_platform),
    },
  };
}

function elevatorCount(data: ElevatorInventory): number {
  return Object.values(data.equipment).filter((piece) => piece.kind === 'elevator').length;
}

/** ADA elevators the inventory gives as not in service, named for operators. */
function outOfServiceNote(equipment: ElevatorInventory['equipment']): string {
  const out = Object.entries(equipment)
    .filter(([, piece]) => piece.kind === 'elevator' && piece.ada === true)
    .filter(([, piece]) => piece.status !== IN_SERVICE)
    .map(([id]) => id)
    .sort();
  return out.length === 0 ? '' : `; ADA elevators not in service: ${out.join(', ')}`;
}

function parseInventory(body: Uint8Array, receivedAt: Date): ParseResult<ElevatorInventory> {
  const read = readJsonList(body, z.array(inventoryRow));
  if (!read.ok) return read;
  const equipment: ElevatorInventory['equipment'] = {};
  for (const row of read.rows) {
    if (equipment[row.equipment_code] !== undefined) {
      return { ok: false, code: 'check-failed', detail: `equipment ${row.equipment_code} twice` };
    }
    equipment[row.equipment_code] = pieceOf(row);
  }
  const data = { readAt: toInstant(receivedAt), equipment };
  const pieces = count(Object.keys(equipment).length, 'pieces');
  return {
    ok: true,
    data,
    dataTime: receivedAt,
    coverage: `${pieces}, ${count(elevatorCount(data), 'elevators')}${outOfServiceNote(equipment)}`,
  };
}

/**
 * The MTA inventory of subway elevators and escalators on data.ny.gov (`94fv-bak7`): whether each
 * piece is installed and in service, and which elevators stand in for it. Joined to the equipment
 * list by equipment code, it is checked against, never in place of, the outages feed.
 */
export const mtaElevatorInventory: SourceDefinition<ElevatorInventory> = {
  id: 'mta-elevator-inventory',
  title: 'MTA subway elevator and escalator inventory',
  provider: MTA_PROVIDER,
  licence: {
    name: 'MTA Open Data on data.ny.gov',
    url: 'https://www.mta.info/open-data',
    attribution:
      'MTA Elevator and Escalator Inventory, Metropolitan Transportation Authority (data.ny.gov)',
  },
  kind: 'static',
  // Last changed on 10/11/2026 at 11:29 UTC; pieces are removed and installed a few times a month.
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 2 * 1024 * 1024 },
  // The rows carry no time; the Last-Modified of the portal does not reach the parser.
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: elevatorInventorySchema,
  request() {
    const select = [
      'equipment_code',
      'elevator_or_escalator',
      'ada_compliant',
      'service_status_code',
      ...LEVELS.map((level) => `redundant_elevator_${level}`),
    ].join(',');
    return {
      url: `https://data.ny.gov/resource/94fv-bak7.json?$select=${select}&$order=equipment_code&$limit=5000`,
    };
  },
  parse(body, context) {
    return parseInventory(body, context.receivedAt);
  },
  check(data) {
    const elevators = elevatorCount(data);
    return elevators < MINIMUM_ELEVATORS
      ? [`${count(elevators, 'elevators')}, minimum ${String(MINIMUM_ELEVATORS)}`]
      : [];
  },
  consumers: ['step-free'],
  failures: listFailures(PORTAL_FAILURES, `Fewer than ${String(MINIMUM_ELEVATORS)} elevators`),
};
