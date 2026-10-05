// Background tasks must be defined before the router loads, so they exist when iOS relaunches the app headless.
import './src/lib/tasks';
import 'expo-router/entry';
