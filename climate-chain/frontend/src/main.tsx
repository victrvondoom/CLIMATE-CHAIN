import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import './styles.css';
import './theme.css';
import './live.css';
// The design system, then one stylesheet per area of the app (each is refined independently).
import './design.css';
import './design/shell.css';
import './design/overview.css';
import './design/integrity.css';
import './design/data.css';
import './design/signals.css';
import './design/modules.css';

createRoot(document.getElementById('root')!).render(<App />);
