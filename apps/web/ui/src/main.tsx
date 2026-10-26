import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connectHost } from './host';
import './styles.css';
import icon from '../icon.svg?inline';

// The tab's icon travels inside the page, which is one self-contained file. (An iPhone asks the
// server for its home-screen icon, at /apple-touch-icon.png.)
document.head.append(Object.assign(document.createElement('link'), { rel: 'icon', href: icon }));

createRoot(document.getElementById('root')!).render(<StrictMode><App host={connectHost()} /></StrictMode>);
