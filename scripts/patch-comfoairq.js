'use strict';
// Patches comfoairq library to handle TCP fragmentation correctly
// This prevents ERR_OUT_OF_RANGE crashes caused by split TCP packets

const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..', 'node_modules', 'comfoairq', 'lib');

// ── Patch 1: bridge.js — proper TCP stream buffering ─────────────────────────
const bridgePath = path.join(base, 'bridge.js');
if (fs.existsSync(bridgePath)) {
  let src = fs.readFileSync(bridgePath, 'utf8');
  if (src.includes('// TCP fragmentation buffer fix')) {
    console.log('patch-comfoairq: bridge.js already patched');
  } else {
    // Replace naive data handler with buffered version
    // Works for both LF and CRLF line endings
    const markerStart = "this.sock.on('data', (data) => {";
    const markerEnd = "        });";
    
    const startIdx = src.indexOf(markerStart);
    if (startIdx === -1) {
      console.log('patch-comfoairq: bridge.js data handler not found');
    } else {
      // Find the closing }); of the data handler
      let depth = 0;
      let endIdx = startIdx;
      for (let i = startIdx; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}') { depth--; if (depth === 0) { endIdx = i + 3; break; } }
      }
      
      const eol = src.includes('\r\n') ? '\r\n' : '\n';
      const newHandler = `this._rxBuffer = Buffer.alloc(0);${eol}${eol}        this.sock.on('data', (data) => {${eol}            // TCP fragmentation buffer fix — accumulate data for complete messages${eol}            this._rxBuffer = Buffer.concat([this._rxBuffer, data]);${eol}            let offset = 0;${eol}            while (offset + 4 <= this._rxBuffer.length) {${eol}                const msglen = this._rxBuffer.readInt32BE(offset);${eol}                if (msglen <= 0 || msglen > 65535) {${eol}                    this._rxBuffer = Buffer.alloc(0); break;${eol}                }${eol}                const totalLen = msglen + 4;${eol}                if (offset + totalLen > this._rxBuffer.length) break;${eol}                const buffer = this._rxBuffer.slice(offset, offset + totalLen);${eol}                const rxdata = { 'time': new Date(), 'data': buffer, 'kind': -1, 'msg': null };${eol}                if (this._settings.debug) this.logger(' <- RX : ' + buffer.toString('hex'));${eol}                this.emit('received', rxdata);${eol}                offset += totalLen;${eol}            }${eol}            this._rxBuffer = offset > 0 ? this._rxBuffer.slice(offset) : this._rxBuffer;${eol}        });`;
      
      src = src.substring(0, startIdx) + newHandler + src.substring(endIdx);
      fs.writeFileSync(bridgePath, src);
      console.log('patch-comfoairq: bridge.js TCP fragmentation fix applied');
    }
  }
} else {
  console.log('patch-comfoairq: bridge.js not found');
}

// ── Patch 2: analysis.js — guard against undefined PDO data ──────────────────
const analysisPath = path.join(base, 'analysis.js');
if (fs.existsSync(analysisPath)) {
  let src = fs.readFileSync(analysisPath, 'utf8');
  if (!src.includes('Guard against undefined data')) {
    const targets = [
      "    const sensorData = config.sensorCodes.find( ({ code }) => code === data.pdid);\r\n    const binVal",
      "    const sensorData = config.sensorCodes.find( ({ code }) => code === data.pdid);\n    const binVal",
    ];
    for (const target of targets) {
      if (src.includes(target)) {
        const eol = target.includes('\r\n') ? '\r\n' : '\n';
        const guard = `    // Guard against undefined data${eol}    if (!sensorData || data.data === undefined || data.data === null) {${eol}        return { pdid: data.pdid, name: sensorData ? sensorData.name : 'unknown', data: null };${eol}    }${eol}`;
        src = src.replace(target,
          `    const sensorData = config.sensorCodes.find( ({ code }) => code === data.pdid);${eol}${guard}    const binVal`
        );
        fs.writeFileSync(analysisPath, src);
        console.log('patch-comfoairq: analysis.js patched');
        break;
      }
    }
  } else {
    console.log('patch-comfoairq: analysis.js already patched');
  }
}
