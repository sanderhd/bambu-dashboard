export const STATES: Record<string, string> = {
  IDLE: 'Idle', PREPARE: 'Preparing', RUNNING: 'Printing', PAUSE: 'Paused',
  FINISH: 'Finished', FAILED: 'Failed / stopped', SLICING: 'Slicing',
};

export const STAGES: Record<number, string> = {
  1: 'Auto bed leveling', 2: 'Heating bed', 3: 'Vibration compensation', 4: 'Changing filament', 5: 'M400 pause',
  6: 'Paused: filament runout', 7: 'Heating hotend', 8: 'Calibrating extrusion', 9: 'Scanning bed surface', 10: 'Inspecting first layer',
  11: 'Identifying build plate', 12: 'Calibrating micro lidar', 13: 'Homing toolhead', 14: 'Cleaning nozzle tip', 15: 'Checking extruder temperature',
  16: 'Paused by user', 17: 'Paused: front cover fell off', 18: 'Calibrating micro lidar', 19: 'Calibrating extrusion flow', 20: 'Paused: nozzle temperature malfunction',
  21: 'Paused: bed temperature malfunction', 22: 'Unloading filament', 23: 'Paused: skipped step', 24: 'Loading filament', 25: 'Calibrating motor noise',
  26: 'Paused: AMS lost', 27: 'Paused: heatbreak fan too slow', 28: 'Paused: chamber temperature control error', 29: 'Cooling chamber',
  30: 'Paused by G-code', 31: 'Motor noise showoff', 32: 'Paused: nozzle covered in filament', 33: 'Paused: cutter error',
  34: 'Paused: first layer error', 35: 'Paused: nozzle clog',
};

export const SPEEDS: Record<number, string> = { 1: 'Silent', 2: 'Standard', 3: 'Sport', 4: 'Ludicrous' };

export function fmtDur(min?: number | null) {
  if (min == null || isNaN(min)) return '–';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export const fanPct = (v?: string) => (v == null ? null : Math.round((Number(v) / 15) * 10) * 10);
export const deg = (v?: number) => (v == null ? '–' : `${Math.round(v)}°`);

export function hmsCode(h: { attr: number; code: number }) {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
  return `${hex(h.attr >>> 16)}_${hex(h.attr & 0xffff)}_${hex(h.code >>> 16)}_${hex(h.code & 0xffff)}`;
}
