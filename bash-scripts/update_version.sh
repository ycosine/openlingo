#!/usr/bin/env bash

set -euo pipefail

version="${1:-}"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version format <$version> isn't correct, proper format is <0.0.0>."
  exit 1
fi

# Only these packages define the shipped OpenLingo version. The other
# workspace packages are private build tooling and keep their own versions.
node - "$version" <<'NODE'
const fs = require('node:fs');

const version = process.argv[2];
const packageFiles = ['package.json', 'chrome-extension/package.json'];

for (const packageFile of packageFiles) {
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  packageJson.version = version;
  fs.writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`);
}
NODE

echo "Updated OpenLingo versions to $version."
