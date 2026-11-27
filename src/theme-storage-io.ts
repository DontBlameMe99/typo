import { File } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'

export const path = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}typo-appearance.json`
  : null

export function fileAt(uri: string) {
  return new File(uri)
}
