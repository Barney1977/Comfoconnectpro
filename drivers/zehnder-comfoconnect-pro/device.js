'use strict';

const Homey         = require('homey');
const net           = require('net');
const Modbus        = require('jsmodbus');
const EnergyManager = require('../../lib/EnergyManager');

// ─── Timing ───────────────────────────────────────────────────────────────────
const RECONNECT_DELAY_MS = 5 * 1000;
const CONNECT_TIMEOUT_MS = 8 * 1000;

// ─── Modbus Register Map (Zehnder Technical Specification 816, Stand 11/2024) ─
// All addresses 0-based (protocol address = datasheet address − 1)
//
// Discrete Inputs (read-only bool)
const REG_DI_ERROR_FLAG     = 0x0000; // Fehlerprotokoll
const REG_DI_FILTER_REPLACE = 0x0003; // Filter tauschen

// Input Registers (read-only numeric)
const REG_IR_CONNECTION_STATUS = 0x0000; // Verbindungsstatus
const REG_IR_ROOM_TEMP         = 0x0007; // Raumtemperatur °C*10
const REG_IR_EXHAUST_TEMP      = 0x0008; // SENSOR_ETA °C*10
const REG_IR_OUTDOOR_TEMP      = 0x000A; // SENSOR_ODA °C*10
const REG_IR_SUPPLY_TEMP       = 0x000B; // SENSOR_SUP °C*10
const REG_IR_ROOM_HUMIDITY     = 0x000C; // Raumfeuchte %
const REG_IR_OUTDOOR_HUMIDITY  = 0x000F; // HUMID_ODA %
const REG_IR_FILTER_STATUS     = 0x0019; // Filterstatus days

// Coils (R/W bool)
const REG_COIL_ERROR_RESET   = 0x0000;
const REG_COIL_PRESET_AWAY   = 0x0001;
const REG_COIL_PRESET_1      = 0x0002;
const REG_COIL_PARTY_TIMER   = 0x0006;
const REG_COIL_COMFOCLIME    = 0x0008;

// Holding Registers (R/W numeric)
const REG_HR_VENTILATION_PRESET  = 0x0000; // Lüftungsvoreinstellung 0-3
const REG_HR_TEMPERATURE_PROFILE = 0x0001; // Temperatur Profil 0-2
const REG_HR_TEMP_PROFILE_MODE   = 0x0002; // Temperatur Profil Modus 0-2
const REG_HR_EXTERNAL_SETPOINT   = 0x0003; // Externer Sollwert °C*10 (ushort)
const REG_HR_PARTY_TIMER_SECONDS = 0x0004; // Party timer in Sekunden

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toSigned16(v)      { return v > 32767 ? v - 65536 : v; }
function tempFromReg(raw)   { return toSigned16(raw) / 10; }
function isPlausibleTemp(t) { return t !== 0 && t > -50 && t < 80; }
function isPlausibleHum(h)  { return h >= 0 && h <= 100; }

// ─── Device ──────────────────────────────────────────────────────────────────
module.exports = class ZehnderComfoConnectProDevice extends Homey.Device {

  async onInit() {
    this.log(`[${this.getName()}] Device init`);
    this._settings          = this.getSettings();
    this._modbusConnected   = false;
    this._pollingTimer      = null;
    this._reconnecting      = false;
    this._reconnectAttempts = 0;

    // Previous values for edge-detection (triggers)
    this._lastFilterAlarm   = null;
    this._lastAlarmGeneric  = null;
    this._lastPreset        = null;

    // ── Modbus TCP ────────────────────────────────────────────────────────────
    this._socket = new net.Socket();
    this._client = new Modbus.client.TCP(this._socket, this._settings.unit_id || 1, 15000);
    this._socket.setKeepAlive(true);
    this._socket.setMaxListeners(20);

    this._socket.on('connect', () => {
      this._modbusConnected   = true;
      this._reconnecting      = false;
      this._reconnectAttempts = 0;
      this.log('Modbus TCP connected');
      this.setAvailable().catch(() => {});
      this._setCapSafe('connection_status', true);
      this._startPolling();
    });
    this._socket.on('end',     () => this.log('Modbus socket ended'));
    this._socket.on('timeout', () => { this.log('Modbus timeout'); this._socket.destroy(); });
    this._socket.on('error',   err => this.log('Modbus error:', err.message));
    this._socket.on('close',   () => {
      this._modbusConnected = false;
      this.log('Modbus socket closed');
      this._stopPolling();
      this._setCapSafe('connection_status', false);
      this.setUnavailable(this.homey.__('device.disconnected')).catch(() => {});
      this._scheduleModbusReconnect();
    });

    // ── Capability listeners (UI + capability triggers → Modbus write) ────────
    this.registerCapabilityListener('ventilation_preset', async (v) => {
      await this.setVentilationPreset(Number(v));
    });
    this.registerCapabilityListener('away_mode', async (v) => {
      await this.setAwayMode(v);
    });
    this.registerCapabilityListener('boost_active', async (v) => {
      await this.setBoost(v, 3600);
    });
    this.registerCapabilityListener('temperature_profile', async (v) => {
      await this.setTemperatureProfile(Number(v));
    });
    this.registerCapabilityListener('target_temperature', async (v) => {
      await this.setExternalSetpoint(v);
    });

    // ── EnergyManager (optional, ComfoConnect binary protocol) ───────────────
    this._energyManager = new EnergyManager({
      ip:        this._settings.ip,
      uuid:      this._buildAppUuid(),
      comfouuid: this._settings.comfo_uuid || null,
      log:       this.log.bind(this),
      onValue:   (capId, value) => this._onEnergyValue(capId, value),
      onStatus:  (connected, reason) => this._onEnergyStatus(connected, reason),
    });

    if (this._settings.monitoring_enabled) {
      if (!this._settings.comfo_uuid) {
        this._discoverGatewayUuid().catch(err => {
          this.log('UUID auto-discovery failed:', err.message);
          this.log('→ Enter the gateway UUID manually in Device Settings');
        });
      } else {
        this._energyManager.enable().catch(err => this.log('EnergyManager start error:', err.message));
      }
    }

    // ── Initial Modbus connection ─────────────────────────────────────────────
    await this._modbusConnect().catch(err => {
      this.log('Initial Modbus connect failed:', err.message);
      this._scheduleModbusReconnect();
    });
  }

  // ── Energy callbacks ──────────────────────────────────────────────────────

  _onEnergyValue(capId, value) {
    this._setCapSafe(capId, value);
  }

  _onEnergyStatus(connected, reason) {
    this._setCapSafe('energy_session_status', connected);
    if (!connected && reason === 'other_session') {
      this.log('Energy: kicked by ComfoControl app / Zehnder Cloud — auto-recovering');
      this.setWarning(this.homey.__('warnings.energy_session_lost')).catch(() => {});
      this._triggerDevice('energy_session_lost');
    } else if (!connected && reason === 'disabled') {
      // deliberate — no warning
    } else if (!connected) {
      this.setWarning(this.homey.__('warnings.energy_disconnected')).catch(() => {});
    } else if (connected) {
      this.unsetWarning().catch(() => {});
      this._triggerDevice('energy_session_restored');
    }
  }

  // ── Gateway UUID discovery ────────────────────────────────────────────────

  async _discoverGatewayUuid() {
    this.log('EnergyManager: attempting UDP discovery on', this._settings.ip);
    const dgram = require('dgram');
    const uuid = await new Promise((resolve, reject) => {
      const sock  = dgram.createSocket('udp4');
      const timer = setTimeout(() => { sock.close(); reject(new Error('Discovery timeout (5s)')); }, 5000);
      sock.on('error', err => { clearTimeout(timer); reject(err); });
      sock.on('message', (msg) => {
        if (msg.length >= 20) {
          clearTimeout(timer);
          try { sock.close(); } catch (_) {}
          resolve(msg.slice(4, 20).toString('hex'));
        }
      });
      sock.bind(0, () => {
        sock.setBroadcast(true);
        sock.send(Buffer.from([0x0a, 0x00]), 56747, this._settings.ip, (err) => {
          if (err) sock.send(Buffer.from([0x0a, 0x00]), 56747, '255.255.255.255');
        });
      });
    });
    this.log('Discovered UUID:', uuid);
    await this.setSettings({ comfo_uuid: uuid });
    this._settings.comfo_uuid = uuid;
    this._energyManager._comfouuid = uuid;
    await this._energyManager.enable();
  }

  _buildAppUuid() {
    const raw = (this.getData().id || 'homey-zehnder-default').replace(/-/g, '');
    return raw.padEnd(32, '0').substring(0, 32);
  }

  // ── Modbus connection ─────────────────────────────────────────────────────

  async _modbusConnect() {
    if (this._modbusConnected) return;
    return new Promise((resolve, reject) => {
      const { ip: host, port = 502 } = this._settings;
      this.log(`Modbus connecting to ${host}:${port}`);
      const timer     = this.homey.setTimeout(() => { this._socket.destroy(); reject(new Error('Modbus timeout')); }, CONNECT_TIMEOUT_MS);
      const onError   = err => { this.homey.clearTimeout(timer); this._socket.removeListener('connect', onConnect); reject(err); };
      const onConnect = ()  => { this.homey.clearTimeout(timer); this._socket.removeListener('error', onError);   resolve(); };
      this._socket.once('connect', onConnect);
      this._socket.once('error',   onError);
      this._socket.connect(Number(port), host);
    });
  }

  async _modbusDisconnect() {
    return new Promise(resolve => {
      if (!this._modbusConnected) { resolve(); return; }
      this._socket.once('close', resolve);
      this._socket.end();
    });
  }

  _scheduleModbusReconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    this._reconnectAttempts++;
    const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts - 1), 60000);
    this.log(`Modbus reconnect in ${delay / 1000}s (attempt ${this._reconnectAttempts})`);
    this.homey.setTimeout(async () => {
      this._reconnecting = false;
      try { await this._modbusConnect(); } catch (err) {
        this.log('Modbus reconnect failed:', err.message);
        this._scheduleModbusReconnect();
      }
    }, delay);
  }

  // ── Polling ───────────────────────────────────────────────────────────────


  _startPolling() {
    this._stopPolling();
    const ms = (Number(this._settings.poll_interval) || 30) * 1000;
    this._pollAll().catch(err => this.log('Initial poll error:', err.message));
    this._pollingTimer = this.homey.setInterval(async () => {
      if (!this._modbusConnected) return;
      try { await this._pollAll(); } catch (err) { this.log('Poll error:', err.message); }
    }, ms);
  }

  _stopPolling() {
    if (this._pollingTimer) { this.homey.clearInterval(this._pollingTimer); this._pollingTimer = null; }
  }

  async _pollAll() {
    await this._pollDiscreteInputs();
    await this._pollInputRegisters();
    await this._pollHoldingRegisters();
    await this._pollCoils();
  }

  async _pollDiscreteInputs() {
    // Read discrete inputs individually — device may not support multi-register reads
    try {
      const r1 = await this._client.readDiscreteInputs(REG_DI_ERROR_FLAG, 1);
      const errorFlag = r1.response._body.valuesAsArray[0] === 1;
      await this._setCapSafe('alarm_generic', errorFlag);
      if (errorFlag  && this._lastAlarmGeneric === false) this._triggerDevice('alarm_turned_on');
      if (!errorFlag && this._lastAlarmGeneric === true)  this._triggerDevice('alarm_turned_off');
      this._lastAlarmGeneric = errorFlag;
    } catch (err) {
      const code = err.response && err.response.body && err.response.body.code;
      this.log('pollDI alarm err:', err.message, 'code:', code);
    }

    try {
      const r2 = await this._client.readDiscreteInputs(REG_DI_FILTER_REPLACE, 1);
      const filterAlarm = r2.response._body.valuesAsArray[0] === 1;
      await this._setCapSafe('filter_replace_alarm', filterAlarm);
      if (filterAlarm && this._lastFilterAlarm === false) this._triggerDevice('filter_replace_needed');
      this._lastFilterAlarm = filterAlarm;
    } catch (err) {
      const code = err.response && err.response.body && err.response.body.code;
      this.log('pollDI filter err:', err.message, 'code:', code);
    }
  }

  async _pollInputRegisters() {
    try {
      const res = await this._client.readInputRegisters(REG_IR_CONNECTION_STATUS, 17);
      const raw = res.response._body.valuesAsArray;
      await this._setCapSafe('connection_status', raw[0] === 0);
      const rt = tempFromReg(raw[7]),  et = tempFromReg(raw[8]);
      const ot = tempFromReg(raw[10]), st = tempFromReg(raw[11]);
      const rh = raw[12], oh = raw[15];
      // raw[7]=room sensor (external, may be 0 if not installed)
      // raw[8]=exhaust/ETA (return air from rooms = best indoor temp proxy)
      // raw[9]=outgoing/EHA (air leaving house)
      // raw[10]=outdoor/ODA
      // raw[11]=supply/SUP (air entering rooms after heat exchanger)
      const indoorTemp = isPlausibleTemp(rt) && rt !== 0 ? rt : et; // fallback to exhaust if no room sensor
      if (isPlausibleTemp(indoorTemp)) await this._setCapSafe('measure_temperature.indoor',  indoorTemp);
      if (isPlausibleTemp(ot)) await this._setCapSafe('measure_temperature.outdoor', ot);
      if (isPlausibleTemp(st)) await this._setCapSafe('measure_temperature.supply',  st);
      if (isPlausibleTemp(et)) await this._setCapSafe('measure_temperature.exhaust', et);
      // raw[12]=room humidity (external sensor, may be 0 if not installed)
      // raw[13]=exhaust humidity (ETA) = best indoor humidity proxy
      const exhaustHum = raw[13];
      const indoorHum = isPlausibleHum(rh) && rh !== 0 ? rh : exhaustHum;
      if (isPlausibleHum(indoorHum)) await this._setCapSafe('measure_humidity.indoor', indoorHum);
      if (isPlausibleHum(oh))        await this._setCapSafe('measure_humidity.outdoor', oh);
    } catch (err) { this.log('pollIR err:', err.message, 'code:', err.response && err.response.body && err.response.body.code); }
    try {
      const r2   = await this._client.readInputRegisters(REG_IR_FILTER_STATUS, 1);
      const days = r2.response._body.valuesAsArray[0];
      if (days >= 0 && days <= 730) await this._setCapSafe('filter_days_remaining', days);
    } catch (err) {
      const code = err.response && err.response.body && err.response.body.code;
      if (code === 2) {
        // Address 0x0019 not valid — filter status register may not exist on this firmware
        if (!this._filterStatusWarned) {
          this.log('pollFilter: register 0x0019 not available on this device (exception 2) — skipping');
          this._filterStatusWarned = true;
        }
      } else {
        this.log('pollFilter err:', err.message, 'code:', code);
      }
    }
  }

  async _pollHoldingRegisters() {
    try {
      // Read 5 registers: preset, temp profile, temp profile mode, ext setpoint (skip), party timer (skip)
      const res    = await this._client.readHoldingRegisters(REG_HR_VENTILATION_PRESET, 4);
      const values = res.response._body.valuesAsArray;
      const preset      = values[0]; // 0-3
      const tempProfile = values[1]; // 0-2
      // values[2] = temp profile mode (0-2) — not exposed as capability
      const extSetpointRaw = values[3]; // °C*10 unsigned — convert back
      const extSetpoint = toSigned16(extSetpointRaw) / 10;

      if (preset >= 0 && preset <= 3) {
        await this._setCapSafe('ventilation_preset', String(preset));
        await this._setCapSafe('away_mode', preset === 0);

        // Trigger: preset-specific triggers on change
        if (this._lastPreset !== null && this._lastPreset !== preset) {
          this._triggerDevice('ventilation_preset_changed', { preset });
          const presetTriggers = ['preset_is_away','preset_is_low','preset_is_medium','preset_is_high'];
          this._triggerDevice(presetTriggers[preset]);
        }
        this._lastPreset = preset;
      }

      if (tempProfile >= 0 && tempProfile <= 2) {
        await this._setCapSafe('temperature_profile', String(tempProfile));
      }

      if (extSetpoint > -50 && extSetpoint < 80) {
        await this._setCapSafe('target_temperature', extSetpoint);
      }

    } catch (err) { this.log('pollHR err:', err.message, 'code:', err.response && err.response.body && err.response.body.code); }
  }

  async _pollCoils() {
    try {
      const res = await this._client.readCoils(REG_COIL_ERROR_RESET, 9);
      await this._setCapSafe('boost_active', res.response._body.valuesAsArray[6] === 1);
    } catch (err) { this.log('pollCoils err:', err.message, 'code:', err.response && err.response.body && err.response.body.code); }
  }

  // ── Write commands ────────────────────────────────────────────────────────

  async setVentilationPreset(preset) {
    this._requireModbus();
    if (preset < 0 || preset > 3) throw new Error('Preset must be 0–3');
    await this._writeWithRetry(() => this._client.writeSingleRegister(REG_HR_VENTILATION_PRESET, preset), 'setVentilationPreset');
    await this._setCapSafe('ventilation_preset', String(preset));
    await this._setCapSafe('away_mode', preset === 0);
  }

  async setAwayMode(enabled) {
    this._requireModbus();
    if (enabled) {
      await this._writeWithRetry(() => this._client.writeSingleCoil(REG_COIL_PRESET_AWAY, true), 'setAwayMode');
    } else {
      if (this.getCapabilityValue('ventilation_preset') === '0')
        await this._writeWithRetry(() => this._client.writeSingleCoil(REG_COIL_PRESET_1, true), 'setAwayMode off');
    }
    await this._setCapSafe('away_mode', enabled);
  }

  async setBoost(active, durationSeconds = 3600) {
    this._requireModbus();
    if (active) {
      await this._writeWithRetry(() => this._client.writeSingleRegister(REG_HR_PARTY_TIMER_SECONDS, Math.min(durationSeconds, 65535)), 'setBoost timer');
      await this._writeWithRetry(() => this._client.writeSingleCoil(REG_COIL_PARTY_TIMER, true), 'setBoost on');
    } else {
      await this._writeWithRetry(() => this._client.writeSingleCoil(REG_COIL_PARTY_TIMER, false), 'setBoost off');
    }
    await this._setCapSafe('boost_active', active);
  }

  async setTemperatureProfile(profile) {
    this._requireModbus();
    if (profile < 0 || profile > 2) throw new Error('Profile must be 0–2');
    await this._writeWithRetry(() => this._client.writeSingleRegister(REG_HR_TEMPERATURE_PROFILE, profile), 'setTemperatureProfile');
    await this._setCapSafe('temperature_profile', String(profile));
  }

  /**
   * Set the external temperature setpoint (holding register 0x0003).
   * Value is stored as °C * 10, unsigned 16-bit.
   * Per spec:
   *   ≤19°C  → adjusts Cool profile setpoint
   *   19-23  → adjusts Normal profile setpoint
   *   ≥23°C  → adjusts Warm profile setpoint
   */
  async setExternalSetpoint(tempCelsius) {
    this._requireModbus();
    if (tempCelsius < 10 || tempCelsius > 35) throw new Error('Setpoint must be 10–35°C');
    const raw = Math.round(tempCelsius * 10);
    // Encode as unsigned 16-bit (handle negatives for cold setpoints)
    const unsigned = raw < 0 ? raw + 65536 : raw;
    await this._client.writeSingleRegister(REG_HR_EXTERNAL_SETPOINT, unsigned);
    await this._setCapSafe('target_temperature', tempCelsius);
    this.log(`External setpoint set to ${tempCelsius}°C (raw: ${raw})`);
  }

  /**
   * Set the temperature profile mode (holding register 0x0002).
   * 0 = adaptive, 1 = fixed, 2 = use external setpoint
   */
  async setTemperatureProfileMode(mode) {
    this._requireModbus();
    if (mode < 0 || mode > 2) throw new Error('Mode must be 0–2');
    await this._writeWithRetry(() => this._client.writeSingleRegister(REG_HR_TEMP_PROFILE_MODE, mode), 'setTemperatureProfileMode');
    this.log(`Temperature profile mode set to ${mode}`);
  }

  /**
   * Set ComfoClime on/off (coil 0x0008).
   * true  = device decides whether to activate ComfoClime
   * false = ComfoClime always off
   */
  async setComfoClime(enabled) {
    this._requireModbus();
    await this._writeWithRetry(() => this._client.writeSingleCoil(REG_COIL_COMFOCLIME, enabled), 'setComfoClime');
    this.log(`ComfoClime set to ${enabled}`);
  }

  async resetErrors() {
    this._requireModbus();
    await this._writeWithRetry(() => this._client.writeSingleCoil(REG_COIL_ERROR_RESET, true), 'resetErrors');
  }


  // ── Write with retry ─────────────────────────────────────────────────────
  async _writeWithRetry(fn, label) {
    try {
      return await fn();
    } catch (err) {
      if (err.message && err.message.includes('timeout')) {
        this.log(`${label}: timeout, retrying once after 1s...`);
        await new Promise(r => setTimeout(r, 1000));
        return await fn(); // one retry
      }
      throw err;
    }
  }

  _requireModbus() {
    if (!this._modbusConnected) throw new Error(this.homey.__('errors.not_connected'));
  }

  // ── Flow trigger helper ───────────────────────────────────────────────────

  _triggerDevice(id, tokens = {}) {
    this.homey.flow.getDeviceTriggerCard(id)
      .trigger(this, tokens)
      .catch(err => this.log(`Trigger ${id} error:`, err.message));
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  async onSettings({ newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);
    this._settings = newSettings;

    if (changedKeys.includes('monitoring_enabled')) {
      if (newSettings.monitoring_enabled) {
        this._energyManager._ip = newSettings.ip;
        if (!newSettings.comfo_uuid) {
          await this._discoverGatewayUuid().catch(err => this.log('Discovery err:', err.message));
        } else {
          this._energyManager._comfouuid = newSettings.comfo_uuid;
          await this._energyManager.enable();
        }
      } else {
        await this._energyManager.disable();
        await this._setCapSafe('energy_session_status', false);
      }
    }

    if (changedKeys.includes('comfo_uuid') && newSettings.comfo_uuid && newSettings.monitoring_enabled) {
      await this._energyManager.disable();
      this._energyManager._comfouuid = newSettings.comfo_uuid;
      this._energyManager._destroying = false;
      await this._energyManager.enable();
    }

    if (changedKeys.includes('ip')) {
      this._stopPolling();
      try { await this._modbusDisconnect(); } catch (_) {}
      if (newSettings.monitoring_enabled) await this._energyManager.updateIp(newSettings.ip);
    }

    if (changedKeys.includes('port') || changedKeys.includes('unit_id')) {
      this._stopPolling();
      try { await this._modbusDisconnect(); } catch (_) {}
      if (changedKeys.includes('unit_id'))
        this._client = new Modbus.client.TCP(this._socket, newSettings.unit_id || 1, 15000);
    }

    if (changedKeys.some(k => ['ip', 'port', 'unit_id'].includes(k))) {
      await this._modbusConnect().catch(err => {
        this.log('Post-settings reconnect failed:', err.message);
        this._scheduleModbusReconnect();
      });
    }

    if (changedKeys.includes('poll_interval') && this._modbusConnected) {
      this._startPolling();
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async onDeleted() {
    this.log('Device deleted');
    this._stopPolling();
    await this._energyManager.disable().catch(() => {});
    try { await this._modbusDisconnect(); } catch (_) {}
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  async _setCapSafe(capability, value) {
    try {
      if (this.hasCapability(capability))
        await this.setCapabilityValue(capability, value);
    } catch (err) { this.log(`setCapSafe(${capability}):`, err.message); }
  }
};