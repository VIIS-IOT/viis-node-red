Yêu cầu:
Hiện tại đã có API {{serverURL}}/api/v2/scheduleLog?page=1&size=10

tôi cần bổ sung API
{{serverURL}}/api/v2/scheduleLog/detail?page=1&size=2&filters=[["iot_schedule_log", "schedule_id", "like", "4397eb5585a39957"]]
có hỗ trợ dynamic filter, pagination tương tự như vầy

Data response có format như sau:
{
    "result": {
        "data": [
            {
                "name": "5a7ac09fad",
                "schedule_id": "4397eb5585a39957",
                "label": "Chương trình thử 004",
                "device_id": "b0b3cd50-3c27-11f0-98dc-bf024c096c4a",
                "start_date": "2025-06-02",
                "end_date": "2025-06-06",
                "start_time": "05:00:00",
                "end_time": "05:05:00",
                "start_time_unix": "2025-06-03T05:00:00.000Z",
                "end_time_unix": "2025-06-03T05:05:00.000Z",
                "log_creation": "2025-06-04 05:05:42",
                "log_modified": "2025-06-04 05:05:42",
                "notifications": null,
                "errors": [],
                "warnings": [],
                "data_by_key": {
                    "INPUT_FLOW_CHIA_NUOC": [
                        {
                            "timestamp": 1748988008890,
                            "value": "47.5"
                        },
                        {
                            "timestamp": 1748988018889,
                            "value": "35.8"
                        },
                        {
                            "timestamp": 1748988028891,
                            "value": "39.8"
                        },
                        {
                            "timestamp": 1748988038894,
                            "value": "36"
                        },
                        {
                            "timestamp": 1748988048891,
                            "value": "46.4"
                        },
                        {
                            "timestamp": 1748988058898,
                            "value": "30.8"
                        },
                        {
                            "timestamp": 1748988068896,
                            "value": "10.8"
                        },
                        {
                            "timestamp": 1748988078898,
                            "value": "23"
                        },
                        {
                            "timestamp": 1748988088900,
                            "value": "0.2"
                        },
                        {
                            "timestamp": 1748988098898,
                            "value": "44.6"
                        },
                        {
                            "timestamp": 1748988108900,
                            "value": "18.9"
                        },
                        {
                            "timestamp": 1748988118902,
                            "value": "2.1"
                        },
                        {
                            "timestamp": 1748988128905,
                            "value": "8.8"
                        },
                        {
                            "timestamp": 1748988138904,
                            "value": "4.1"
                        },
                        {
                            "timestamp": 1748988148906,
                            "value": "2.2"
                        },
                        {
                            "timestamp": 1748988158908,
                            "value": "30"
                        },
                        {
                            "timestamp": 1748988168906,
                            "value": "9.2"
                        },
                        {
                            "timestamp": 1748988178908,
                            "value": "13.4"
                        },
                        {
                            "timestamp": 1748988188911,
                            "value": "5.4"
                        },
                        {
                            "timestamp": 1748988198913,
                            "value": "32.4"
                        },
                        {
                            "timestamp": 1748988208915,
                            "value": "20.8"
                        },
                        {
                            "timestamp": 1748988218913,
                            "value": "35.1"
                        },
                        {
                            "timestamp": 1748988228915,
                            "value": "47"
                        },
                        {
                            "timestamp": 1748988238917,
                            "value": "34.2"
                        },
                        {
                            "timestamp": 1748988248916,
                            "value": "7.2"
                        },
                        {
                            "timestamp": 1748988258919,
                            "value": "4.5"
                        },
                        {
                            "timestamp": 1748988268921,
                            "value": "29.9"
                        },
                        {
                            "timestamp": 1748988278918,
                            "value": "46.4"
                        },
                        {
                            "timestamp": 1748988288921,
                            "value": "8.8"
                        },
                        {
                            "timestamp": 1748988298920,
                            "value": "26.1"
                        }
                    ],
                    "heartbeat": [
                        {
                            "timestamp": 1748988029312,
                            "value": "1748988029293"
                        },
                        {
                            "timestamp": 1748988059314,
                            "value": "1748988059293"
                        },
                        {
                            "timestamp": 1748988089312,
                            "value": "1748988089293"
                        },
                        {
                            "timestamp": 1748988119314,
                            "value": "1748988119295"
                        },
                        {
                            "timestamp": 1748988149313,
                            "value": "1748988149296"
                        },
                        {
                            "timestamp": 1748988179315,
                            "value": "1748988179297"
                        },
                        {
                            "timestamp": 1748988209317,
                            "value": "1748988209298"
                        },
                        {
                            "timestamp": 1748988239315,
                            "value": "1748988239298"
                        },
                        {
                            "timestamp": 1748988269318,
                            "value": "1748988269298"
                        },
                        {
                            "timestamp": 1748988299316,
                            "value": "1748988299298"
                        }
                    ]
                }
            }
        ],
        "pagination": {
            "totalElements": 4,
            "totalPages": 4,
            "pageSize": 1,
            "pageNumber": 1,
            "order_by": null
        }
    }
}
