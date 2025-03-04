// DeviceIntent Entity

export interface DeviceIntent {
  id: string;
  label: string;
  description: string;
  enable: boolean;
  interval_windown: number;
  connecter: "AND" | "OR";
  type: "ONLINE" | "OFFLINE";
  customer_id: string;
  conditions: IntentCondition[];
  device_actions: DeviceAction[];
  schedule_plan_actions: SchedulePlanAction[];
}

export interface DeviceAction {
  id: string;
  key: string;
  function_id: string;
  function: TabiotProductionFunction;
  bool_v: boolean;
  str_v: string;
  dbl_v: number;
  device_id: string;
  intent_id: string;
  intent: DeviceIntent;
}

export interface SchedulePlanAction {
  id: string;
  schedule_id: string;
  enable: boolean;
  intent_id: string;
  intent: DeviceIntent;
}

export interface IntentCondition {
  id: string;
  type: "SINGLE" | "COMPLEX";
  connecter: "AND" | "OR";
  conditions: IntentCondition[] | null;
  parentCondition: IntentCondition | null;
  predicate: IntentPredicate;
  deviceIntent: DeviceIntent;
}

export interface IntentPredicate {
  id: string;
  function_id: string;
  function: TabiotProductionFunction;
  operation: "=" | ">" | ">=" | "!=" | "<" | "<=";
  identifier: string;
  bool_v: boolean;
  str_v: string;
  dbl_v: number;
  device_id: string;
  condition: IntentCondition;
}

export interface TabiotProductionFunction {
  name: string;

  type?: string;

  label?: string;

  identifier?: string;

  data_type?: string;

  icon_url?: string;

  data_on_text?: string;

  data_off_text?: string;

  enum_value?: string;

  unit?: string;

  data_permission?: string;

  description?: string;

  data_measure_max?: string;

  data_measure_min?: string;

  data_eligible_max?: string;

  data_eligible_min?: string;

  chart_type?: string;

  round_type?: string;

  data_permission2?: string;

  rw_permission?: string;

  id?: string;

  index_sort: number;

  md_size: number;

  show_chart: number;

  checkbox_bit_label1?: string;

  checkbox_bit_label2?: string;

  checkbox_bit_label3?: string;

  checkbox_bit_label4?: string;

  checkbox_bit_label5?: string;

  checkbox_bit_label6?: string;

  checkbox_bit_label7?: string;

  checkbox_bit_label8?: string;
}

export interface TsData {
  key: string;
  ts: number;
  value: any;
}

export interface DeviceLatestData {
  device_id: string;
  latest_data: TsData[];
}
