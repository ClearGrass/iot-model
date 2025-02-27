function dec2hex(val) {
    const n = parseInt(val, 10)
    const str = n.toString(16)
    return str.length % 2 ? '0' + str : str
}

function hex2dec(str) {
    return parseInt(str, 16)
}

function substr(str, pos, len) {
    return str.substr(pos, len)
}

function parseSensorData(bytes, cursor, sensorDataType, dataType = 'realtime', dataLen = 9) {
    const thBytes = bytes.slice(cursor, cursor + 3).reverse()
    const thHex = thBytes.map(dec2hex).join('')

    const temperature = (hex2dec(substr(thHex, 0, 3)) - 500) / 10
    const humidity = hex2dec(substr(thHex, 3, 3)) / 10
    const sensorType = bytes[cursor + 3]

    let co2, prob_temperature, prob_humidity
    let value = bytes.slice(cursor + 4, cursor + 8)
    let proValue = value[0] | (value[1] << 8) | (value[2] << 16) | (value[3] << 24)
    //console.log(bytes, value, 'value')

    //console.log('sensorType',sensorType)
    proValue = proValue / 10
    switch (sensorType) {
        case 1:
            co2 = proValue
            break
        case 2:
            let signedInt16 = value[0] | (value[1] << 8)
            if (signedInt16 & 0x8000) {  // 如果符号位是 1，表示负数
                signedInt16 -= 0x10000;  // 转换为负值
            }
            prob_temperature = signedInt16 / 10

            let unsignedInt16 = value[2] | (value[3] << 8)
            unsignedInt16 = unsignedInt16 / 10;
            if (unsignedInt16 > 0 && unsignedInt16 <= 100) {
                prob_humidity = unsignedInt16;
            }

            break
        case 3:
            prob_temperature = proValue
            break
    }

    const battery = bytes[cursor + dataLen - 1]

    const data = { temperature, humidity, prob_temperature, prob_humidity, battery, type: dataType }

    console.log(data, 'data of resolve')
    {
        data['rssi'] = bytes[cursor + dataLen] - 256
    }

    //console.log(data, 'data of resolve')
    return data
}

function parseHistoryLogs(bytes, cursor, valueLength, sensorDataType) {
    let timestamp = readIntVal(bytes, cursor, 4) * 1000
    cursor += 4

    const interval = readIntVal(bytes, cursor, 2)
    cursor += 2

    let unitDataLen = 9;
    if ((valueLength - 6) % 13 == 0) {
        unitDataLen = 13;
    }

    const logs = []
    const end = cursor + valueLength - unitDataLen

    //console.log("valueLength",valueLength)
    //   console.log(cursor, end, sensorDataType, 'cursor and end')
    while (cursor < end) {
        const log = parseSensorData(bytes, cursor, sensorDataType, 'history', unitDataLen)
        log['timestamp'] = timestamp
        log['datetime'] = timestamp

        if (log['temperature'] > 300) {
            break
        }

        logs.push(log)

        timestamp += interval * 1000
        console.log(interval, timestamp, 'interval')
        cursor += unitDataLen
    }

    return logs
}

function readIntVal(bytes, from, len) {
    let l = len - 1
    let val = 0
    while (l >= 0) {
        val += bytes[from + l] << (8 * l)
        l -= 1
    }
    return val
}

function readStrVal(bytes, cursor, len) {
    const end = cursor + len
    let str = ''
    while (cursor < end) {
        str += String.fromCharCode(bytes[cursor])
        cursor += 1
    }

    return str
}

function appendIntVal(bytes, type, val, len) {
    bytes.push(type)
    appendRawInt(bytes, len, 2)
    appendRawInt(bytes, val, len)
}

function appendRawInt(bytes, val, len) {
    let bytePos = 0
    while (bytePos < len) {
        bytes.push((val >> (bytePos * 8)) & 0xff)
        bytePos += 1
    }
}

function appendRawStr(bytes, str) {
    let cursor = 0
    const len = str.length
    while (cursor < len) {
        bytes.push(str.charCodeAt(cursor))
        cursor++
    }
}

function formatOffsetMinutes(minutes) {
    const hour = Math.floor(minutes / 60)
    const min = minutes % 60
    return '' + hour + ':' + (min < 10 ? '0' : '') + min
}

function parseAlarmConfig(payload, from, len) {
    let cursor = from

    const alarm = {}
    while (cursor < from + len) {
        let repeat = payload[cursor]
        alarm['repeat'] = repeat === 0x01 ? 'once' : 'everyday'
        cursor += 1

        alarm['from'] = formatOffsetMinutes(readIntVal(payload, cursor, 4))
        cursor += 4

        alarm['to'] = formatOffsetMinutes(readIntVal(payload, cursor, 4))
        cursor += 4

        alarm['threshold'] = readIntVal(payload, cursor, 2)
        cursor += 2
    }

    return alarm
}

function readHex(payload, cursor, len) {
    return payload
        .slice(cursor, cursor + len)
        .map(dec2hex)
        .join('')
}

function parseTLVPairs(
    payload,
    from,
    payloadLen,
    readableOutput = false
) {
    const intTypes = [0x04, 0x05, 0x06, 0x15, 0x10, 0x17, 0x1d, 0x38]
    const strTypes = [0x11, 0x1a, 0x12, 0x25, 0x13, 0x34, 0x35]

    const typeNames = {
        0x04: 'report_interval',
        0x05: 'collect_interval',
        0x06: 'ble_interval',
        0x15: 'timestamp',
        0x10: 'firmware_type',
        0x17: 'battery_low',
        0x14: 'data',
        0x12: 'module_url',
        0x13: 'mcu_url',
        0x11: 'firmware_version',
        0x03: 'logs',
        0x33: 'logs',
        0x34: 'module_version',
        0x35: 'mcu_version',
        0x1a: 'hardware',
        0x22: 'hardware',
        0x25: 'mqtt',
        0x1d: 'end_flag',
        0x07: 'temperature_alarm_gt',
        0x08: 'temperature_alarm_lt',
        0x09: 'humidity_alarm_gt',
        0x0a: 'humidity_alarm_lt',
        0x29: 'prob_temperature_alarm_gt',
        0x2a: 'prob_temperature_alarm_lt',
        0x2c: 'usb_plug_in',
        0x38: 'product_id',
    }

    const alarms = []

    const pairs = {}
    let cursor = from
    const end = from + payloadLen
    while (cursor < end) {
        // type
        const type = payload[cursor]
        cursor += 1

        // length
        const valueLength = readIntVal(payload, cursor, 2)

        cursor += 2

        const typeName = typeNames[type] || dec2hex(type)

        if (intTypes.indexOf(type) >= 0) {
            // pairs[typeName] = readIntVal(payload, cursor, valueLength);
            if (type == 0x04) {
                pairs[typeName] = readIntVal(payload, cursor, valueLength) * 60
            } else {
                pairs[typeName] = readIntVal(payload, cursor, valueLength)
            }
        } else {
            if (strTypes.indexOf(type) >= 0) {
                pairs[typeName] = readStrVal(payload, cursor, valueLength)
            } else {
                switch (type) {
                    case 0x03: // 历史数据
                    case 0x33: // 历史数据
                        pairs[typeName] = parseHistoryLogs(
                            payload,
                            cursor,
                            valueLength,
                            0
                        )
                        break
                    case 0x14: // 实时数据
                        const sensorData = parseSensorData(payload, cursor + 4, 1, 'realtime', valueLength - 6)
                        sensorData.timestamp = readIntVal(payload, cursor, 4) * 1000
                        sensorData.datetime = sensorData.timestamp

                        pairs[typeName] = sensorData
                        break
                    case 0x07:
                    case 0x08:
                    case 0x0a:
                    case 0x0b:
                    case 0x29:
                    case 0x2a:
                        if (valueLength === 11) {
                            const config = parseAlarmConfig(
                                payload,
                                cursor,
                                valueLength
                            )
                            config['operator'] =
                                [0x07, 0x0a, 0x29].indexOf(type) >= 0 ? 'gt' : 'lt'
                            if ([0x07, 0x08].indexOf(type) >= 0) {
                                config['metric'] = 'temperature'
                                config['threshold'] = (config['threshold'] - 500) / 10
                            } else if ([0x29, 0x2a].indexOf(type) >= 0) {
                                config['metric'] = 'prob_temperature'
                                config['threshold'] = (config['threshold'] - 500) / 10
                            } else {
                                config['metric'] = 'humidity'
                                config['threshold'] = config['threshold'] / 10
                            }
                            alarms.push(config)
                        } else {
                            const eventSensorData = parseSensorData(
                                payload,
                                cursor + 4,
                                valueLength <= 12
                                    ? SENSOR_DATA_TYPES.withRssi
                                    : SENSOR_DATA_TYPES.withRssiAndProbHumidity,
                                'events',
                                valueLength - 6
                            )
                            eventSensorData.timestamp =
                                readIntVal(payload, cursor, 4) * 1000
                            eventSensorData.datetime = eventSensorData.timestamp

                            delete eventSensorData['rssi']

                            const v = readIntVal(payload, cursor + valueLength - 2, 2)
                            if (typeName.indexOf('temperature') >= 0) {
                                eventSensorData['threshold'] = (v - 500) / 10
                            } else {
                                eventSensorData['threshold'] = v
                            }
                            pairs[typeName] = eventSensorData
                        }
                        break

                    default:
                        pairs[typeName] = readHex(payload, cursor, valueLength)
                        break
                }
            }
        }
        // value
        cursor += valueLength
    }

    if (alarms.length > 0) {
        pairs['alarms'] = alarms
    }

    return pairs
}

function replaceBytesInPacket(replacedMap, packet) {
    for (let i = 0; i < packet.length; i++) {
        const byte = packet[i]
        if (replacedMap[byte] !== undefined) {
            packet[i] = replacedMap[byte]
        }
    }
}

function prefixMatched(packet, pos, prefixBytes) {
    const prefixLen = prefixBytes.length
    for (let k = 0; k < prefixLen; k++) {
        if (prefixBytes[k] !== packet[pos + k]) {
            return false
        }
    }

    return true
}

function escapePacket(packet, pos) {
    const replacedMap = {}
    if (prefixMatched(packet, pos, [0x27, 0x03, 0x00])) {
        console.log('prefix matched:0x27, 0x03, 0x00')
        const escapedValues = [0x1a, 0x1b, 0x08]
        pos += 3
        let i = 0
        while (i < 3) {
            if (packet[pos] !== 0x43) {
                replacedMap[packet[pos]] = escapedValues[i]
            }
            i += 1
            pos += 1
        }
    }

    let newPacket
    if (prefixMatched(packet, pos, [0x26, 0x03, 0x00])) {
        pos += 6
        let len = packet[pos - 1]
        if (replacedMap[len] !== undefined) {
            len = replacedMap[len]
        }
        newPacket = packet.slice(pos, len + pos)
        pos += len
    } else {
        newPacket = packet.slice(pos)
        pos += newPacket.length
    }

    if (Object.keys(replacedMap).length > 0) {
        replaceBytesInPacket(replacedMap, newPacket)
    }

    return { newPacket, newPos: pos }
}

function checkSum(bytes) {
    const len = bytes.length
    let cursor = 0
    let sum = 0
    while (cursor < len) {
        sum += bytes[cursor]
        cursor += 1
    }
    return sum
}

function parsePacket(packet) {
    let pos = 0
    let totalLen = packet.length

    let wholePacket = []
    while (pos < totalLen) {
        const { newPacket, newPos } = escapePacket(packet, pos)
        wholePacket = wholePacket.concat(...newPacket)
        pos = newPos
    }
    packet = wholePacket

    const len = packet.length
    if (len < 5) {
        console.log('length invalid:' + len)
        return false
    }

    if (
        (packet[0] !== 0x43 || packet[1] !== 0x47) &&
        packet[0] === len - 1
    ) {
        // lora msg
        console.log('lora--------->', parseLoRaPacket(packet))

        // return parseLoRaPacket(packet)
    }
    if (packet[0] !== 0x43 || packet[1] !== 0x47) {
        console.log('sop invalid:', packet)
        return false
    }

    // const checksum = (packet[len - 1] << 8) + packet[len - 2]
    // const calcChecksum = checkSum(packet.slice(0, len - 2))
    // if (calcChecksum !== checksum) {
    //   console.log('checkSum Wrong', { calcChecksum, checksum })
    //   return false
    // }

    const command = packet[2]
    const payloadLen = (packet[4] << 8) + packet[3]

    if (payloadLen === 0) {
        return {
            command,
            values: {},
        }
    }

    if (payloadLen + 7 !== len) {
        console.log('invalid payload length command:' + command)
        return false
    }

    const values = parseTLVPairs(packet, 5, payloadLen)

    let params = {}
    let logsParams = {}
    for (let key in values) {
        if (key == 'logs' || key == 'data') {
            const logs = values['logs'] || [values['data']] || []

            if (values['logs']) {
                logsParams = {
                    temperature: [],
                    prob_temperature: [],
                    humidity: [],
                    prob_humidity: [],
                    battery: [],
                    timestamp: [],
                }
            }

            logs.map((item, key) => {
                if (item.type === 'history') {
                    item['temperature'] &&
                        logsParams['temperature'].push(item['temperature'])
                    item['prob_temperature'] &&
                        logsParams['prob_temperature'].push(item['prob_temperature'])
                    item['humidity'] && logsParams['humidity'].push(item['humidity'])

                    item['prob_humidity'] && logsParams['prob_humidity'].push(item['prob_humidity'])

                    item['battery'] && logsParams['battery'].push(item['battery'])
                    item['timestamp'] &&
                        logsParams['timestamp'].push(item['timestamp'])
                } else {
                    item['temperature'] &&
                        (logsParams['temperature_realtime'] = item['temperature'])
                    item['prob_temperature'] &&
                        (logsParams['prob_temperature_realtime'] = item['prob_temperature'])
                    item['humidity'] && (logsParams['humidity_realtime'] = item['humidity'])
                    item['prob_humidity'] && (logsParams['prob_humidity_realtime'] = item['prob_humidity'])
                }

            })
        } else if (
            key == 'ble_interval' ||
            key == 'collect_interval' ||
            key == 'report_interval'
        ) {
            params[key] = values[key]
        }
    }
    ; (values.logs || values.data) &&
        (params = Object.assign({}, params, logsParams))

    console.log('解析结果--------->', params)

    return params

    // return {
    //   command,
    //   values
    // }
}

function parseHex(hex) {
    const len = hex.length

    let cursor = 0
    const payload = []
    while (cursor < len) {
        payload.push(hex2dec(hex.substr(cursor, 2)))
        cursor += 2
    }
    //   console.log('payload',payload);

    return parsePacket(payload)
}

/**
 * 将设备自定义topic数据转换为json格式数据, 设备上报数据到物联网平台时调用
 * 入参：topic   string 设备上报消息的topic
 * 入参：rawData byte[]数组 不能为空
 * 出参：jsonObj JSON对象 不能为空
 */
function transformPayload(topic, rawData) {
    var jsonObj = {}
    return jsonObj
}

/**
 * 将设备的自定义格式数据转换为Alink协议的数据，设备上报数据到物联网平台时调用
 * 入参：rawData byte[]数组 不能为空
 * 出参：jsonObj Alink JSON对象 不能为空
 */
function rawDataToProtocol(str) {
    let jsonMap = new Object()
    let bytes = []
    for (let i = 0; i < str.length; i++) {
        bytes[i] = str[i] >= 0 ? str[i] : 256 + str[i]
    }

    jsonMap['params'] = parsePacket(bytes)
    jsonMap['params']['data'] = bytes.join(',')

    //jsonMap["id"] = "1234";
    jsonMap['version'] = '1.0'
    jsonMap['method'] = 'thing.event.property.post'

    return jsonMap
}

/**
 *  将Alink协议的数据转换为设备能识别的格式数据，物联网平台给设备下发数据时调用
 *  入参：jsonObj Alink JSON对象  不能为空
 *  出参：rawData byte[]数组      不能为空
 *
 */
function protocolToRawData(jsonObj) {
    var payloadArray = []
    if (
        JSON.stringify(jsonObj['params']) != '{}' &&
        JSON.stringify(jsonObj['params']) != null
    ) {
        var rawData = str2ab(jsonObj['params']['data'])
        var dataView = new DataView(rawData)
        for (var i = 0; i < rawData.byteLength; i++) {
            payloadArray = payloadArray.concat(dataView.getUint8(i))
        }
    } else {
        payloadArray = payloadArray.concat(0x00)
    }
    return payloadArray
}

// FrogS 解析
// history
parseHex(
    //'43473449003802003d00110500312e312e38220400303030302c010000341000424332363059434e4141523032413031350500312e312e381d010000140f007730606504412f03f0feffff52b9000b10'
    //'27030004430543473160003802003d001d010001035400051d046658024e422e0000000000000000006450322e0000000000000000006456222e000000000000000000644e322e0000000000000000006445c22e000000000000000000643dc22e00000000000000000064830a'
    //'43473442003802003c00110500322e302e33220400303030302c010001340500312e332e37350500322e302e331d010001141300c5c0f36549e22f041c0000003202090100cf00960b'
    //'27030043430643473449003802003d00110500312e322e32220400303030302c010001341000424332363059434e4141523032413032350500312e322e321d010001140f002f36f06502e22903a406000000a700470d'
    //'434731ae003802003d001d01000103a20010b9bf675802eb502e02f2001d01ff003c0164ea602e02f2001c01ff003c0164ea702e02f3001c01ff003c0164eb702e02f3002001ff003c0164f0802e02f4002501ff003c016401912e02fb004601ff003c016420d12e02f8006501ff003c0164fcf02e02f9003401ff003c0164f8f02e02f9003101ff003c0164e9a02e02ed001d01ff003c0164e4502e02e8001c01ff003c0164e9602e02f0001e01ff003c01642938'
    //'43473451003802003d00110500312e372e30220400303030302c0100006c010000341000424332363059434e4141523032413032350500312e372e301d010001141300d3d3bf67ea602e02f1001f01ff003c0164bd005c11'
    '43473451003802003d00110500312e372e30220400303030302c0100006c010000341000424332363059434e4141523032413032350500312e372e301d010001141300d3d3bf67ea602e02f1001f01ff003c0164bd005c11',
)