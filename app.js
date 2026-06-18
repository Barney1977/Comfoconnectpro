'use strict';
const Homey = require('homey');
class ZehnderComfoConnectProApp extends Homey.App {
  async onInit() {
    this.log('Zehnder ComfoConnect Pro v1.1.0 initialized');

    // Guard against uncaught buffer errors from comfoairq/bridge.js
    // These happen when the ComfoConnect Pro sends malformed TCP packets
    // (typically when both Modbus and binary protocol are active simultaneously)
    process.on('uncaughtException', (err) => {
      // Catch known comfoairq library errors that occur on malformed/fragmented
      // TCP packets from the ComfoConnect Pro binary protocol
      const isComfoairqError = err && err.stack && (
        err.stack.includes('comfoairq') ||
        err.stack.includes('analysis.js') ||
        err.stack.includes('bridge.js')
      );
      if (isComfoairqError) {
        this.log('WARNING: comfoairq library error caught — will auto-recover:', err.message);
        // Do not rethrow — EnergyManager reconnect logic handles this
      } else {
        this.error('Uncaught exception:', err);
        throw err;
      }
    });
  }
}
module.exports = ZehnderComfoConnectProApp;