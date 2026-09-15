export function validateDesktopManifest(value){
 if(!value||value.schemaVersion!==1||value.id!=='stock-loom-desktop'||value.hostProtocol!==1||value.entry!=='host-stdio.mjs')throw Error('Unsupported Computer Use extension');
 if(typeof value.version!=='string'||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.version)||typeof value.displayName!=='string'||!value.displayName||value.license!=='MIT')throw Error('Invalid Computer Use metadata');
 if(!Array.isArray(value.platforms)||value.platforms.length!==1||value.platforms[0]!=='win32-x64')throw Error('Unsupported Computer Use platform');
 if(!Array.isArray(value.capabilities)||value.capabilities.length!==3||new Set(value.capabilities).size!==3||value.capabilities.some(c=>!['windows.observe','windows.capture','windows.input'].includes(c)))throw Error('Unsupported Computer Use capabilities');
 return value;
}
