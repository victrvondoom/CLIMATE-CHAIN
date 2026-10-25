import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-500.css';
import '@fontsource/eb-garamond/latin-600.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource-variable/figtree';
import '@fontsource-variable/fraunces';
import './styles.css';
import './theme.css';
import './live.css';

createRoot(document.getElementById('root')!).render(<App />);
