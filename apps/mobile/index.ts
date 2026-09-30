// Background tasks must be registered before the router loads, so they exist when iOS relaunches the app headless.
import './src/lib/tasks';
import 'expo-router/entry';
