import { registerRootComponent } from 'expo';

// Side-effect import: registers the background tasks before anything else runs.
import './src/tasks';
import App from './App';

registerRootComponent(App);
