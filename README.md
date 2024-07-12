# iot-model
Thing Specification Language

# the things industries support
- [Temp & RH Barometer LoRaWAN](https://github.com/ClearGrass/iot-model/blob/main/ttn/lora/temp_rh.js)
- [CO2 & Temp & RH Monitor LoRaWAN](https://github.com/ClearGrass/iot-model/blob/main/ttn/lora/temp_rh_co2.js)
- [Indoor Environment Monitor LoRaWAN](https://github.com/ClearGrass/iot-model/blob/main/ttn/lora/indoor_env.js)


- decode data like this
```json
{
    "data": [{
        "air": {
            "battery": 74,
            "relativeHumidity": 35.5,
            "temperature": 27.7,
            "timestamp": 1715678671,
            "type": "realtime"
        },
        "time": "2024-05-14T09:24:31Z"
    }]
}
```