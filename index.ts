import { markStartup } from './src/startup'
import 'react-native-gesture-handler'
import { registerRootComponent } from 'expo'
import { AppRegistry } from 'react-native'
import App from './App'

markStartup('bundle')
// The quick note tile is rare, so its module graph loads only when the tile opens.
AppRegistry.registerComponent('quickNote', () => require('./src/QuickNote').default)
registerRootComponent(App)
