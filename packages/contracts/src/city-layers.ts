import { z } from 'zod';

import { cityGroupSchema, cityItemSchema, cityLayerIdSchema } from './city-items.js';
import { boundingBoxSchema, liveSourceSchema } from './live.js';
import { sourceStateSchema } from './sources.js';
import { instantSchema } from './time.js';

const text = z.string().min(1);
const count = z.number().int().nonnegative();

/**
 * - `live`: every source of the layer is healthy;
 * - `degraded`: something is shown, but a source of the layer is late, stale or down;
 * - `unavailable`: no source of the layer has usable data, so nothing of it is shown.
 */
export const cityLayerStatusSchema = z.enum(['live', 'degraded', 'unavailable']);

export type CityLayerStatus = z.infer<typeof cityLayerStatusSchema>;

export const cityLayerSummarySchema = z.object({
  layer: cityLayerIdSchema,
  group: cityGroupSchema,
  status: cityLayerStatusSchema,
  /** Items of the layer in the whole city now, drawn or listed. */
  count,
  /** The same count split as the layer's sources split it (street permits by borough). */
  breakdown: z.array(z.object({ label: text, count })),
  /** Items the sources listed without what the layer needs to show them, so left out. */
  leftOut: count,
  sourceIds: z.array(text),
});

export type CityLayerSummary = z.infer<typeof cityLayerSummarySchema>;

/** `GET /api/city/layers?layers=a,b&bbox=w,s,e,n`: every layer counted, those asked served. */
export const cityLayersResponseSchema = z.object({
  generatedAt: instantSchema,
  bbox: boundingBoxSchema.nullable(),
  /** The layers asked for, whose items are in `items`. */
  asked: z.array(cityLayerIdSchema),
  layers: z.array(cityLayerSummarySchema),
  items: z.array(cityItemSchema),
  /** Layers asked with more items in the box than one answer carries: zoom in to see them. */
  capped: z.array(z.object({ layer: cityLayerIdSchema, inBox: count })),
  sources: z.array(liveSourceSchema),
});

export type CityLayersResponse = z.infer<typeof cityLayersResponseSchema>;

/** `GET /api/city/parking-signs?lat=&lon=`: the signs of the tile around a point, asked once. */
export const parkingSignsResponseSchema = z.object({
  generatedAt: instantSchema,
  items: z.array(cityItemSchema),
  source: z.object({
    title: text,
    attribution: text,
    state: sourceStateSchema,
    /** What was asked and what came back, or why nothing did. */
    evidence: text,
  }),
});

export type ParkingSignsResponse = z.infer<typeof parkingSignsResponseSchema>;

/**
 * The headers of `GET /api/city/cameras/<id>/image`: the time of the picture, and whether that
 * time is the owner's (`source`, its `Last-Modified`) or the moment MovIQ received it.
 */
export const CAMERA_IMAGE_HEADERS = { time: 'x-image-time', basis: 'x-image-time-basis' } as const;

export const cameraImageTimeBasisSchema = z.enum(['source', 'received']);

export type CameraImageTimeBasis = z.infer<typeof cameraImageTimeBasisSchema>;

/**
 * The body of a `503` of the picture route: the camera did not send a picture (`camera-down`),
 * 511NY's list of cameras is not available (`list-unavailable`) or too many pictures were asked
 * within the minute (`busy`).
 */
export const cameraImageFailureSchema = z.object({
  reason: z.enum(['camera-down', 'list-unavailable', 'busy']),
  message: text,
});

export type CameraImageFailure = z.infer<typeof cameraImageFailureSchema>;
