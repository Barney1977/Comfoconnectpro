# Zehnder ComfoConnect Pro — Homey App

Control and monitor your Zehnder ventilation unit (ComfoAir Q / ComfoAir Flex) via the **ComfoConnect Pro** Modbus TCP interface.

## Features

### Controls (UI + Flows)
| Capability | Description |
|---|---|
| **Ventilation preset** | Switch between Away (0), Low (1), Medium (2), High (3) |
| **Away mode** | Toggle absent mode (sets preset to 0) |
| **Boost** | Activate party timer (default 1 h; configurable in flows) |
| **Temperature profile** | Switch between Normal, Cool, Warm |

### Sensors
| Sensor | Register |
|---|---|
| Indoor temperature | SENSOR_ROOM (0x0008) |
| Outdoor temperature | SENSOR_ODA (0x000B) |
| Supply air temperature | SENSOR_SUP (0x000C) |
| Exhaust air temperature | SENSOR_ETA (0x0009) |
| Indoor humidity | HUMID_ROOM (0x000D) |
| Outdoor humidity | HUMID_ODA (0x0010) |
| Filter days remaining | Filterstatus (0x001A) |
| Filter replacement alarm | Discrete input 0x0004 |
| Unit alarm | Discrete input 0x0001 |
| Connection status | Verbindungsstatus (0x0001) |

### Flow Cards
**Triggers**
- Filter replacement needed
- Ventilation preset changed (with preset token)

**Conditions**
- Away mode is active / inactive
- Boost (party timer) is active / inactive
- Filter needs replacement

**Actions**
- Set ventilation preset (0–3)
- Set away mode on/off
- Activate boost (with duration in minutes)
- Stop boost
- Set temperature profile (Normal / Cool / Warm)
- Reset unit errors

## Requirements

- **Homey Pro** (SDK 3, firmware ≥ 12.0)
- **Zehnder ComfoConnect Pro** (Art. Nr. 471 429 300) connected to your LAN or WiFi
- Modbus TCP enabled (default port 502)
- DHCP with static lease recommended for the ComfoConnect Pro

## Installation

1. Install this app on your Homey Pro via the Homey App Store or `homey app install` (CLI)
2. Add a device: **Devices → + → Zehnder ComfoConnect Pro**
3. Enter the IP address of your ComfoConnect Pro  
   *(Tip: browse to `http://comfoconnectpro.local` to find the IP)*
4. Leave port as **502** and Unit ID as **1** unless you changed defaults

## Device Settings

After pairing you can adjust in **Device Settings**:

| Setting | Default | Description |
|---|---|---|
| IP Address | — | IP of the ComfoConnect Pro |
| Modbus TCP Port | 502 | TCP port for Modbus |
| Unit ID | 1 | Modbus unit/slave ID |
| Poll interval | 30 s | How often to read sensor values |

## Modbus Register Reference

Based on **Zehnder Technical Specification 816** (Stand 11/2024).  
All addresses shown are protocol addresses (0-based, = datasheet address − 1).

### Discrete Inputs (read-only)
| Address | Variable |
|---|---|
| 0x0000 | Error flag |
| 0x0001 | Standby |
| 0x0002 | ComfoHood status |
| 0x0003 | Filter replace alarm |

### Holding Registers (R/W)
| Address | Variable | Unit |
|---|---|---|
| 0x0000 | Ventilation preset | 0–3 |
| 0x0001 | Temperature profile | 0=Normal, 1=Cool, 2=Warm |
| 0x0002 | Temperature profile mode | 0=adaptive, 1=fixed, 2=external |
| 0x0003 | External setpoint | °C × 10 |
| 0x0004 | Party timer duration | seconds |

### Coils (R/W)
| Address | Variable |
|---|---|
| 0x0000 | Reset errors |
| 0x0001 | Preset Away |
| 0x0002 | Preset 1 |
| 0x0003 | Preset 2 |
| 0x0004 | Preset 3 |
| 0x0005 | AUTO mode |
| 0x0006 | Party timer on/off |
| 0x0007 | Away function |
| 0x0008 | ComfoClime |

### Input Registers (read-only)
| Address | Variable | Unit |
|---|---|---|
| 0x0000 | Connection status | 0=OK |
| 0x0001–0x0005 | Active errors 1–5 | byte |
| 0x0006 | Supply fan status | mch |
| 0x0007 | Room temperature | °C×10 |
| 0x0008 | Exhaust temp (ETA) | °C×10 |
| 0x0009 | Outgoing temp (EHA) | °C×10 |
| 0x000A | Outdoor temp (ODA) | °C×10 |
| 0x000B | Supply temp (SUP) | °C×10 |
| 0x000C | Room humidity | % |
| 0x000D | Exhaust humidity (ETA) | % |
| 0x000E | Outgoing humidity (EHA) | % |
| 0x000F | Outdoor humidity (ODA) | % |
| 0x0010 | Supply humidity (SUP) | % |
| 0x0019 | Filter status | days |

## Notes

- **One ComfoConnect Pro per ventilation unit.** The app supports one device per IP.
- **Energy monitoring:** The ComfoConnect Pro spec does not expose power consumption over Modbus. The fan supply speed (`mch`) is polled but no watt-hour meter is available in the register map. If Zehnder adds this in a firmware update, add `measure_power` and `meter_power` capabilities and read the relevant register.
- **WiFi SSID default:** `ComfoConnectPro` / Password: `BestClimate` — change before deploying.
- Tested with ComfoAir Q and ComfoAir Flex via ComfoConnect Pro firmware 11/2024.

## Changelog

### v1.0.0
- Initial release
- Modbus TCP polling for all sensors
- Ventilation preset, away mode, boost, temperature profile control
- Flow cards: triggers, conditions, actions
- Device settings for IP, port, unit ID, poll interval
