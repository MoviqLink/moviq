import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import protobuf from 'protobufjs';
import { z } from 'zod';

/** The official GTFS Realtime schema, vendored with its Apache 2.0 licence. */
const PROTO_PATH = fileURLToPath(
  new URL('../../../../vendor/gtfs-realtime.proto', import.meta.url),
);

let feedMessageType: protobuf.Type | undefined;

function feedMessage(): protobuf.Type {
  feedMessageType ??= protobuf
    .parse(readFileSync(PROTO_PATH, 'utf8'), { keepCase: true })
    .root.lookupType('transit_realtime.FeedMessage');
  return feedMessageType;
}

const timestamp = z.number().int().nonnegative();
const translated = z
  .object({
    translation: z
      .array(z.object({ text: z.string(), language: z.string().optional() }))
      .default([]),
  })
  .optional();

const tripSchema = z.object({
  trip_id: z.string().optional(),
  route_id: z.string().optional(),
  direction_id: z.number().int().optional(),
  start_time: z.string().optional(),
  start_date: z.string().optional(),
  schedule_relationship: z.string().optional(),
});

const stopTimeEvent = z
  .object({ time: timestamp.optional(), delay: z.number().int().optional() })
  .optional();

const entitySchema = z.object({
  id: z.string(),
  is_deleted: z.boolean().optional(),
  trip_update: z
    .object({
      trip: tripSchema,
      vehicle: z.object({ id: z.string().optional(), label: z.string().optional() }).optional(),
      stop_time_update: z
        .array(
          z.object({
            stop_sequence: z.number().int().optional(),
            stop_id: z.string().optional(),
            arrival: stopTimeEvent,
            departure: stopTimeEvent,
            schedule_relationship: z.string().optional(),
          }),
        )
        .default([]),
      timestamp: timestamp.optional(),
      delay: z.number().int().optional(),
    })
    .optional(),
  vehicle: z
    .object({
      trip: tripSchema.optional(),
      vehicle: z.object({ id: z.string().optional(), label: z.string().optional() }).optional(),
      position: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
          bearing: z.number().optional(),
          speed: z.number().optional(),
        })
        .optional(),
      current_stop_sequence: z.number().int().optional(),
      stop_id: z.string().optional(),
      current_status: z.string().optional(),
      timestamp: timestamp.optional(),
    })
    .optional(),
  alert: z
    .object({
      active_period: z
        .array(z.object({ start: timestamp.optional(), end: timestamp.optional() }))
        .default([]),
      informed_entity: z
        .array(
          z.object({
            agency_id: z.string().optional(),
            route_id: z.string().optional(),
            stop_id: z.string().optional(),
            trip: tripSchema.optional(),
          }),
        )
        .default([]),
      cause: z.string().optional(),
      effect: z.string().optional(),
      header_text: translated,
      description_text: translated,
    })
    .optional(),
});

const feedSchema = z.object({
  header: z.object({
    gtfs_realtime_version: z.string(),
    incrementality: z.string().optional(),
    timestamp: timestamp.optional(),
  }),
  entity: z.array(entitySchema).default([]),
});

/** The parts of a GTFS Realtime feed MovIQ reads, validated after decoding. */
export type GtfsRealtimeFeed = z.infer<typeof feedSchema>;

export type DecodeResult =
  | { readonly ok: true; readonly feed: GtfsRealtimeFeed }
  | {
      readonly ok: false;
      readonly code: 'not-protobuf' | 'unexpected-shape';
      readonly detail: string;
    };

/**
 * Decodes a GTFS Realtime protobuf. Enums come back as their names, 64-bit numbers as numbers,
 * and unknown extensions are ignored. Bad input is reported, never thrown.
 */
export function decodeGtfsRealtime(body: Uint8Array): DecodeResult {
  let plain: unknown;
  try {
    const type = feedMessage();
    plain = type.toObject(type.decode(body), { enums: String, longs: Number, defaults: false });
  } catch (error) {
    return {
      ok: false,
      code: 'not-protobuf',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const parsed = feedSchema.safeParse(plain);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      code: 'unexpected-shape',
      detail: `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
    };
  }
  return { ok: true, feed: parsed.data };
}

/** Encodes a feed, for tests that need protobuf input built from plain objects. */
export function encodeGtfsRealtime(feed: unknown): Uint8Array {
  const type = feedMessage();
  return type.encode(type.fromObject(feed as Record<string, unknown>)).finish();
}
