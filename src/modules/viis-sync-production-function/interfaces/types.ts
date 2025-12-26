/**
 * @fileoverview Type definitions for the VIIS Sync Production Function module
 */

import { NodeMessageInFlow } from 'node-red';

/**
 * Extended Node message with custom payload
 */
export interface ExtendedNodeMessage extends NodeMessageInFlow {
    payload: any;
    [key: string]: any;
}

/**
 * Server Production Function data structure
 * Represents a production function with custom labels merged from backend
 */
export interface ServerProductionFunction {
    name: string;
    type?: string;
    label?: string;  // Custom label or default label (already merged by backend)
    identifier?: string;
    data_type?: 'Bool' | 'Value' | 'Enum' | 'Raw' | 'String' | 'Group Break' | 'Tab Break' | 'IP' | 'Checkbox-bit' | 'User data type';
    icon_url?: string;
    data_on_text?: string;
    data_off_text?: string;
    enum_value?: string;
    unit?: string;
    data_permission?: 'r' | 'rw' | 'w';
    description?: string;
    device_group_function_id?: string;
    data_measure_max?: string;
    data_measure_min?: string;
    data_eligible_max?: string;
    data_eligible_min?: string;
    checkbox_bit_label1?: string;  // Custom or default checkbox labels (already merged)
    checkbox_bit_label2?: string;
    checkbox_bit_label3?: string;
    checkbox_bit_label4?: string;
    checkbox_bit_label5?: string;
    checkbox_bit_label6?: string;
    checkbox_bit_label7?: string;
    checkbox_bit_label8?: string;
    chart_type?: '' | 'Line' | 'Text' | 'Text_Line' | 'Gauge' | 'Card';
    round_type?: '' | 'Raw' | 'Round' | 'Float_1' | 'Float_2' | 'Float_3' | 'Float_6';
    md_size?: number;
    show_chart?: boolean;
    index_sort?: number;
    device_profile_id?: string;
    is_hidden?: number;  // 0 = visible, 1 = hidden (filtered by backend)
}

/**
 * Device Profile information from backend
 */
export interface DeviceProfileInfo {
    name: string;
    label?: string;
    description?: string;
    type?: string;
}

/**
 * Device information from backend
 */
export interface DeviceInfo {
    name: string;
    label?: string;
}

/**
 * Server response structure for production functions sync
 * This matches the actual backend API response
 */
export interface ServerProductionFunctionResponse {
    success: boolean;
    device_profile?: DeviceProfileInfo;
    device_info?: DeviceInfo;
    production_functions?: ServerProductionFunction[];
    total?: number;  // Total count of visible functions
}

/**
 * API response wrapper from backend
 * Backend wraps the actual data in a 'result' object
 */
export interface ApiResponseWrapper {
    result: ServerProductionFunctionResponse;
}
