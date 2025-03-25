"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertObjectArray = convertObjectArray;
exports.formatScheduleRunningRes = formatScheduleRunningRes;
function convertObjectArray(inputArray) {
    return inputArray.map((item) => {
        let { name, action, enable, label, interval, set_time, start_date, end_date, type, start_time, end_time, schedule_plan_id, status, template_id, creation, modified } = item;
        try {
            action = action.split('\\').join('');
            action = JSON.parse(action);
        }
        catch (error) {
            action = { invalid_action: action };
        }
        let timeParts = set_time ? set_time.split(':') : ['00', '00'];
        let formattedTime = timeParts[0] + ':' + timeParts[1];
        let formattedStartTime = start_time;
        let formattedEndTime = end_time;
        // let startTimeParts = start_time ? start_time.split(':') : ['00', '00'];
        // let formattedStartTime = startTimeParts[0] + ':' + startTimeParts[1];
        // let endTimeParts = end_time ? end_time.split(':') : ['00', '00'];
        // let formattedEndTime = endTimeParts[0] + ':' + endTimeParts[1];
        let startDate = new Date(start_date);
        let formattedstartDate = startDate.toISOString().substring(0, 10);
        let endDate = new Date(end_date);
        let formattedEndDate = endDate.toISOString().substring(0, 10);
        return {
            id: name, // Replace with the appropriate ID value
            // device_id: item.device_id,
            action: typeof action === 'string' ? {} : action,
            enable: Boolean(enable),
            name: label,
            interval,
            time: formattedTime,
            start_time: formattedStartTime,
            end_time: formattedEndTime,
            start_date: formattedstartDate,
            end_date: formattedEndDate,
            type,
            schedule_plan_id,
            status,
            template_id,
            creation,
            modified
        };
    });
}
function formatScheduleRunningRes(inputArray) {
    return inputArray.map((item) => {
        let { name, action, enable, label, interval, set_time, start_date, end_date, type, start_time, end_time, schedule_plan_id, status, device_id, creation, modified, sp_label, sp_start_date, sp_end_date } = item;
        try {
            action = action.split('\\').join('');
            action = JSON.parse(action);
        }
        catch (error) {
            action = { invalid_action: action };
        }
        let timeParts = set_time ? set_time.split(':') : ['00', '00'];
        let formattedTime = timeParts[0] + ':' + timeParts[1];
        let startTimeParts = start_time ? start_time.split(':') : ['00', '00'];
        let formattedStartTime = startTimeParts[0] + ':' + startTimeParts[1];
        let endTimeParts = end_time ? end_time.split(':') : ['00', '00'];
        let formattedEndTime = endTimeParts[0] + ':' + endTimeParts[1];
        let startDate = new Date(start_date);
        let formattedstartDate = startDate.toISOString().substring(0, 10);
        let endDate = new Date(end_date);
        let formattedEndDate = endDate.toISOString().substring(0, 10);
        let spStartDate = new Date(sp_start_date);
        let formattedSpStartDate = spStartDate.toISOString().substring(0, 10);
        let spEndDate = new Date(sp_end_date);
        let formattedSpEndDate = spEndDate.toISOString().substring(0, 10);
        return {
            id: name,
            action: typeof action === 'string' ? {} : action,
            enable: Boolean(enable),
            name: label,
            interval,
            time: formattedTime,
            start_time: formattedStartTime,
            end_time: formattedEndTime,
            start_date: formattedstartDate,
            end_date: formattedEndDate,
            type,
            device_id, // thêm field device_idm
            creation, // thêm field creation
            modified, // thêm field modified
            sp_label, // thêm field sp_label
            sp_start_date: formattedSpStartDate, // thêm field sp_start_date
            sp_end_date: formattedSpEndDate, // thêm field sp_end_date
            schedule_plan_id,
            status
        };
    });
}
