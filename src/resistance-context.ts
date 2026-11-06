import * as z from 'zod';
import type { ActualLoad, Load } from './domain.js';

export const resistanceEvidenceSchema = z.strictObject({
  kind: z.enum(['manufacturer', 'measurement', 'athlete_report', 'athlete_confirmation', 'inference']),
  reference: z.string().max(1_000).optional(),
  notes: z.string().max(2_000).optional(),
});
export type ResistanceEvidence = z.infer<typeof resistanceEvidenceSchema>;
const contextFields = {
  setup_key: z.string().trim().min(1).max(200).optional().describe('Setup identity scoped to this athlete and venue; never a global apparatus identity.'),
  source: resistanceEvidenceSchema,
};
export const resistanceContextSchema = z.discriminatedUnion('reading_kind', [
  z.strictObject({
    reading_kind: z.literal('stack_setting'), ...contextFields,
    transmission: z.strictObject({
      handle_force_per_stack_weight: z.number().finite().positive(),
      source: resistanceEvidenceSchema,
    }).optional().describe('Sourced constant transmission only. Position-dependent mechanics remain prose or device profiles.'),
  }),
  z.strictObject({ reading_kind: z.literal('external_mass'), ...contextFields }),
  z.strictObject({ reading_kind: z.literal('device_setting'), ...contextFields }),
  z.strictObject({ reading_kind: z.literal('measured_force'), ...contextFields }),
]);
export type ResistanceContext = z.infer<typeof resistanceContextSchema>;
export type NominalHandleForce = {
  reading_kind: 'derived_nominal_handle_force';
  value: number;
  unit: 'lbf' | 'N';
  input: { load: Extract<Load, { type: 'absolute' }>; context: ResistanceContext };
  method: 'constant_stack_transmission';
  assumptions: ['quasi_static', 'frictionless'];
};

/** Read projection only: preserves raw load, basis and evidence, never estimates muscular load. */
export function nominalHandleForce(load: ActualLoad | Load | undefined, context: ResistanceContext | undefined): NominalHandleForce | undefined {
  if (load?.type !== 'absolute' || context?.reading_kind !== 'stack_setting' || !context.transmission) return undefined;
  const factor = context.transmission.handle_force_per_stack_weight;
  if (!Number.isFinite(load.value) || load.value < 0 || !Number.isFinite(factor) || factor <= 0) return undefined;
  const value = load.value * factor * (load.unit === 'kg' ? 9.80665 : 1);
  if (!Number.isFinite(value)) return undefined;
  return {
    reading_kind: 'derived_nominal_handle_force', value, unit: load.unit === 'kg' ? 'N' : 'lbf',
    input: { load: structuredClone(load), context: structuredClone(context) },
    method: 'constant_stack_transmission', assumptions: ['quasi_static', 'frictionless'],
  };
}
