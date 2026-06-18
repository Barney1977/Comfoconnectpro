'use strict';
// Patches comfoairq/lib/analysis.js to guard against undefined PDO data
// which causes ERR_INVALID_ARG_TYPE crashes on fragmented TCP packets

const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'node_modules', 'comfoairq', 'lib', 'analysis.js');

if (!fs.existsSync(filePath)) {
  console.log('patch-comfoairq: file not found, skipping');
  process.exit(0);
}

let src = fs.readFileSync(filePath, 'utf8');

// Already patched?
if (src.includes('Guard against undefined data')) {
  console.log('patch-comfoairq: already patched');
  process.exit(0);
}

const guard = `    if (!sensorData || data.data === undefined || data.data === null) {
        return { pdid: data.pdid, name: sensorData ? sensorData.name : 'unknown', data: null };
    }\n`;

// Try both line endings
const targets = [
  "    const sensorData = config.sensorCodes.find( ({ code }) => code === data.pdid);\r\n    const binVal",
  "    const sensorData = config.sensorCodes.find( ({ code }) => code === data.pdid);\n    const binVal",
];

let patched = false;
for (const target of targets) {
  if (src.includes(target)) {
    const eol = target.includes('\r\n') ? '\r\n' : '\n';
    src = src.replace(target,
      `    const sensorData = config.sensorCodes.find( ({ code }) => code === data.pdid);${eol}    // Guard against undefined data${eol}${guard}    const binVal`
    );
    patched = true;
    break;
  }
}

if (patched) {
  fs.writeFileSync(filePath, src);
  console.log('patch-comfoairq: patched successfully');
} else {
  console.log('patch-comfoairq: pattern not found, may already be patched or library changed');
}