Take full control of your Zehnder ComfoConnect Pro ventilation unit straight from Homey. Connect over your local network using Modbus TCP and optionally the ComfoConnect energy protocol.

Monitor indoor and outdoor temperatures, humidity, air flow, fan speed, filter status, and energy use. Switch between ventilation presets, activate away mode, start a boost for up to 24 hours, and adjust the temperature profile automatically or with a fixed setpoint. Homey flows let you automate everything: boost when the doorbell rings, lower the fan when you go to bed, or get a notification when the filter needs replacing.

Requirements:
- Zehnder ComfoConnect Pro connected to your LAN or WiFi
- Modbus TCP enabled on the device (via http://comfoconnectpro.local)
- A static IP address is recommended

Setup:
1. Install the app via the Homey App Store.
2. Add a device: Devices, then +, then Zehnder ComfoConnect Pro.
3. Enter the IP address of your ComfoConnect Pro.
4. Leave Port (502) and Unit ID (1) at their defaults.
5. Optional: enable energy monitoring via Device Settings.

Device Settings:

IP address: Address of the ComfoConnect Pro on your network. Default: http://comfoconnectpro.local

Modbus TCP port: Default is 502. Only change this if you use a custom network configuration.

Modbus Unit ID: Default is 1. Do not change unless configured differently.

Poll interval (seconds): How often Modbus sensors are read. Default: 30 seconds. Automatically increased to 60 seconds when an energy session is active to prevent TCP conflicts.

Enable energy and fan monitoring: Enables the optional ComfoConnect protocol connection. Required for power, kWh, m3/h, RPM and bypass data. Recovers automatically after interruption.

Gateway UUID: Filled in automatically on first connection via UDP discovery. Can be entered manually if discovery fails.

Energy reconnect base delay (seconds): Wait time after a session loss before the first reconnect attempt. Default: 15 seconds, doubling each attempt up to 5 minutes.

Homey Energy:

When energy monitoring is enabled, the device appears automatically in Homey Energy using measure_power for current power in Watt and meter_power for the cumulative energy counter in kWh. The kWh counter is always reported without a threshold. Small fluctuations in W, m3/h and RPM are filtered to prevent unnecessary UI updates (thresholds: 2W, 5 m3/h, 50 RPM).