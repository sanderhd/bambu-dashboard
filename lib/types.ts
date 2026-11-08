// Types shared between the server and the browser.

export type Tray = {
  id: string;
  tray_type?: string;
  tray_sub_brands?: string;
  tray_color?: string; // RRGGBBAA
  remain?: number; // -1 = unknown
  nozzle_temp_min?: string;
  nozzle_temp_max?: string;
};

export type AmsUnit = {
  id: string;
  humidity?: string; // level 1–5
  humidity_raw?: string; // percentage, newer firmware only
  temp?: string; // °C, "0.0" on AMS lite
  tray?: Tray[];
};

export type PrintState = {
  gcode_state?: string;
  mc_percent?: number;
  mc_remaining_time?: number; // minutes
  layer_num?: number;
  total_layer_num?: number;
  subtask_name?: string;
  gcode_file?: string;
  stg_cur?: number;
  nozzle_temper?: number;
  nozzle_target_temper?: number;
  bed_temper?: number;
  bed_target_temper?: number;
  chamber_temper?: number; // X1 / H2 only
  spd_lvl?: number;
  spd_mag?: number;
  cooling_fan_speed?: string; // 0–15
  heatbreak_fan_speed?: string;
  big_fan1_speed?: string;
  big_fan2_speed?: string;
  wifi_signal?: string;
  nozzle_diameter?: string;
  nozzle_type?: string;
  sdcard?: boolean;
  print_error?: number;
  hms?: { attr: number; code: number }[];
  lights_report?: { node: string; mode: string }[];
  ams?: { tray_now?: string; ams?: AmsUnit[] };
  vt_tray?: Tray;
  modules?: { name: string; sw_ver?: string; hw_ver?: string; sn?: string }[];
  [key: string]: unknown;
};

export type Connection = {
  status: 'demo' | 'connecting' | 'connected' | 'offline' | 'error';
  since: number;
  error: string | null;
};

export type CameraMode = 'jpeg' | 'rtsp' | 'off';

export type PrinterInfo = { model: string; name: string; camera: CameraMode };

/** A camera the user added in Settings: an HTTP MJPEG stream or JPEG snapshot URL. */
export type CameraConfig = { id: string; name: string; type: 'mjpeg'; url: string };

/** A camera as shown in the camera dropdown. `printer` is the printer's built-in camera. */
export type CameraInfo = { id: string; name: string; type: 'printer' | 'mjpeg' };

export type Settings = { cameras: CameraConfig[]; defaultCamera?: string };

export type TempSample = { t: number; nozzle: number; nozzleTarget: number; bed: number; bedTarget: number };

export type PrintJob = {
  name: string;
  result: 'FINISH' | 'FAILED';
  layers: number | null;
  started: number | null;
  ended: number;
  /** Set when the print was counted towards a project part automatically. */
  counted?: { projectId: string; projectName: string; partId: string; partName: string; pieces: number };
};

// ---------------------------------------------------------------- projects

export type FileKind = 'stl' | '3mf' | 'obj' | 'step' | 'gcode';

export type Part = {
  id: string;
  name: string;
  file?: { name: string; size: number; kind: FileKind; uploadedAt: number };
  quantity: number; // pieces needed
  printed: number; // good pieces
  failed: number; // failed pieces (not counted towards printed)
  perPlate: number; // pieces per print, used when counting automatically
  material?: string;
  color?: string; // #rrggbb
  minutesPerPiece?: number;
  gramsPerPiece?: number;
  matchName?: string; // print name to match for automatic counting (defaults to the file name)
  notes?: string;
  createdAt: number;
};

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'done';

export type Activity = { t: number; text: string };

export type Project = {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  autoCount: boolean;
  createdAt: number;
  updatedAt: number;
  parts: Part[];
  activity: Activity[];
};

export type ProjectSummary = Omit<Project, 'parts' | 'activity'> & {
  partCount: number;
  needed: number;
  printed: number;
  failed: number;
  remainingMinutes: number | null;
  remainingGrams: number | null;
};

export type Snapshot = {
  state: PrintState;
  connection: Connection;
  tempHistory: TempSample[];
  printHistory: PrintJob[];
  demo: boolean;
  printer: PrinterInfo;
};
