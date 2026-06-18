'use strict';
const Homey = require('homey');
class ZehnderComfoConnectProApp extends Homey.App {
  async onInit() {
    this.log('Zehnder ComfoConnect Pro v1.1.0 initialized');

    // Guard against uncaught buffer errors from comfoairq/bridge.js
    // These happen when the ComfoConnect Pro sends malformed TCP packets
    // (typically when both Modbus and binary protocol are active simultaneously)
    this._lastBridgeError = 0;

    process.on('uncaughtException', (err) => {
      const isComfoairqError = err && err.stack && (
        err.stack.includes('comfoairq') ||
        err.stack.includes('analysis.js') ||
        err.stack.includes('bridge.js')
      );
      if (isComfoairqError) {
        const now = Date.now();
        // Throttle: only log once per 10 seconds to prevent event loop flooding
        if (now - this._lastBridgeError > 10000) {
          this.log('WARNING: comfoairq bridge error — triggering reconnect:', err.message);
          this._lastBridgeError = now;

          // Find all devices and trigger energy reconnect
          try {
            const driver = this.homey.drivers.getDriver('zehnder-comfoconnect-pro');
            const devices = driver.getDevices();
            devices.forEach(device => {
              if (device._energyManager) {
                device._energyManager._sessionActive = false;
                device._energyManager._onStatus(false, 'bridge_error');
                device._energyManager._disconnect().catch(() => {}).then(() => {
                  device._energyManager._scheduleReconnect('bridge_error');
                });
              }
            });
          } catch(e) { /* ignore */ }
        }
      } else {
        this.error('Uncaught exception:', err);
        throw err;
      }
    });
  }
}
module.exports = ZehnderComfoConnectProApp;