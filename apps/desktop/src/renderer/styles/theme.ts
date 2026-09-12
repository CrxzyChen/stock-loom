import tokens from './midnight-workshop.tokens.json';

// Preserve the existing product vocabulary and its readability adjustment.
const mapping={canvas:'canvas',surface:'surface',raised:'surfaceRaised',overlay:'surfaceOverlay',line:'line','line-strong':'lineStrong',text:'text',muted:'textMuted',faint:'textFaint',accent:'accent','accent-soft':'accentSoft',success:'success',warning:'warning',danger:'danger'} as const;
export function applyTheme(root:HTMLElement){
  for(const [variable,key] of Object.entries(mapping))root.style.setProperty('--'+variable,tokens.colors[key]);
  root.style.setProperty('--muted','#96A4B5');
}
