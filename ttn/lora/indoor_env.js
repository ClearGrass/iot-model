function bytesToIntBigEndian(bytes) {
    let val = 0
    for (let i = bytes.length -1 ; i >= 0; i--) {
        val = val | (bytes[i] << ((bytes.length - i - 1) * 8))
    }

    return val
}

function hex2dec(str) {
    return parseInt(str, 16)
}

function bytesToString(byteArray) {
    let str = '';
    for (let i = 0; i < byteArray.length; i++) {
        str += String.fromCharCode(byteArray[i]);
    }
    return str
}


function dec2hex(val) {
    const n = parseInt(val, 10)
    const str = n.toString(16)
    return str.length % 2 ? '0' + str : str
  }

function substr(str, pos, len) {
    return str.substr(pos, len)
}

function secondsToISOString(timestampInSeconds) {
    const timestampInMillis = timestampInSeconds * 1000;
    const date = new Date(timestampInMillis);
    const isoString = date.toISOString();
    return isoString.slice(0, -5) + 'Z'; // 去掉毫秒部分
}

function parseSensorData(bytes, cursor, unitLen = 20) {
    let thBytes = new Uint8Array([0, bytes[0], bytes[1], bytes[2]])
    let thVal = bytesToIntBigEndian(thBytes)

    const temperature = ((thVal >> 12) - 500) / 10.0
    const relativeHumidity = (thVal&0x000FFF) /10.0

    // 3-5 预留

    const co2 = bytesToIntBigEndian(bytes.slice(cursor + 5, cursor + 7))
    const pm25 = bytesToIntBigEndian(bytes.slice(cursor + 7, cursor + 9))
    const pm10 = bytesToIntBigEndian(bytes.slice(cursor + 9, cursor + 11))
    const voc = bytesToIntBigEndian(bytes.slice(cursor + 11, cursor + 13))
    const noise = bytesToIntBigEndian(bytes.slice(cursor + 13, cursor + 15))
    const light = bytesToIntBigEndian(bytes.slice(cursor + 15, cursor + 19))
    const battery = bytes[19]

    let data = { temperature, relativeHumidity, co2, pm25, pm10, voc, noise, light, battery, type: 'data', timestamp: 0 }
    return data
}


function decodePacket(bytes) {
    let sensorDataList = [];
    length = bytes[2]
    cmd = bytes[1]

    unitLen = 20

    switch (cmd) {
        case 0x41:
            if (bytes[3] == 0) {
                let i = 0;
                let timestamp = bytesToIntBigEndian(bytes.slice(4,8))
                let interval = bytesToIntBigEndian(bytes.slice(8,10))

                let cursor = 10
                while (cursor < length) {
                    sensorData = parseSensorData(bytes.slice(cursor,cursor+unitLen),0)
                    sensorData.type = 'data'
                    sensorData.timestamp = timestamp + i*interval
                    sensorDataList.push({'time': secondsToISOString(sensorData.timestamp),'air': sensorData})
                    
                    cursor = cursor + unitLen
                    i++
                }

                return sensorDataList
            }

            if (bytes[3] == 1) {
                let sensorData = parseSensorData(bytes.slice(8, 8 + unitLen),0)
                sensorData.timestamp = bytesToIntBigEndian(bytes.slice(4,8))
                sensorData.type = 'realtime'
                
                sensorDataList.push({'time': secondsToISOString(sensorData.timestamp),'air': sensorData})
                return sensorDataList
            }
        
    }

    return sensorDataList
}


function decodeUplink(input) {
    return {
      data: {
        data: decodePacket(input.bytes)
      },
      warnings: [],
      errors: []
    };
}

function parseHexToBytes(hex) {
    const len = hex.length

    let cursor = 0
    const payload = []
    while (cursor < len) {
        payload.push(hex2dec(hex.substr(cursor, 2)))
        cursor += 2
    }

    return payload;
}

function parseBase64ToBytes(hex) {
    const binaryString = atob(base64String);
    const byteArray = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        byteArray[i] = binaryString.charCodeAt(i);
    }
}


// test
/* let parsedData = decodePacket(
    parseHexToBytes('01412401662758412FF2F5000003F6000D000E005C000C00000146FF000C3ABDCD00312E302E36EA05') 
)

console.log(parsedData)

let parsedData1 = decodePacket(
    parseHexToBytes('01411B0066276E0403842FF2F5000003F6000D000E005C000C00000146FF9076') 
)

console.log(parsedData1) */