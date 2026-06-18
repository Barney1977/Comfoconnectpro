'use strict';
// Patches comfoairq library to prevent crashes on malformed TCP packets

const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..', 'node_modules', 'comfoairq', 'lib');

// ── Patch 1: analysis.js — guard against undefined PDO data ──────────────────
const analysisPath = path.join(base, 'analysis.js');
if (fs.existsSync(analysisPath)) {
  let src = fs.readFileSync(analysisPath, 'utf8');
  if (!src.includes('Guard against undefined data')) {
    const guard = `    if (!sensorData || data.data === undefined || data.data === null) {
        return { pdid: data.pdid, name: sensorData ? sensorData.name : 'unknown', data: null };
    }\n`;
    const targets = [
      "    const sensorData = config.sensorCodes.find( ({ code }) => code === data.pdid);\r\n    const binVal",
      "    const sensorData = config.sensorCodes.find( ({ code }) => code === data.pdid);\n    const binVal",
    ];
    for (const target of targets) {
      if (src.includes(target)) {
        const eol = target.includes('\r\n') ? '\r\n' : '\n';
        src = src.replace(target,
          `    const sensorData = config.sensorCodes.find( ({ code }) => code === data.pdid);${eol}    // Guard against undefined data${eol}${guard}    const binVal`
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

// ── Patch 2: bridge.js — guard against negative buffer offsets ────────────────
const bridgePath = path.join(base, 'bridge.js');
if (fs.existsSync(bridgePath)) {
  let src = fs.readFileSync(bridgePath, 'utf8');
  if (!src.includes('Bridge offset guard')) {
    // Find the readInt32BE call for message length
    const targets = [
      'const msgLen = data.readInt32BE(offset + 4);',
      'var msgLen = data.readInt32BE(offset + 4);',
    ];
    for (const target of targets) {
      if (src.includes(target)) {
        src = src.replace(target,
          `// Bridge offset guard\n            if (offset < 0 || offset + 8 > data.length) { offset = 0; break; }\n            ${target}`
        );
        fs.writeFileSync(bridgePath, src);
        console.log('patch-comfoairq: bridge.js patched');
        break;
      }
    }
    if (!src.includes('Bridge offset guard')) {
      console.log('patch-comfoairq: bridge.js pattern not found — may need manual review');
    }
  } else {
    console.log('patch-comfoairq: bridge.js already patched');
  }
}