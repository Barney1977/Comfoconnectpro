'use strict';

const Homey = require('homey');

module.exports = class ZehnderComfoConnectProDriver extends Homey.Driver {

  async onInit() {
    this.log('ZehnderComfoConnectProDriver initialized');
    this._registerFlowCards();
  }

  _registerFlowCards() {

    // ── Actions ───────────────────────────────────────────────────────────────

    this.homey.flow.getActionCard('set_ventilation_preset')
      .registerRunListener(async ({ device, preset }) => {
        await device.setVentilationPreset(Number(preset));
      });

    this.homey.flow.getActionCard('set_away_mode')
      .registerRunListener(async ({ device, enabled }) => {
        await device.setAwayMode(enabled === 'true');
      });

    this.homey.flow.getActionCard('set_boost')
      .registerRunListener(async ({ device, duration_minutes }) => {
        await device.setBoost(true, Math.round(duration_minutes * 60));
      });

    this.homey.flow.getActionCard('stop_boost')
      .registerRunListener(async ({ device }) => {
        await device.setBoost(false, 0);
      });

    this.homey.flow.getActionCard('set_temperature_profile')
      .registerRunListener(async ({ device, profile }) => {
        await device.setTemperatureProfile(Number(profile));
      });

    this.homey.flow.getActionCard('reset_errors')
      .registerRunListener(async ({ device }) => {
        await device.resetErrors();
      });

    this.homey.flow.getActionCard('set_external_setpoint')
      .registerRunListener(async ({ device, temperature }) => {
        await device.setExternalSetpoint(Number(temperature));
      });

    this.homey.flow.getActionCard('set_temperature_profile_mode')
      .registerRunListener(async ({ device, mode }) => {
        await device.setTemperatureProfileMode(Number(mode));
      });

    this.homey.flow.getActionCard('set_auto_mode')
      .registerRunListener(async ({ device, enabled }) => {
        await device.setAutoMode(enabled === 'true');
      });

    this.homey.flow.getActionCard('set_comfoclime')
      .registerRunListener(async ({ device, enabled }) => {
        await device.setComfoClime(enabled === 'true');
      });

    // ── Conditions ────────────────────────────────────────────────────────────

    this.homey.flow.getConditionCard('is_away_mode')
      .registerRunListener(async ({ device }) => {
        return device.getCapabilityValue('away_mode') === true;
      });

    this.homey.flow.getConditionCard('is_boost_active')
      .registerRunListener(async ({ device }) => {
        return device.getCapabilityValue('boost_active') === true;
      });

    this.homey.flow.getConditionCard('filter_needs_replacement')
      .registerRunListener(async ({ device }) => {
        return device.getCapabilityValue('filter_replace_alarm') === true;
      });

    this.homey.flow.getConditionCard('energy_session_active')
      .registerRunListener(async ({ device }) => {
        return device.getCapabilityValue('energy_session_status') === true;
      });

    this.homey.flow.getConditionCard('ventilation_preset_is')
      .registerRunListener(async ({ device, preset }) => {
        return device.getCapabilityValue('ventilation_preset') === String(preset);
      });

    this.homey.flow.getConditionCard('temperature_profile_is')
      .registerRunListener(async ({ device, profile }) => {
        return device.getCapabilityValue('temperature_profile') === String(profile);
      });

    this.homey.flow.getConditionCard('unit_alarm_active')
      .registerRunListener(async ({ device }) => {
        return device.getCapabilityValue('alarm_generic') === true;
      });

    this.homey.flow.getConditionCard('is_auto_mode')
      .registerRunListener(async ({ device }) => {
        return device.getCapabilityValue('auto_mode') === true;
      });
  }

  async onPair(session) {
    this.log('onPair()');

    let pairSettings = { ip: '', port: 502, unit_id: 1 };

    session.setHandler('settingsChanged', async (data) => {
      pairSettings = { ...pairSettings, ...data };
      return true;
    });

    session.setHandler('getSettings', async () => pairSettings);

    session.setHandler('list_devices', async () => {
      if (!pairSettings.ip) throw new Error(this.homey.__('errors.ip_required'));
      const port = Number(pairSettings.port) || 502;
      if (!port || port < 1 || port > 65535) throw new Error(this.homey.__('errors.port_invalid'));
      return [{
        name: `Zehnder ComfoConnect Pro (${pairSettings.ip})`,
        data: { id: this._generateId() },
        settings: { ip: pairSettings.ip, port, unit_id: Number(pairSettings.unit_id) || 1, poll_interval: 30 },
      }];
    });
  }

  _generateId() {
    const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
  }
};