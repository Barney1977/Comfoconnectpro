'use strict';

/**
 * EnergyManager
 *
 * Manages an optional second connection to the ComfoConnect Pro using the
 * binary ComfoConnect protocol (port 56747) for energy and fan-flow data.
 *
 * Key design principles:
 *  - Completely independent from the Modbus TCP connection.
 *  - Auto-reconnects after being kicked by another client (ComfoControl app,
 *    Zehnder Cloud). Reconnect delay backs off exponentially.
 *  - Can be enabled/disabled via device settings without restart.
 *  - Fires onValue(capabilityId, value) whenever a PDO notification arrives.
 *
 * Data flow:
 *  comfoairq library handles all protobuf decoding internally.
 *  On 'receive' event, data.kind === 40 means CnRpdoNotification.
 *  data.result.data is already decoded by analyze_CnRpdoNotification:
 *    { pdid: <number>, name: <string>, data: <number> }
 *  We map pdid → Homey capability ID and forward the value.
 */

const EventEmitter = require('events');

// Map from PDO sensor code → Homey capability ID
// Values are already decoded numbers by the time we receive them.
// Minimum change required before updating a capability value
// Prevents constant updates for minor sensor fluctuations
const SENSOR_THRESHOLDS = {
  'measure_rotation': 50,   // RPM
  'measure_water':     5,   // m³/h
  'measure_power':     2,   // W
  'measure_humidity':  2,   // %
  'meter_power':       0,   // kWh — always update
};

const SENSOR_MAP = {
  128: 'measure_power',               // W actueel
  129: 'meter_power.year',            // kWh dit jaar
  130: 'meter_power',                 // kWh totaal
  146: 'measure_power.preheater',     // W voorverwarmer
  119: 'measure_water.exhaust',       // m³/h afvoer
  120: 'measure_water.supply',        // m³/h toevoer
  121: 'measure_rotation.exhaust',    // RPM afvoer
  122: 'measure_rotation.supply',     // RPM toevoer
  118: 'measure_humidity.duty_supply',// % belasting toevoer
  117: 'measure_humidity.duty_exhaust',// % belasting afvoer (bonus)
  227: 'measure_humidity.bypass',     // % bypassstand
  192: 'filter_days_remaining',       // dagen tot filterwissel (bonus via energy layer)
};

// Reconnect timing
const RECONNECT_BASE_MS = 15 * 1000;  // 15s eerste poging
const RECONNECT_MAX_MS  = 300 * 1000; // max 5 min

class EnergyManager extends EventEmitter {

  /**
   * @param {object} opts
   * @param {string}   opts.ip         IP of the ComfoConnect Pro
   * @param {string}   opts.uuid       Stable 32-char hex UUID for this Homey instance
   * @param {string}   opts.comfouuid  Gateway UUID (32-char hex), or null for discovery
   * @param {Function} opts.log        Logger (this.log from Device)
   * @param {Function} opts.onValue    callback(capabilityId, value)
   * @param {Function} opts.onStatus   callback(connected: bool, reason: string)
   */
  constructor(opts) {
    super();
    this._ip        = opts.ip;
    this._uuid      = opts.uuid;
    this._comfouuid = opts.comfouuid;
    this._log       = opts.log || (() => {});
    this._onValue   = opts.onValue  || (() => {});
    this._onStatus  = opts.onStatus || (() => {});

    this._comfo             = null;
    this._lastValues        = {}; // deduplicate repeated PDO notifications
    this._enabled           = false;
    this._sessionActive     = false;
    this._reconnectTimer    = null;
    this._reconnectAttempts = 0;
    this._destroying        = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async enable() {
    if (this._enabled) return;
    this._enabled    = true;
    this._destroying = false;
    this._log('EnergyManager: enabled');
    await this._connect();
  }

  async disable() {
    if (!this._enabled) return;
    this._enabled    = false;
    this._destroying = true;
    this._log('EnergyManager: disabled');
    this._clearReconnectTimer();
    await this._disconnect();
    this._onStatus(false, 'disabled');
  }

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

    if (!this._comfouuid) {
      this._log('EnergyManager: no gateway UUID yet, retrying in 30s');
      this._scheduleReconnect('no_uuid');
      return;
    }

    try {
      const ComfoAirQ = require('comfoairq');

      this._comfo = new ComfoAirQ({
        pin:       '0000',
        uuid:      this._uuid,
        device:    'HomeyZehnder',
        comfoair:  this._ip,
        comfouuid: this._comfouuid,
        port:      56747,
        debug:     false,
        logger:    (msg) => this._log('comfoairq: ' + msg),
      });

      // ── Guard against bridge.js buffer crashes ────────────────────────────
      // comfoairq/lib/bridge.js can throw ERR_OUT_OF_RANGE on malformed packets
      const bridgeErrorHandler = (err) => {
        if (err && err.code === 'ERR_OUT_OF_RANGE') {
          this._log('EnergyManager: bridge buffer error (malformed packet) — reconnecting');
          this._sessionActive = false;
          this._onStatus(false, 'bridge_error');
          try { this._comfo.removeAllListeners(); } catch(_) {}
          this._comfo = null;
          if (!this._destroying && this._enabled) this._scheduleReconnect('bridge_error');
        }
      };
      // Attach to the underlying socket if accessible
      try {
        if (this._comfo._bridge && this._comfo._bridge._socket) {
          this._comfo._bridge._socket.on('error', bridgeErrorHandler);
        }
      } catch(_) {}

      // ── PDO sensor value received ──────────────────────────────────────────
      // comfoairq has already decoded the value via analyze_CnRpdoNotification.
      // data.result.data = { pdid: number, name: string, data: number }
      // data is the final numeric value — no further decoding needed.
      this._comfo.on('receive', (data) => {
        try {
          if (data.kind !== 40) return; // only CnRpdoNotification

          const pdo = data.result && data.result.data;
          if (!pdo || typeof pdo !== 'object') return;

          const pdid  = pdo.pdid;
          const value = pdo.data; // already a number
          if (value === null || value === undefined) return; // guard against patched null returns

          const capId = SENSOR_MAP[pdid];
          if (!capId) return; // sensor not mapped

          if (typeof value !== 'number' || isNaN(value)) return;

          // Only update if value changed (PDO sends initial burst of identical values)
          // Threshold-based deduplication to reduce unnecessary UI updates
          const baseType = capId.split('.')[0];
          const threshold = SENSOR_THRESHOLDS[baseType] !== undefined ? SENSOR_THRESHOLDS[baseType] : 0;
          const lastVal = this._lastValues[capId];
          const changed = lastVal === undefined || Math.abs(value - lastVal) > threshold;
          if (changed) {
            this._lastValues[capId] = value;
            this._log(`EnergyManager: pdid=${pdid} → ${capId} = ${value}`);
            this._onValue(capId, value);
          }

        } catch (err) {
          this._log('EnergyManager: receive handler error:', err.message);
        }
      });

      // ── Kicked by another client or TCP drop ──────────────────────────────
      this._comfo.on('disconnect', (reason) => {
        this._sessionActive = false;
        const why = (reason && reason.state) || 'UNKNOWN';
        this._log(`EnergyManager: disconnected (${why})`);
        this._onStatus(false, why === 'OTHER_SESSION' ? 'other_session' : 'disconnected');
        if (!this._destroying && this._enabled) {
          this._scheduleReconnect(why);
        }
      });

      // ── Register app & start session ──────────────────────────────────────
      this._log(`EnergyManager: connecting to ${this._ip}:56747`);
      await this._comfo.RegisterApp();
      await this._comfo.StartSession(false); // false = don't force-kick other clients

      if (!this._comfo._status.connected) {
        throw new Error('StartSession returned but not connected');
      }

      // ── Register sensors ──────────────────────────────────────────────────
      for (const code of Object.keys(SENSOR_MAP).map(Number)) {
        try {
          await this._comfo.RegisterSensor(code);
          await _sleep(80);
        } catch (err) {
          this._log(`EnergyManager: RegisterSensor(${code}) failed:`, err.message);
        }
      }

      this._sessionActive     = true;
      this._reconnectAttempts = 0;
      this._log('EnergyManager: session active, all sensors registered');
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
        await Promise.race([
          this._comfo.CloseSession(),
          new Promise(r => setTimeout(r, 2000)) // 2s timeout on close
        ]);
      }
    } catch (_) {}
    // Force-destroy the underlying TCP socket to prevent lingering errors
    try {
      if (this._comfo._bridge && this._comfo._bridge.sock) {
        this._comfo._bridge.sock.removeAllListeners();
        this._comfo._bridge.sock.destroy();
      }
    } catch (_) {}
    try { this._comfo.removeAllListeners(); } catch (_) {}
    this._comfo         = null;
    this._sessionActive = false;
    this._lastValues    = {};
  }

  // ── Reconnect with exponential backoff ─────────────────────────────────────

  _scheduleReconnect(reason) {
    this._clearReconnectTimer();
    if (this._destroying || !this._enabled) return;
    this._reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempts - 1),
      RECONNECT_MAX_MS
    );
    this._log(`EnergyManager: reconnect attempt ${this._reconnectAttempts} in ${Math.round(delay/1000)}s (${reason})`);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (!this._enabled || this._destroying) return;
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