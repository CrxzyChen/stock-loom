import {createApp} from 'vue';
import App from './App.vue';
import './styles/theme.css';
import './styles/workspace.css';
import {applyTheme} from './styles/theme';
import {readFontSize,applyFontSize} from './font-preferences.mjs';
applyFontSize(readFontSize());
applyTheme(document.documentElement);
createApp(App).mount('#app');
