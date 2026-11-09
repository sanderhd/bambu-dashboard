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

export type Settings = {
  cameras: CameraConfig[];
  defaultCamera?: string;
  ha?: HaSettings;
  /** Print hours the printer had before this dashboard started counting. */
  printHoursOffset?: number;
  notify?: NotifySettings;
  affine?: AffineSettings;
};

export type AffineSettings = {
  /** Self-hosted AFFiNE address, e.g. http://192.168.178.10:3010 */
  url: string;
  /** AFFiNE has no write tokens, so the dashboard signs in like the app does. */
  email: string;
  password: string;
  workspaceId: string;
  /** Update project pages after each print. */
  auto: boolean;
  /** Log prints that weren't counted on a project to a separate page. */
  otherPrints: boolean;
  /** For dates written to AFFiNE, e.g. Europe/Amsterdam (the server itself often runs in UTC). */
  timeZone?: string;
};

/** A page body as read from AFFiNE, for showing notes in the dashboard. */
export type AffineBlock =
  | { t: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'quote' | 'code'; text: string }
  | { t: 'li'; text: string; kind: 'bulleted' | 'numbered' | 'todo' | 'toggle'; checked?: boolean; depth: number }
  | { t: 'table'; rows: string[][] }
  | { t: 'hr' }
  | { t: 'other'; what: string };

/** Content for a report page; built in the browser so dates and numbers use the viewer's locale. */
export type ReportBlock =
  | { t: 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'li'; text: string }
  | { t: 'table'; rows: string[][] }
  | { t: 'hr' };

export type NotifyEvent = 'started' | 'finished' | 'failed' | 'paused' | 'hms' | 'maintenance';

export type NotifySettings = {
  /** Pushbullet access token (Account settings → Access tokens). */
  pushbullet?: string;
  /** Discord channel webhook URL (Channel → Integrations → Webhooks). */
  discord?: string;
  events: NotifyEvent[];
  /** Attach a camera image to print notifications. */
  snapshot: boolean;
  /** Camera for the image; defaults to the dashboard's default camera. */
  camera?: string;
};

export type TempSample = { t: number; nozzle: number; nozzleTarget: number; bed: number; bedTarget: number };

export type PrintJob = {
  name: string;
  result: 'FINISH' | 'FAILED';
  layers: number | null;
  started: number | null;
  ended: number;
  /** Set when the print was counted towards a project part automatically. */
  counted?: { projectId: string; projectName: string; partId: string; partName: string; pieces: number };
  /** Seconds the printer was actually printing (pauses excluded). */
  printSeconds?: number;
  /** Energy used, from the Home Assistant energy sensor (start → end of the print). */
  energyKwh?: number;
  /** Filament used, when known: read from the sliced file on the printer, or the counted part's grams per piece. */
  grams?: number;
  gramsSource?: 'printer' | 'project';
  /** Per filament (type, #RRGGBB colour), when read from the printer. */
  filaments?: { type: string; color: string; grams: number }[];
};

/** The slicer's filament prediction for the print that is running, read from the printer's SD card. */
export type JobFilament = { file: string; plate: number | null; grams: number; filaments: SliceInfo['filaments'] };

export type Power = { watts: number | null; at: number; error: string | null };

export type HaSettings = { url: string; token?: string; powerEntity: string; energyEntity: string };

export type MaintenanceTask = {
  id: string;
  name: string;
  notes?: string;
  intervalHours?: number; // print hours between services
  intervalDays?: number; // or calendar days
  lastDoneHours: number; // total print hours when last done
  lastDoneAt: number; // timestamp when last done
};

export type MaintenanceStatus = MaintenanceTask & {
  hoursSince: number;
  daysSince: number;
  progress: number; // 0..1+ of the interval used up (whichever runs out first)
  state: 'ok' | 'soon' | 'due';
};

// ---------------------------------------------------------------- projects

export type FileKind = 'stl' | '3mf' | 'obj' | 'step' | 'gcode';

/** Read from a sliced .gcode.3mf (Metadata/slice_info.config). */
export type SliceInfo = {
  plates: number;
  minutes: number | null; // all plates together
  grams: number | null;
  filaments: { type: string; color: string; grams: number | null }[];
};

export type Part = {
  id: string;
  name: string;
  file?: { name: string; size: number; kind: FileKind; uploadedAt: number; slice?: SliceInfo };
  /** Preview image: embedded in 3MF files, rendered in the browser for STL. Value = version stamp. */
  thumbnail?: number;
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
  cover: { partId: string; v: number } | null;
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
  power: Power | null;
  /** Energy used by the current print so far, when Home Assistant is set up. */
  jobEnergyKwh: number | null;
};
