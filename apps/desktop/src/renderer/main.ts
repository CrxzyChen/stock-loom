import {createApp} from 'vue';
import App from './App.vue';
import './styles/theme.css';
import './styles/workspace.css';
import {applyTheme} from './styles/theme';
import {readFontSize,applyFontSize} from './font-preferences.mjs';
applyFontSize(readFontSize());
applyTheme(document.documentElement);
document.addEventListener('click',event=>{
 if(event.defaultPrevented)return;
 const link=(event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement|null;
 if(!link||!/^https?:\/\//i.test(link.getAttribute('href')??''))return;
 if(!window.stock)return;
 event.preventDefault();void window.stock.openExternalLink(link.href).catch(()=>window.dispatchEvent(new CustomEvent('stock:external-link-error')));
});
createApp(App).mount('#app');
