'use strict';
const Homey = require('homey');
class ZehnderComfoConnectProApp extends Homey.App {
  async onInit() {
    this.log('Zehnder ComfoConnect Pro v1.1.0 initialized');
  }
}
module.exports = ZehnderComfoConnectProApp;
