import { markStartup } from './src/startup'
import 'react-native-gesture-handler'
import { registerRootComponent } from 'expo'
import { AppRegistry } from 'react-native'
import App from './App'

markStartup('bundle')
// The quick tiles are rare, so their module graphs load only when a tile opens.
AppRegistry.registerComponent('quickNote', () => require('./src/QuickNote').default)
AppRegistry.registerComponent('quickAppend', () => require('./src/QuickAppend').default)
registerRootComponent(App)
