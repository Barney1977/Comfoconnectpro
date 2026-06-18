'use strict';
const Homey = require('homey');
class ZehnderComfoConnectProApp extends Homey.App {
  async onInit() {
    this.log('Zehnder ComfoConnect Pro v1.1.0 initialized');

    // Guard against uncaught buffer errors from comfoairq/bridge.js
    // These happen when the ComfoConnect Pro sends malformed TCP packets
    // (typically when both Modbus and binary protocol are active simultaneously)
    process.on('uncaughtException', (err) => {
      if (err && err.code === 'ERR_OUT_OF_RANGE') {
        this.log('WARNING: comfoairq bridge buffer error caught — will auto-recover:', err.message);
        // Do not rethrow — let the EnergyManager reconnect logic handle it
      } else {
        // Unknown error — log and rethrow
        this.error('Uncaught exception:', err);
        throw err;
      }
    });
  }
}
module.exports = ZehnderComfoConnectProApp;