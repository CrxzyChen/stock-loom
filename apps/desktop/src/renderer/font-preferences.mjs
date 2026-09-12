const key='stock.font-size.v1';
export const fontSizes=[13,14,15,16];
export function readFontSize(){try{const value=JSON.parse(localStorage.getItem(key));return value?.version===1&&fontSizes.includes(value.size)?value.size:13}catch{return 13}}
export function applyFontSize(size){if(!fontSizes.includes(size))throw Error('字号无效。');document.documentElement.style.setProperty('--ui-font-size',`${size}px`)}
export function saveFontSize(size){if(!fontSizes.includes(size))throw Error('字号无效。');localStorage.setItem(key,JSON.stringify({version:1,size}));applyFontSize(size)}
