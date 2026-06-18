'use strict';

/**
 * EnergyManager
 *
 * Manages an optional second connection to the ComfoConnect Pro using the
 * binary ComfoConnect protocol (port 56747) for energy and fan-flow data.
 *
 * Key design principles:
 *  - Completely independent from the Modbus TCP connection. If this layer
 *    fails, the Modbus layer (controls + sensors) keeps working normally.
 *  - Auto-reconnects after being kicked by another client (ComfoControl app,
 *    Zehnder Cloud). The reconnect delay backs off exponentially so we don't
 *    hammer the gateway when the app is in active use.
 *  - Can be fully enabled/disabled via device settings without restart.
 *  - Fires a callback with fresh values whenever a PDO notification arrives.
 *
 * Session lifecycle:
 *  1. connect()      → TCP + RegisterApp + StartSession + RegisterSensors
 *  2. Running        → PDO notifications arrive as 'receive' events
 *  3. Kicked         → 'disconnect' event with state === 'OTHER_SESSION'
 *                      → schedule reconnect with backoff
 *  4. TCP error/drop → 'disconnect' event with state === 'DISC'
 *                      → schedule reconnect with backoff
 *  5. disconnect()   → clean CloseSession + destroy socket (e.g. device deleted
 *                      or setting toggled off)
 */

const EventEmitter = require('events');

// Sensor PDO codes (from comfoairq const.js, confirmed against aiocomfoconnect)
const SENSORS = [
  { code: 128, name: 'measure_power',           unit: 'W',   kind: 2 }, // actueel W
  { code: 129, name: 'meter_power.year',        unit: 'kWh', kind: 2 }, // kWh dit jaar
  { code: 130, name: 'meter_power',             unit: 'kWh', kind: 2 }, // kWh totaal
  { code: 146, name: 'measure_power.preheater', unit: 'W',   kind: 2 }, // voorverwarmer W
  { code: 119, name: 'measure_water.exhaust',    unit: 'm3h', kind: 2 }, // m³/h afvoer
  { code: 120, name: 'measure_water.supply',     unit: 'm3h', kind: 2 }, // m³/h toevoer
  { code: 121, name: 'measure_rotation.exhaust',     unit: 'rpm', kind: 2 }, // RPM afvoer
  { code: 122, name: 'measure_rotation.supply',      unit: 'rpm', kind: 2 }, // RPM toevoer
  { code: 118, name: 'measure_humidity.duty_supply',     unit: '%',   kind: 1 }, // duty% toevoer
  { code: 117, name: 'measure_duty.exhaust',    unit: '%',   kind: 1 }, // duty% afvoer
  { code: 227, name: 'measure_humidity.bypass',          unit: '%',   kind: 1 }, // bypass stand %
];

// Reconnect timing
const RECONNECT_BASE_MS  =  15 * 1000; // first retry after 15 s
const RECONNECT_MAX_MS   = 300 * 1000; // max 5 min between retries
const RECONNECT_FACTOR   = 2;          // exponential backoff multiplier

function decodePdoValue(base64Data, kind) {
  const buf = Buffer.from(base64Data, 'base64');
  switch (kind) {
    case 1: return buf.readInt8(0);
    case 2: return buf.readInt16LE(0);
    case 6: return buf.readInt16LE(0) / 10;
    default: return null;
  }
}

class EnergyManager extends EventEmitter {

  /**
   * @param {object} opts
   * @param {string}   opts.ip          - IP of the ComfoConnect Pro
   * @param {string}   opts.uuid        - Homey's app UUID (stable, 32 hex chars)
   * @param {string}   opts.comfouuid   - ComfoConnect Pro device UUID (32 hex chars)
   * @param {Function} opts.log         - logger function (this.log from Device)
   * @param {Function} opts.onValue     - callback(capabilityId, value) on new sensor value
   * @param {Function} opts.onStatus    - callback(connected: bool, reason: string)
   */
  constructor(opts) {
    super();
    this._ip         = opts.ip;
    this._uuid       = opts.uuid;       // our app's UUID
    this._comfouuid  = opts.comfouuid;  // gateway UUID
    this._log        = opts.log || (() => {});
    this._onValue    = opts.onValue    || (() => {});
    this._onStatus   = opts.onStatus   || (() => {});

    this._comfo          = null;   // comfoairq instance
    this._enabled        = false;  // set by enable()/disable()
    this._sessionActive  = false;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._destroying     = false;  // true during disconnect() → skip reconnect
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Start energy monitoring. Safe to call multiple times. */
  async enable() {
    if (this._enabled) return;
    this._enabled    = true;
    this._destroying = false;
    this._log('EnergyManager: enabled');
    await this._connect();
  }

  /** Stop energy monitoring and clean up. */
  async disable() {
    if (!this._enabled) return;
    this._enabled    = false;
    this._destroying = true;
    this._log('EnergyManager: disabled');
    this._clearReconnectTimer();
    await this._disconnect();
    this._onStatus(false, 'disabled');
  }

  /** Call when IP changes (settings update). */
  async updateIp(ip) {
    this._ip = ip;
    if (this._enabled) {
      await this.disable();
      this._destroying = false;
      await this.enable();
    }
  }

  // ── Connection lifecycle ────────────────────────────────────────────────────

  async _connect() {
    if (!this._enabled || this._destroying) return;

    // Require comfouuid — if not yet discovered, schedule retry
    if (!this._comfouuid) {
      this._log('EnergyManager: no gateway UUID yet, retrying in 30s');
      this._scheduleReconnect('no_uuid');
      return;
    }

    try {
      // Dynamically require so missing module doesn't break the whole app
      const ComfoAirQ = require('comfoairq');

      // Generate a stable 12-char device name (Homey)
      const deviceName = 'HomeyZehnder';

      this._comfo = new ComfoAirQ({
        pin:       '0000',
        uuid:      this._uuid,
        device:    deviceName,
        comfoair:  this._ip,
        comfouuid: this._comfouuid,
        port:      56747,
        debug:     false,
        logger:    (msg) => this._log('comfoairq: ' + msg),
      });

      // ── Event: PDO sensor value received ──────────────────────────────────
      this._comfo.on('receive', (data) => {
        if (data.kind !== 40) return; // only CnRpdoNotification
        const pdoResult = data.result && data.result.data;
        if (!pdoResult) return;

        const sensor = SENSORS.find(s => s.code === pdoResult.pdid);
        if (!sensor) return;

        const value = decodePdoValue(pdoResult.data, sensor.kind);
        if (value === null) return;

        this._log(`EnergyManager: ${sensor.name} = ${value} ${sensor.unit}`);
        this._onValue(sensor.name, value);
      });

      // ── Event: kicked by another client or TCP drop ────────────────────────
      this._comfo.on('disconnect', (reason) => {
        this._sessionActive = false;
        const why = (reason && reason.state) || 'UNKNOWN';
        this._log(`EnergyManager: disconnected (${why})`);

        if (why === 'OTHER_SESSION') {
          // ComfoControl app or Zehnder Cloud took priority — back off politely
          this._onStatus(false, 'other_session');
        } else {
          this._onStatus(false, 'disconnected');
        }

        if (!this._destroying && this._enabled) {
          this._scheduleReconnect(why);
        }
      });

      // ── Register app & start session ──────────────────────────────────────
      this._log(`EnergyManager: connecting to ${this._ip}:56747`);
      await this._comfo.RegisterApp();
      await this._comfo.StartSession(false); // false = don't force (polite)

      if (!this._comfo._status.connected) {
        throw new Error('StartSession returned but not connected');
      }

      // ── Register all sensors ──────────────────────────────────────────────
      for (const sensor of SENSORS) {
        await this._comfo.RegisterSensor(sensor.code);
        await _sleep(80); // small gap between registrations
      }

      this._sessionActive = true;
      this._reconnectAttempts = 0;
      this._log('EnergyManager: session active, sensors registered');
      this._onStatus(true, 'connected');

    } catch (err) {
      this._sessionActive = false;
      this._log(`EnergyManager: connect failed — ${err.message}`);
      this._onStatus(false, 'connect_failed');
      if (!this._destroying && this._enabled) {
        this._scheduleReconnect('connect_failed');
      }
    }
  }

  async _disconnect() {
    if (!this._comfo) return;
    try {
      if (this._sessionActive) {
        await this._comfo.CloseSession();
      }
    } catch (_) { /* ignore errors during teardown */ }
    try {
      this._comfo.removeAllListeners();
    } catch (_) {}
    this._comfo = null;
    this._sessionActive = false;
  }

  // ── Reconnect with exponential backoff ─────────────────────────────────────

  _scheduleReconnect(reason) {
    this._clearReconnectTimer();
    if (this._destroying || !this._enabled) return;

    this._reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, this._reconnectAttempts - 1),
      RECONNECT_MAX_MS
    );

    this._log(`EnergyManager: reconnect attempt ${this._reconnectAttempts} in ${Math.round(delay/1000)}s (reason: ${reason})`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (!this._enabled || this._destroying) return;
      // Clean up old instance before reconnecting
      await this._disconnect();
      await this._connect();
    }, delay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = EnergyManager;
