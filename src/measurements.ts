import * as z from 'zod';
import { util } from 'zod/v4/core';

export const MAX_TRACE_SAMPLES = 10_000;
export const MAX_REP_POSITION = 1_000_000;
export const MAX_REP_DEVICES = 8;
export const MAX_DEVICES = 100;
const finiteNumber = z.number().finite();
const nonnegativeNumber = finiteNumber.nonnegative();
const loadUnitSchema = z.enum(['lb', 'kg']);
const adjustmentUnitSchema = z.enum(['lb', 'kg', 'percent'])
  .describe('Fixed load or percentage of this device\'s base load; 20 percent means +20%, not a fraction.');
const forceUnitSchema = z.enum(['lbf', 'N']);
const loadValueSchema = z.strictObject({ value: nonnegativeNumber, unit: loadUnitSchema });
const signedAdjustmentSchema = z.strictObject({ value: finiteNumber, unit: adjustmentUnitSchema });
const deviceIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);

export const deviceSchema = z.strictObject({
  id: deviceIdSchema,
  name: z.string().min(1).max(200),
  provider: z.string().min(1).max(100).optional(),
  external_id: z.string().min(1).max(1_000).optional(),
  model: z.string().min(1).max(200).optional(),
}).describe('Inline identity of a physical measurement device. '
  + 'The stable ID identifies a unit independently of its current mount or side. No registry entry is required.');
export type Device = z.infer<typeof deviceSchema>;
export const devicesSchema = z.array(deviceSchema).max(MAX_DEVICES).superRefine((devices, context) => {
  const seen = new Set<string>();
  devices.forEach((device, index) => {
    if (seen.has(device.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Each physical unit may appear only once' });
    seen.add(device.id);
  });
});

export const observationSourceSchema = z.strictObject({
  provider: z.string().min(1).max(100),
  record_id: z.string().min(1).max(1_000),
}).describe('Identity in the source system, scoped to the provider; not an execution timestamp.');

const weightTrainingSchema = z.strictObject({
  mode: z.literal('weight_training'),
  base_load: loadValueSchema,
  eccentric_adjustment: signedAdjustmentSchema.optional(),
  chains: z.strictObject({ value: nonnegativeNumber, unit: adjustmentUnitSchema, direction: z.enum(['normal', 'inverse', 'mountain']).optional() })
    .describe('Named resistance shape and adjustment amount. Mountain records a rise and fall without inventing curve geometry. '
      + 'Omitted direction means unknown; control adapters must verify capabilities separately.').optional(),
});
const curvePointSchema = z.strictObject({ position: nonnegativeNumber, load: nonnegativeNumber });
const curvePointsSchema = z.array(curvePointSchema).min(2).max(1_000);
const customCurveSchema = z.strictObject({
  mode: z.literal('custom_curve'),
  position_unit: z.enum(['m', 'fraction']),
  load_unit: loadUnitSchema,
  concentric_points: curvePointsSchema.optional(),
  eccentric_points: curvePointsSchema.optional(),
  source: observationSourceSchema.optional(),
}).superRefine((curve, context) => {
  if (!curve.concentric_points && !curve.eccentric_points) {
    context.addIssue({ code: 'custom', message: 'A custom curve requires at least one phase of points' });
  }
  for (const phase of ['concentric_points', 'eccentric_points'] as const) {
    const points = curve[phase];
    if (!points) continue;
    for (let index = 0; index < points.length; index++) {
      const point = points[index]!;
      if (curve.position_unit === 'fraction' && point.position > 1) {
        context.addIssue({ code: 'custom', path: [phase, index, 'position'], message: 'Fractional positions must be between 0 and 1' });
      }
      if (index > 0 && point.position <= points[index - 1]!.position) {
        context.addIssue({ code: 'custom', path: [phase, index, 'position'], message: 'Curve positions must be strictly increasing within each phase' });
      }
    }
  }
}).describe('Immutable curve geometry: at least one phase with 2–1,000 points in strictly increasing position order; fractional positions are in [0, 1].');

export const resistanceProfileSchema = z.discriminatedUnion('mode', [
  weightTrainingSchema,
  z.strictObject({ mode: z.literal('resistance_band'), load: loadValueSchema }),
  z.strictObject({ mode: z.literal('damper'), level: nonnegativeNumber }),
  z.strictObject({ mode: z.literal('isokinetic'), target_speed_meters_per_second: finiteNumber.positive() }),
  z.strictObject({
    mode: z.literal('isometric'),
    position_meters: nonnegativeNumber.optional(),
    target_force: z.strictObject({ value: nonnegativeNumber, unit: forceUnitSchema }).optional(),
  }),
  customCurveSchema,
  z.strictObject({ mode: z.literal('rowing'), damper_level: nonnegativeNumber.optional() }),
  z.strictObject({ mode: z.literal('skiing'), damper_level: nonnegativeNumber.optional() }),
]).describe('Mode-specific resistance settings for prescriptions or observations. '
  + 'Historical values are not constrained by current vendor command limits. Settings are independent of measured force.');
export type ResistanceProfile = z.infer<typeof resistanceProfileSchema>;

export const deviceResistanceSchema = z.array(z.strictObject({
  device_id: deviceIdSchema,
  resistance: resistanceProfileSchema,
})).min(1).max(MAX_REP_DEVICES).superRefine(uniqueDevices)
  .describe('Explicit resistance settings for unique physical devices selected by the containing step or set. '
    + 'Planned settings are not inherited into actual logs; no total load or pairing is inferred.');
export type DeviceResistance = z.infer<typeof deviceResistanceSchema>;

const samplesSchema = z.array(finiteNumber).min(1).max(MAX_TRACE_SAMPLES);
export const traceSchema = z.strictObject({
  force_unit: forceUnitSchema.optional(),
  force: samplesSchema.optional(),
  velocity_meters_per_second: samplesSchema.optional(),
  power_watts: samplesSchema.optional(),
  sample_interval_seconds: finiteNumber.positive().optional(),
  time_seconds: z.array(nonnegativeNumber).min(1).max(MAX_TRACE_SAMPLES).optional(),
}).superRefine((trace, context) => {
  const channels = ['force', 'velocity_meters_per_second', 'power_watts'] as const;
  const suppliedChannels = channels.filter((channel) => trace[channel] !== undefined);
  if (suppliedChannels.length === 0) {
    context.addIssue({ code: 'custom', message: 'A trace requires at least one measurement channel' });
  }
  if (trace.force !== undefined && trace.force_unit === undefined) {
    context.addIssue({ code: 'custom', path: ['force_unit'], message: 'Force samples require an explicit force unit' });
  }
  const sampleCount = suppliedChannels.length > 0 ? trace[suppliedChannels[0]!]!.length : undefined;
  for (const channel of [...suppliedChannels, 'time_seconds'] as const) {
    if (trace[channel] !== undefined && trace[channel].length !== sampleCount) {
      context.addIssue({ code: 'custom', path: [channel], message: 'All supplied channels and sample times must have equal lengths within a phase' });
    }
  }
  if (trace.sample_interval_seconds !== undefined && trace.time_seconds !== undefined) {
    context.addIssue({ code: 'custom', path: ['time_seconds'], message: 'Supply either a sample interval or explicit sample times, not both' });
  }
  if (trace.time_seconds) {
    for (let index = 1; index < trace.time_seconds.length; index++) {
      if (trace.time_seconds[index]! <= trace.time_seconds[index - 1]!) {
        context.addIssue({ code: 'custom', path: ['time_seconds', index], message: 'Sample times must be strictly increasing' });
      }
    }
  }
}).describe('Signed phase samples in source order. At least one channel; supplied channels and times align, with 1–10,000 samples. '
  + 'Force requires lbf or N. Timing is optional and never inferred; supply either interval or increasing relative times.');
export type Trace = z.infer<typeof traceSchema>;

const unsafeMetricNames = new Set(['__proto__', 'prototype', 'constructor']);
const metricNameSchema = z.string().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9_]*$/)
  .refine((name) => !unsafeMetricNames.has(name));
export const repMetricsSchema = z.preprocess((value, context) => {
  if (util.isPlainObject(value)) {
    for (const name of Object.keys(value)) {
      if (!metricNameSchema.safeParse(name).success) {
        context.addIssue({ code: 'custom', path: [name], message: 'Metric names must be safe identifiers of 1–100 characters' });
      }
    }
  }
  return value;
}, z.object({
  range_of_motion_meters: nonnegativeNumber.optional(),
  duration_seconds: nonnegativeNumber.optional(),
  mean_velocity_meters_per_second: finiteNumber.optional(),
  peak_velocity_meters_per_second: finiteNumber.optional(),
  mean_power_watts: finiteNumber.optional(),
  peak_power_watts: finiteNumber.optional(),
  work_joules: finiteNumber.optional(),
  peak_power_position_meters: nonnegativeNumber.optional(),
  peak_velocity_position_meters: nonnegativeNumber.optional(),
}).catchall(finiteNumber)).describe('Finite numeric observations; custom names include units. '
  + 'Duration preserves source scope, which may cover only one movement phase. '
  + 'Velocity, power and work retain source signs or magnitudes without inferring a sign from movement phase.');

const nonemptyRepMetricsSchema = repMetricsSchema.refine(
  (metrics) => Object.values(metrics).some((value) => value !== undefined),
  'A measured phase requires at least one numeric observation',
);
export const phaseMetricsSchema = z.strictObject({
  concentric: nonemptyRepMetricsSchema.optional(),
  eccentric: nonemptyRepMetricsSchema.optional(),
}).refine((phases) => phases.concentric !== undefined || phases.eccentric !== undefined, 'Supply at least one phase when phase metrics are present')
  .describe('Separate concentric and eccentric scalar summaries, each with at least one metric. '
    + 'Preserve source signs, including positive recovery magnitudes.');

const repTracesSchema = z.strictObject({
  concentric: traceSchema.optional(),
  eccentric: traceSchema.optional(),
}).refine((traces) => traces.concentric !== undefined || traces.eccentric !== undefined, 'Supply at least one phase when traces are present')
  .describe('Independent concentric/eccentric phases, which may have different sample counts.');

const deviceObservationFieldsSchema = z.strictObject({
  device_id: deviceIdSchema,
  resistance: resistanceProfileSchema.optional(),
  metrics: repMetricsSchema.optional(),
  phase_metrics: phaseMetricsSchema.optional(),
  traces: repTracesSchema.optional(),
});
export const deviceObservationSchema = deviceObservationFieldsSchema.refine((observation) =>
  observation.resistance !== undefined || observation.traces !== undefined || observation.phase_metrics !== undefined
    || Object.keys(observation.metrics ?? {}).length > 0,
'A device observation requires resistance, nonempty metrics, phase metrics, or traces')
  .describe('Per-unit measurements and resistance, with at least one observation field. The device must be selected on the containing set.');
export const deviceObservationSummarySchema = deviceObservationFieldsSchema.omit({ traces: true });
export type DeviceObservation = z.infer<typeof deviceObservationSchema>;

function uniqueDevices(observations: { device_id: string }[], context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (let index = 0; index < observations.length; index++) {
    const deviceId = observations[index]!.device_id;
    if (seen.has(deviceId)) {
      context.addIssue({ code: 'custom', path: [index, 'device_id'], message: 'Each physical unit may appear only once' });
    }
    seen.add(deviceId);
  }
}
const deviceObservationsSchema = z.array(deviceObservationSchema).min(1).max(MAX_REP_DEVICES).superRefine(uniqueDevices);
const deviceObservationSummariesSchema = z.array(deviceObservationSummarySchema).min(1).max(MAX_REP_DEVICES).superRefine(uniqueDevices);

export const repWriteSchema = z.strictObject({
  position: z.number().int().min(1).max(MAX_REP_POSITION),
  metrics: repMetricsSchema.optional(),
  phase_metrics: phaseMetricsSchema.optional(),
  resistance: resistanceProfileSchema.optional(),
  traces: repTracesSchema.optional(),
  device_observations: deviceObservationsSchema.optional(),
  performed_at: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().max(100_000).optional(),
  source: observationSourceSchema.optional(),
});
export const repSummarySchema = repWriteSchema.omit({ traces: true }).extend({ device_observations: deviceObservationSummariesSchema.optional() });
export type RepWrite = z.infer<typeof repWriteSchema>;
export type RepSummary = z.infer<typeof repSummarySchema>;
