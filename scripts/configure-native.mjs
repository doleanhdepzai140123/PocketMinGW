import { readFile, writeFile } from 'node:fs/promises';
const mutate = async (path, transform) => writeFile(path, transform(await readFile(path, 'utf8')));
await mutate('ios/App/CapApp-SPM/Package.swift', s => {
  s = s.replace('.iOS(.v15)', '.iOS(.v16)');
  if (!s.includes('name: "PocketRuntime"')) s = s.replace('dependencies: [', 'dependencies: [\n        .package(name: "PocketRuntime", path: "../../../native"),');
  if (!s.includes('.product(name: "PocketRuntime"')) s = s.replace('.product(name: "Capacitor",', '.product(name: "PocketRuntime", package: "PocketRuntime"),\n                .product(name: "Capacitor",');
  return s;
});
await mutate('ios/App/App.xcodeproj/project.pbxproj', s => s.replace(/IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;'));
await mutate('ios/App/App/Base.lproj/Main.storyboard', s => s.replace('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="PocketViewController" customModule="PocketRuntime"'));
await mutate('ios/App/App/Info.plist', s => {
  if(!s.includes('UIFileSharingEnabled'))s=s.replace('<key>LSRequiresIPhoneOS</key>', '<key>UIFileSharingEnabled</key><true/>\n\t<key>LSSupportsOpeningDocumentsInPlace</key><true/>\n\t<key>LSRequiresIPhoneOS</key>');
  return s;
});
console.log('Native interpreter registered; iOS 16+ configured.');
