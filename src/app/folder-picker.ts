import { folderName, parentFolder } from './shared'

export type FolderChild = { path: string; name: string }
export type FolderCrumb = { name: string; path: string }

export function allowedFolders(folders: string[], excludeTree?: string): string[] {
  return folders.filter(
    (path) =>
      excludeTree === undefined || (path !== excludeTree && !path.startsWith(`${excludeTree}/`))
  )
}

export function folderChildren(allowed: string[], current: string): FolderChild[] {
  return allowed
    .filter((path) => path !== '' && parentFolder(path) === current)
    .map((path) => ({ path, name: folderName(path) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function folderCrumbs(current: string): FolderCrumb[] {
  let path = ''
  return current
    ? current.split('/').map((name) => {
        path = path ? `${path}/${name}` : name
        return { name, path }
      })
    : []
}

export function newFolderParts(name: string): string[] {
  return name
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function folderActionLabel(
  busy: boolean,
  busyLabel: string | undefined,
  newFolderOpen: boolean,
  move: boolean,
  sameFolder: boolean,
  current: string,
  chosenName: string
): string {
  return busy
    ? (busyLabel ?? (move ? 'Moving…' : 'Working…'))
    : newFolderOpen
      ? move
        ? 'Create and move here'
        : 'Create here'
      : move
        ? sameFolder
          ? current
            ? `Already in ${chosenName}`
            : 'Already at the vault root'
          : `Move to ${chosenName}`
        : `Create in ${chosenName}`
}

export function folderPreview(current: string, parts: string[]): string[] {
  return current ? [...current.split('/'), ...parts] : parts
}
