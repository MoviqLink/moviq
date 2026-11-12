import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import {
  DAY,
  HTTP_FAILURES,
  MINUTE,
  MTA_FEEDS_URL,
  MTA_LICENCE,
  MTA_PROVIDER,
  count,
} from '../mta/provider.js';
import { listFailures, readJsonList } from './json-list.js';

const yesNo = z.enum(['Y', 'N']).transform((value) => value === 'Y');

/** One row of `nyct_ene_equipments.json`, the fields read. */
const equipmentRow = z.object({
  equipmentno: z.string().min(1),
  equipmenttype: z.enum(['EL', 'ES']),
  ADA: yesNo,
  isactive: yesNo,
  redundant: z.union([z.literal(0), z.literal(1)]),
  /** The GTFS stations it serves, `/` between them (`A31/L01`). */
  elevatorsgtfsstopid: z.string(),
});

const equipmentSchema = z.object({
  kind: z.enum(['elevator', 'escalator']),
  /** Part of the step-free path of its stations. */
  ada: z.boolean(),
  active: z.boolean(),
  /** Another elevator serves the same path, so an outage of this one keeps the path open. */
  redundant: z.boolean(),
  /** GTFS station ids. */
  stations: z.array(z.string().regex(/^[0-9A-Z]{3}$/)),
});

const elevatorEquipmentSchema = z.object({
  readAt: instantSchema,
  /** By the equipment id the outages feed names (`EL293`). */
  equipment: z.record(z.string().min(1), equipmentSchema),
});

export type ElevatorEquipment = z.infer<typeof elevatorEquipmentSchema>;

/** 707 pieces on 11/11/2026, 430 of them elevators. */
const MINIMUM_ELEVATORS = 350;

function elevatorCount(data: ElevatorEquipment): number {
  return Object.values(data.equipment).filter((piece) => piece.kind === 'elevator').length;
}

function parseEquipment(body: Uint8Array, receivedAt: Date): ParseResult<ElevatorEquipment> {
  const read = readJsonList(body, z.array(equipmentRow));
  if (!read.ok) return read;
  const equipment: ElevatorEquipment['equipment'] = {};
  for (const row of read.rows) {
    if (equipment[row.equipmentno] !== undefined) {
      return { ok: false, code: 'check-failed', detail: `equipment ${row.equipmentno} twice` };
    }
    const stations = row.elevatorsgtfsstopid.split('/').map((id) => id.trim());
    equipment[row.equipmentno] = {
      kind: row.equipmenttype === 'EL' ? 'elevator' : 'escalator',
      ada: row.ADA,
      active: row.isactive,
      redundant: row.redundant === 1,
      stations: stations.filter((id) => id !== ''),
    };
  }
  const data = { readAt: toInstant(receivedAt), equipment };
  const pieces = count(Object.keys(equipment).length, 'pieces');
  return {
    ok: true,
    data,
    dataTime: receivedAt,
    coverage: `${pieces}, ${count(elevatorCount(data), 'elevators')}${inactiveNote(equipment)}`,
  };
}

/** Step-free elevators the list itself marks inactive, named for operators. */
function inactiveNote(equipment: ElevatorEquipment['equipment']): string {
  const inactive = Object.entries(equipment)
    .filter(([, piece]) => piece.kind === 'elevator' && piece.ada && !piece.active)
    .map(([id]) => id)
    .sort();
  return inactive.length === 0 ? '' : `; ADA elevators marked inactive: ${inactive.join(', ')}`;
}

/**
 * Every subway elevator and escalator with the GTFS stations it serves: the join from an outage
 * of `mta/elevators.ts` (which names only the equipment and the station by name) to the timetable.
 */
export const mtaElevatorEquipment: SourceDefinition<ElevatorEquipment> = {
  id: 'mta-elevator-equipment',
  title: 'MTA subway elevators and escalators',
  provider: MTA_PROVIDER,
  licence: MTA_LICENCE,
  kind: 'static',
  // Equipment is added or replaced a few times a year; one read a day follows it.
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 4 * 1024 * 1024 },
  // The answer has no date, no Last-Modified and no ETag (11/11/2026).
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: elevatorEquipmentSchema,
  request() {
    return { url: `${MTA_FEEDS_URL}nyct%2Fnyct_ene_equipments.json` };
  },
  parse(body, context) {
    return parseEquipment(body, context.receivedAt);
  },
  check(data) {
    const elevators = elevatorCount(data);
    return elevators < MINIMUM_ELEVATORS
      ? [`${count(elevators, 'elevators')}, minimum ${String(MINIMUM_ELEVATORS)}`]
      : [];
  },
  consumers: ['step-free'],
  failures: listFailures(HTTP_FAILURES, `Fewer than ${String(MINIMUM_ELEVATORS)} elevators`),
};
