import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AppState,
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import Reanimated, { ReduceMotion, SlideInRight, SlideOutRight } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackGate } from '../back-gate'
import { type CompilerHandle, CompilerHost } from '../CompilerHost'
import { DEFAULT_TEMPLATE, isRootTemplate, type NoteSort, reconcileNotes } from '../core'
import { ErrorBanner } from '../ErrorBanner'
import { loadFavorites, loadFavoritesSync, storeFavorites } from '../favorites'
import { Icon } from '../icons'
import { loadVaultIndex, loadVaultIndexSync, storeVaultIndex } from '../library-cache'
import type { VaultIndex } from '../library-index'
import {
  type FolderRowItem,
  type FolderRowsCache,
  type LibraryRow,
  layoutRows,
  ROW_GAP,
  rowLayout,
  sortedNoteRows,
} from '../library-rows'
import { TypoMark } from '../Mark'
import { NoteSearch } from '../NoteSearch'
import { markStartup, reportStartup } from '../startup'
import { useTheme } from '../theme'
import type { Note, SearchMode, SearchResult, Vault } from '../types'
import { usePdfWorkspace } from '../usePdfWorkspace'
import { VaultSetup } from '../VaultSetup'
import {
  moveFolderToFolder,
  moveNoteToFolder,
  type NoteFolder,
  pickVault,
  readNote,
  readSavedVaultSync,
  restoreFolder,
  restoreNote,
  scanVaultLibrary,
  type TrashedNote,
  trashFolder,
  trashNote,
  type VaultScanProgress,
} from '../vault'
import { afterPaint, webRuntime } from '../web-runtime'
import { FolderSheet, SortSheet } from './FolderSheet'
import { Fade, SwapFaces } from './motion'
import { NewNote } from './NewNote'
import { NoteDetail } from './NoteDetail'
import { FolderChip, LibraryNotice, NoteCard, SearchResultRow, TrashNotice } from './rows'
import { Settings } from './Settings'
import {
  EMPTY_FOLDERS,
  EMPTY_NOTES,
  errorText,
  type FolderEntry,
  folderName,
  keyboardBehavior,
  LIBRARY_LIST_TOP,
  LIBRARY_PARENT_HEIGHT,
  MARK_SIZE,
  type MovingItem,
  type NoteSession,
  type LibraryNotice as NoticeData,
  noteSorts,
  parentFolder,
  sameList,
  type TrashUndo,
  warmNote,
} from './shared'
import { useStyles } from './styles'
import { TemplateEditor } from './TemplateEditor'

const MemoNoteDetail = memo(NoteDetail)
const MemoNoteSearch = memo(NoteSearch)
const MemoCompilerHost = memo(CompilerHost)

const folderIn = SlideInRight.duration(147).reduceMotion(ReduceMotion.System)
const folderOut = SlideOutRight.duration(147).reduceMotion(ReduceMotion.System)

const SEARCH_MODE: SearchMode = 'all'

// These are local reads, so the first library render can start with the rows,
// favorites, and theme already in hand. That removes the empty commit and the
// second pass the launch path used to need.
type LaunchLibrary = {
  vault: Vault | null
  index: VaultIndex | null
  favorites: string[]
  error: string | null
}
const readLaunchLibrary = (): LaunchLibrary => {
  try {
    const vault = readSavedVaultSync()
    const library: LaunchLibrary = {
      vault,
      index: vault ? loadVaultIndexSync(vault) : null,
      favorites: vault ? loadFavoritesSync(vault) : [],
      error: null,
    }
    markStartup('library')
    return library
  } catch (cause) {
    markStartup('library')
    return { vault: null, index: null, favorites: [], error: errorText(cause) }
  }
}

export function Library({ onReady, visible }: { onReady: () => void; visible: boolean }) {
  const s = useStyles()
  const { top, right, bottom, left } = useSafeAreaInsets()
  const { colors, palette } = useTheme()
  const [launch] = useState(readLaunchLibrary)
  const cachedRows =
    !!launch.index && (launch.index.notes.length > 0 || launch.index.folders.length > 1)
  const [vault, setVault] = useState<Vault | null>(launch.vault)
  const [notes, setNotes] = useState<Note[]>(launch.index?.notes ?? EMPTY_NOTES)
  const [folders, setFolders] = useState<string[]>(launch.index?.folders ?? [''])
  const [folder, setFolder] = useState('')
  const [folderStack, setFolderStack] = useState<string[]>([''])
  const [startupReady, setStartupReady] = useState(launch.vault === null || cachedRows)
  const [scanning, setScanning] = useState(false)
  const [setup, setSetup] = useState<VaultScanProgress | null>(null)
  const [setupDone, setSetupDone] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(launch.error)
  const [saveError, setSaveError] = useState<{ uri: string; message: string } | null>(null)
  const [query, setQuery] = useState('')
  const queryRef = useRef(query)
  queryRef.current = query
  const [sort, setSort] = useState<NoteSort>('name-asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [selected, setSelected] = useState<NoteSession | null>(null)
  const [prepared, setPrepared] = useState<NoteSession | null>(null)
  const pendingNote = useRef<NoteSession | null>(null)
  const openingScreen = useRef<'note' | 'new' | 'move' | 'settings' | null>(null)
  const libraryVisibleRef = useRef(true)
  const [backGate] = useState(() => new BackGate())
  const backFrame = useRef<number | null>(null)
  const noteSession = useRef(0)
  const detailNoteUri = useRef('')
  const openingStarted = useRef<{ session: number; at: number } | null>(null)
  const noticeSession = useRef(0)
  const skippedReport = useRef('')
  const [creating, setCreating] = useState(false)
  const [templateEditor, setTemplateEditor] = useState<{
    source: string
    onSaved: (source: string) => void
  } | null>(null)
  const creatingRef = useRef(false)
  creatingRef.current = creating
  const [moving, setMoving] = useState<MovingItem | null>(null)
  const [notice, setNotice] = useState<NoticeData | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [favorites, setFavorites] = useState<string[]>(launch.favorites)
  const favoritesRef = useRef(favorites)
  favoritesRef.current = favorites
  const favoritesReady = useRef(launch.vault !== null)
  const [trashNotice, setTrashNotice] = useState<{ id: number; title: string } | null>(null)
  const [trashUndo, setTrashUndo] = useState<TrashUndo | null>(null)
  const undoingTrash = useRef(false)
  const trashNoticeId = useRef(0)
  // Filesystem trashing runs one item at a time so ".trash" names stay unique.
  const trashQueue = useRef<Promise<void>>(Promise.resolve())
  // Paths the library keeps hidden while their move runs, so a scan that read
  // the item first cannot put it back.
  const trashing = useRef(new Set<string>())
  const settledTrash = useRef<string[]>([])
  const [templateCache, setTemplateCache] = useState<{ vault: string; source: string } | null>(null)
  const templateVersion = useRef(0)
  const compiler = useRef<CompilerHandle>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  const scanningRef = useRef(false)
  const scanDuration = useRef(0)
  const lastScanEnd = useRef(0)
  const vaultRef = useRef<Vault | null>(launch.vault)
  const busy = useRef(false)
  const modalWasOpen = useRef(false)
  const foreground = useRef(AppState.currentState === 'active')
  busy.current = picking
  // Nothing that needs a WebView or the compiler is mounted before the library
  // is revealed. Three hidden WebViews used to start with the app and push the
  // first frame out by hundreds of milliseconds.
  const [painted, setPainted] = useState(false)
  const initialScan = useRef<{ vault: Vault; quiet: boolean } | null>(
    cachedRows && launch.vault ? { vault: launch.vault, quiet: true } : null
  )
  useLayoutEffect(() => {
    markStartup('commit')
  }, [])

  const isTrashing = useCallback((path: string) => {
    for (const target of trashing.current) {
      if (path === target || path.startsWith(`${target}/`)) return true
    }
    return false
  }, [])
  const index = useCallback(
    async (target: Vault, options?: { quiet?: boolean }) => {
      if (scanningRef.current) return
      const quiet = options?.quiet === true
      const templateVersionAtStart = templateVersion.current
      const started = performance.now()
      let firstBatch = true
      let lastProgress = 0
      let completed = false
      const request = ++generation.current
      scanningRef.current = true
      // Moves that finished before this scan are now gone from disk.
      for (const path of settledTrash.current) trashing.current.delete(path)
      settledTrash.current = []
      if (!quiet) {
        setScanning(true)
        setError(null)
        setSetupDone(false)
        setSetup({ stage: 'folders', folders: 1, notes: 0, done: 0, path: '' })
      }
      try {
        const result = await scanVaultLibrary(
          target,
          quiet
            ? undefined
            : (progress) => {
                if (!mounted.current || request !== generation.current) return
                const now = performance.now()
                if (progress.done < progress.notes && now - lastProgress < 100) return
                lastProgress = now
                setSetup(progress)
              },
          () => !mounted.current || request !== generation.current,
          quiet
            ? undefined
            : (partial, partialFolders) => {
                if (mounted.current && request === generation.current) {
                  if (__DEV__ && firstBatch) {
                    console.info(
                      `[performance] First notes: ${Math.round(performance.now() - started)} ms`
                    )
                    firstBatch = false
                  }
                  const visible = partial.filter((note) => !isTrashing(note.path))
                  setNotes((previous) => (sameList(previous, visible) ? previous : visible))
                  const scanned = partialFolders.filter((path) => !isTrashing(path))
                  setFolders((previous) => (sameList(previous, scanned) ? previous : scanned))
                  // A cold vault has no cache to paint, so show the first scan batch.
                  if (visible.length > 0) setStartupReady(true)
                }
              }
        )
        if (mounted.current && request === generation.current) {
          const scannedNotes = result.notes.filter((note) => !isTrashing(note.path))
          const scannedFolders = result.folders.filter((path) => !isTrashing(path))
          setNotes((previous) => reconcileNotes(previous, scannedNotes))
          setFolders((previous) => (sameList(previous, scannedFolders) ? previous : scannedFolders))
          if (templateVersion.current === templateVersionAtStart) {
            const templates = scannedNotes.filter((note) => isRootTemplate(note.path))
            const folder = scannedFolders.some((path) => path.toLowerCase() === 'template.typ')
            // Leave invalid templates to readTemplate so NewNote reports the error.
            const skippedTemplate = result.skipped.some((path) => isRootTemplate(path))
            if (folder || templates.length > 1 || skippedTemplate) setTemplateCache(null)
            else if (!creatingRef.current)
              setTemplateCache((previous) => {
                const source = templates[0]?.source ?? DEFAULT_TEMPLATE
                return previous?.vault === target.uri && previous.source === source
                  ? previous
                  : { vault: target.uri, source }
              })
          }
          setError(null)
          const skippedReportKey = `${target.uri}\n${result.skipped.join('\n')}`
          if (skippedReportKey !== skippedReport.current) {
            skippedReport.current = skippedReportKey
            if (result.skipped.length > 0) {
              const count = result.skipped.length
              setNotice({
                id: ++noticeSession.current,
                icon: 'fileAlert',
                title: `${count} note${count === 1 ? '' : 's'} could not be read`,
                body: result.skipped.slice(0, 3).join(', '),
              })
            }
          }
          if (__DEV__)
            console.info(
              `[performance] Vault scan: ${result.notes.length} notes in ${Math.round(performance.now() - started)} ms`
            )
          completed = true
        }
      } catch (cause) {
        if (mounted.current && request === generation.current) setError(errorText(cause))
      } finally {
        scanDuration.current = performance.now() - started
        lastScanEnd.current = performance.now()
        if (mounted.current && request === generation.current) {
          scanningRef.current = false
          if (!quiet) {
            setScanning(false)
            if (completed) setSetupDone(true)
            else {
              setSetup(null)
              setSetupDone(false)
            }
          }
        }
      }
    },
    [isTrashing]
  )

  const quietScan = useCallback(() => {
    const target = vaultRef.current
    if (!target || scanningRef.current || busy.current) return
    if (!foreground.current) return
    return index(target, { quiet: true })
  }, [index])

  // The launch screen covers the first commit, so the library can replace it as
  // soon as the rows it will show are in that commit. Waiting for extra frames
  // only delays the reveal.
  useLayoutEffect(() => {
    if (!startupReady) return
    markStartup('reveal')
    onReady()
  }, [startupReady, onReady])

  useEffect(() => {
    if (visible) markStartup('visible')
  }, [visible])

  // Report and mount only what the user can see: the first frame after the
  // launch screen is gone, which also waits for the fonts it blocked on.
  useEffect(() => {
    if (!visible || painted) return
    let frame = 0
    const cancel = afterPaint(() => {
      markStartup('paint')
      reportStartup()
      // The WebViews mount one frame later so starting their renderers cannot
      // land in the frame that first shows the library.
      frame = requestAnimationFrame(() => setPainted(true))
    })
    return () => {
      cancel()
      cancelAnimationFrame(frame)
    }
  }, [visible, painted])

  // A cache without rows proves nothing about the vault, so wait for the scan
  // before revealing. Everything else was ready before the first render.
  useEffect(() => {
    mounted.current = true
    if (launch.vault && !cachedRows) {
      void index(launch.vault).finally(() => {
        if (mounted.current) setStartupReady(true)
      })
    }
    return () => {
      mounted.current = false
      generation.current++
    }
  }, [index, launch.vault, cachedRows])

  useEffect(() => {
    if (!painted) return
    const pending = initialScan.current
    if (!pending) return
    initialScan.current = null
    void index(pending.vault, { quiet: pending.quiet })
  }, [painted, index])

  useEffect(() => {
    foreground.current = AppState.currentState === 'active'
    const listener = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active'
      if (state === 'active') void quietScan()
    })
    return () => listener.remove()
  }, [quietScan])

  useEffect(() => {
    const target = vaultRef.current
    if (!target || !favoritesReady.current) return
    const timer = setTimeout(() => {
      void storeFavorites(target, favorites).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [favorites])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      const wait = Math.max(15_000, scanDuration.current * 2)
      const idle = performance.now() - lastScanEnd.current
      if (idle < wait) {
        timer = setTimeout(run, wait - idle)
        return
      }
      await quietScan()
      if (cancelled) return
      timer = setTimeout(run, Math.max(15_000, scanDuration.current * 2))
    }
    timer = setTimeout(run, 15_000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [quietScan])

  useEffect(() => {
    const open = !!selected || creating || !!moving || settingsOpen
    if (modalWasOpen.current && !open) void quietScan()
    modalWasOpen.current = open
  }, [selected, creating, moving, settingsOpen, quietScan])

  async function chooseVault() {
    if (picking || backGate.blockOpening()) return
    Keyboard.dismiss()
    setPicking(true)
    setError(null)
    setSaveError(null)
    try {
      const next = await pickVault()
      if (!mounted.current || !next) return
      generation.current++
      scanningRef.current = false
      favoritesReady.current = false
      folderRows.current.clear()
      if (vaultRef.current?.uri !== next.uri) {
        trashing.current.clear()
        settledTrash.current = []
      }
      setVault(next)
      vaultRef.current = next
      setNotes([])
      setFolders([''])
      setFavorites([])
      setFolder('')
      setFolderStack([''])
      setTemplateCache(null)
      setMoving(null)
      setNotice(null)
      setPrepared(null)
      pendingNote.current = null
      openingScreen.current = null
      setSetupDone(false)
      setSetup({ stage: 'folders', folders: 1, notes: 0, done: 0, path: '' })
      const cached = await loadVaultIndex(next)
      if (!mounted.current) return
      const cachedNotes = (cached?.notes ?? []).filter((note) => !isTrashing(note.path))
      const cachedFolders = cached ? cached.folders.filter((path) => !isTrashing(path)) : ['']
      setNotes(cachedNotes)
      setFolders(cachedFolders)
      // The library can only cover the setup when the cache has rows to paint.
      const cachedRows = cachedNotes.length > 0 || cachedFolders.length > 1
      if (cachedRows) {
        setSetup(null)
        setSetupDone(false)
      }
      setFavorites(await loadFavorites(next))
      favoritesReady.current = true
      if (!mounted.current) return
      setQuery('')
      await index(next, { quiet: cachedRows })
    } catch (cause) {
      if (mounted.current) {
        setError(errorText(cause))
        setSetup(null)
        setSetupDone(false)
      }
    } finally {
      if (mounted.current) setPicking(false)
    }
  }

  const deferredQuery = useDeferredValue(query)
  const [searchResults, setResults] = useState<SearchResult[]>([])
  const searchFailure = useRef<string | null>(null)
  const [searchPending, setSearchPending] = useState(false)
  const searchBusy = searchPending || deferredQuery !== query
  const results = useMemo(() => {
    const current = new Map(notes.map((note) => [note.uri, note]))
    return searchResults.flatMap((result) => {
      const note = current.get(result.note.uri)
      return note ? [{ ...result, note }] : []
    })
  }, [notes, searchResults])
  const isSearching = query.trim().length > 0
  const sortOption =
    noteSorts.find((option) => option.ascValue === sort || option.descValue === sort) ??
    noteSorts[0]
  const sortLabel = `${sortOption.label}, ${sort === sortOption.ascValue ? sortOption.ascending : sortOption.descending}`
  useEffect(() => {
    // Results stay visible while the next search runs, so drop them when search ends.
    if (!isSearching) setResults((current) => (current.length ? [] : current))
  }, [isSearching])
  const searchInput = useRef<React.ComponentRef<typeof TextInput>>(null)
  useEffect(() => {
    // Keep focus state in sync with the keyboard so the list is not left shifted.
    const listener = Keyboard.addListener('keyboardDidHide', () => searchInput.current?.blur())
    return () => listener.remove()
  }, [])
  const notesByFolder = useMemo(() => {
    const map = new Map<string, Note[]>()
    for (const note of notes) {
      const parent = parentFolder(note.path)
      const list = map.get(parent)
      if (list) list.push(note)
      else map.set(parent, [note])
    }
    return map
  }, [notes])
  const foldersByParent = useMemo(() => {
    const map = new Map<string, FolderRowItem[]>()
    for (const path of folders) {
      if (!path) continue
      const parent = parentFolder(path)
      const item: FolderRowItem = { kind: 'folder', path, name: folderName(path) }
      const list = map.get(parent)
      if (list) list.push(item)
      else map.set(parent, [item])
    }
    return map
  }, [folders])
  const favoritePaths = useMemo(() => new Set(favorites), [favorites])
  const noteCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of notes) {
      // A folder counts everything below it, not just its direct notes.
      let path = parentFolder(note.path)
      while (true) {
        counts.set(path, (counts.get(path) ?? 0) + 1)
        if (!path) break
        path = parentFolder(path)
      }
    }
    return counts
  }, [notes])
  const folderRows = useRef<FolderRowsCache>(new Map())
  const folderViews = useMemo(() => {
    return folderStack.map((path) => {
      const current = path === folder
      const childFolders = foldersByParent.get(path) ?? EMPTY_FOLDERS
      const favoriteFolders = childFolders.filter((entry) => favoritePaths.has(entry.path))
      const restFolders = childFolders.filter((entry) => !favoritePaths.has(entry.path))
      const sorted = sortedNoteRows(
        folderRows.current,
        path,
        notesByFolder.get(path) ?? EMPTY_NOTES,
        sort
      )
      const pinned = sorted.filter((row) => favoritePaths.has(row.result.note.path))
      const notes = sorted.filter((row) => !favoritePaths.has(row.result.note.path))
      const rows: LibraryRow[] = []
      const orderedFolders = [...favoriteFolders, ...restFolders]
      if (orderedFolders.length > 0 || sorted.length > 0) {
        rows.push({ kind: 'space', key: 'space:top', height: 6 })
      }
      let separated = false
      if (orderedFolders.length > 0) {
        for (let index = 0; index < orderedFolders.length; index += 2) {
          rows.push({
            kind: 'folders',
            key: `folders:${path}:${index}`,
            items: orderedFolders.slice(index, index + 2),
          })
        }
        separated = true
      }
      if (pinned.length > 0) {
        if (separated) rows.push({ kind: 'space', key: 'space:pinned', height: 14 })
        for (const row of pinned) {
          rows.push({ kind: 'note', key: `pinned:${row.result.note.uri}`, result: row.result })
        }
        separated = true
      }
      if (notes.length > 0) {
        if (separated) rows.push({ kind: 'space', key: 'space:notes', height: 14 })
        for (const row of notes) {
          rows.push({ kind: 'note', key: `note:${row.result.note.uri}`, result: row.result })
        }
      }
      const layout = layoutRows(rows)
      const above = LIBRARY_LIST_TOP + (path ? LIBRARY_PARENT_HEIGHT + ROW_GAP : 0)
      return {
        path,
        current,
        rows,
        getItemLayout: (_: unknown, index: number) => {
          const frame = rowLayout(layout, index)
          return { ...frame, offset: frame.offset + above }
        },
        empty: orderedFolders.length === 0 && sorted.length === 0,
      }
    })
  }, [favoritePaths, folder, folderStack, foldersByParent, notesByFolder, sort])
  const clearSearch = useCallback(() => {
    if (!queryRef.current) return
    setQuery('')
  }, [])
  const stopIndex = useCallback(() => {
    generation.current++
    scanningRef.current = false
    setScanning(false)
    setSetup(null)
    setSetupDone(false)
  }, [])
  const finishSetup = useCallback(() => {
    setSetup(null)
    setSetupDone(false)
  }, [])
  const goToFolder = useCallback(
    (path: string) => {
      if (path === folder || backGate.blockOpening()) return
      Keyboard.dismiss()
      searchInput.current?.blur()
      stopIndex()
      setFolderStack((stack) => {
        const index = stack.lastIndexOf(path)
        return index >= 0 ? stack.slice(0, index + 1) : [...stack, path]
      })
      setFolder(path)
    },
    [backGate, folder, stopIndex]
  )
  const toggleFavorite = useCallback((path: string) => {
    setFavorites((previous) =>
      previous.includes(path) ? previous.filter((item) => item !== path) : [...previous, path]
    )
  }, [])
  const moveToTrash = useCallback(
    (item: MovingItem) => {
      const target = vaultRef.current
      if (!target) return
      stopIndex()
      setError(null)
      const enqueue = (
        task: () => Promise<TrashedNote>,
        trashed: {
          noticeId: number
          path: string
          favorites: string[]
          notes: Note[]
          folders: string[]
        },
        moving: MovingItem
      ) => {
        let settle: (value: TrashedNote | null) => void = () => {}
        const result = new Promise<TrashedNote | null>((resolve) => {
          settle = resolve
        })
        setTrashUndo({
          noticeId: trashed.noticeId,
          item: moving,
          favorites: trashed.favorites,
          notes: trashed.notes,
          folders: trashed.folders,
          result,
        })
        trashQueue.current = trashQueue.current.then(async () => {
          try {
            const stored = await task()
            settle(stored)
            if (vaultRef.current?.uri === target.uri) settledTrash.current.push(trashed.path)
          } catch (cause) {
            settle(null)
            // The item is still on disk, so it comes back into the library.
            if (vaultRef.current?.uri === target.uri) trashing.current.delete(trashed.path)
            if (!mounted.current || vaultRef.current?.uri !== target.uri) return
            setTrashNotice((current) => (current?.id === trashed.noticeId ? null : current))
            setTrashUndo((current) => (current?.noticeId === trashed.noticeId ? null : current))
            if (trashed.favorites.length > 0) {
              setFavorites((previous) => [
                ...previous,
                ...trashed.favorites.filter((path) => !previous.includes(path)),
              ])
            }
            const failure = errorText(cause)
            // Read the vault again so the restored item reappears.
            await index(target, { quiet: true })
            if (!mounted.current || vaultRef.current?.uri !== target.uri) return
            setError(failure)
          }
        })
      }
      if (item.kind === 'folder') {
        const { entry } = item
        const prefix = `${entry.path}/`
        const inside = (path: string) => path === entry.path || path.startsWith(prefix)
        const removedFavorites = favoritesRef.current.filter(inside)
        const removedNotes = notes.filter((note) => inside(note.path))
        const removedFolders = folders.filter(inside)
        setNotes((previous) => previous.filter((note) => !inside(note.path)))
        setFolders((previous) => previous.filter((path) => !inside(path)))
        setFavorites((previous) => previous.filter((path) => !inside(path)))
        setPrepared((current) => (current && inside(current.note.path) ? null : current))
        setSelected((current) => (current && inside(current.note.path) ? null : current))
        if (pendingNote.current && inside(pendingNote.current.note.path)) {
          pendingNote.current = null
        }
        const notice = { id: ++trashNoticeId.current, title: entry.name }
        setTrashNotice(notice)
        trashing.current.add(entry.path)
        enqueue(
          () => trashFolder(target, entry.path),
          {
            noticeId: notice.id,
            path: entry.path,
            favorites: removedFavorites,
            notes: removedNotes,
            folders: removedFolders,
          },
          item
        )
        return
      }
      const { note } = item.result
      const removedFavorites = favoritesRef.current.filter((path) => path === note.path)
      if (isRootTemplate(note.path)) {
        templateVersion.current += 1
        setTemplateCache(null)
      }
      setNotes((previous) => previous.filter((item) => item.uri !== note.uri))
      setFavorites((previous) => previous.filter((path) => path !== note.path))
      setPrepared((current) => (current?.note.uri === note.uri ? null : current))
      setSelected((current) => (current?.note.uri === note.uri ? null : current))
      if (pendingNote.current?.note.uri === note.uri) pendingNote.current = null
      const notice = { id: ++trashNoticeId.current, title: note.title }
      setTrashNotice(notice)
      trashing.current.add(note.path)
      enqueue(
        () => trashNote(target, note),
        {
          noticeId: notice.id,
          path: note.path,
          favorites: removedFavorites,
          notes: [note],
          folders: [],
        },
        item
      )
    },
    [folders, index, notes, stopIndex]
  )
  const undoLastTrash = useCallback(() => {
    const pending = trashUndo
    const target = vaultRef.current
    if (!pending || !target || undoingTrash.current) return
    undoingTrash.current = true
    setError(null)
    const original =
      pending.item.kind === 'note' ? pending.item.result.note.path : pending.item.entry.path
    // Put the item back in the library immediately; the filesystem catches up.
    trashing.current.delete(original)
    settledTrash.current = settledTrash.current.filter((path) => path !== original)
    setNotes((previous) => {
      const next = new Map(previous.map((note) => [note.uri, note]))
      for (const note of pending.notes) next.set(note.uri, note)
      return [...next.values()].sort((a, b) => a.path.localeCompare(b.path))
    })
    if (pending.folders.length > 0) {
      setFolders((previous) =>
        [...new Set([...previous, ...pending.folders])].sort((a, b) => a.localeCompare(b))
      )
    }
    if (pending.favorites.length > 0) {
      setFavorites((previous) => [...new Set([...previous, ...pending.favorites])])
    }
    setTrashUndo(null)
    setTrashNotice(null)
    trashQueue.current = trashQueue.current
      .then(async () => {
        const trashed = await pending.result
        if (!trashed) {
          await index(target, { quiet: true })
          return
        }
        if (pending.item.kind === 'note') await restoreNote(target, trashed, original)
        else await restoreFolder(target, trashed, original)
        if (vaultRef.current?.uri === target.uri) await index(target, { quiet: true })
      })
      .catch((cause) => {
        if (!mounted.current || vaultRef.current?.uri !== target.uri) return
        if (pending.favorites.length > 0) {
          setFavorites((previous) => previous.filter((path) => !pending.favorites.includes(path)))
        }
        setError(errorText(cause))
        void index(target, { quiet: true })
      })
      .finally(() => {
        undoingTrash.current = false
      })
  }, [index, trashUndo])
  const settleBack = useCallback(
    (exit: boolean, drain = true) => {
      if (!backGate.begin(exit)) return
      if (!drain) {
        if (backGate.finish()) BackHandler.exitApp()
        return
      }
      // Drain queued touch callbacks before allowing another screen to open.
      backFrame.current = requestAnimationFrame(() => {
        backFrame.current = requestAnimationFrame(() => {
          backFrame.current = null
          if (backGate.finish()) BackHandler.exitApp()
        })
      })
    },
    [backGate]
  )
  useLayoutEffect(() => {
    const cancelOpening = () => {
      if (!openingScreen.current) return false
      openingScreen.current = null
      stopIndex()
      pendingNote.current = null
      setSelected(null)
      setCreating(false)
      setMoving(null)
      setSettingsOpen(false)
      return true
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!libraryVisibleRef.current) return false
      if (cancelOpening()) settleBack(false)
      else if (queryRef.current) {
        clearSearch()
        settleBack(false)
      } else if (folder) {
        goToFolder(parentFolder(folder))
        settleBack(false)
      } else settleBack(true)
      return true
    })
    return () => subscription.remove()
  }, [clearSearch, folder, goToFolder, settleBack, stopIndex])
  useLayoutEffect(
    () => () => {
      if (backFrame.current !== null) cancelAnimationFrame(backFrame.current)
      backGate.cancel()
    },
    [backGate]
  )
  const prepareNote = useCallback((result: SearchResult) => {
    Keyboard.dismiss()
    const next = { ...result, session: ++noteSession.current }
    openingStarted.current = { session: next.session, at: performance.now() }
    pendingNote.current = next
    setPrepared(next)
    return next
  }, [])
  const editorPrepared = useCallback((session: number) => {
    const started = openingStarted.current
    if (started?.session === session) {
      if (__DEV__)
        console.info(
          `[performance] Note editor ready: ${(performance.now() - started.at).toFixed(1)} ms`
        )
      openingStarted.current = null
    }
  }, [])
  const openNote = useCallback(
    async (result: SearchResult) => {
      if (backGate.blockOpening()) return
      openingScreen.current = 'note'
      const next =
        pendingNote.current?.note.uri === result.note.uri
          ? pendingNote.current
          : prepareNote(result)
      pendingNote.current = null
      stopIndex()
      Keyboard.dismiss()
      const request = generation.current
      setSelected({ ...next, opening: true })
      try {
        const note = await readNote(result.note)
        if (!mounted.current || request !== generation.current) return
        setNotes((previous) =>
          previous.some((item) => item.uri === note.uri && item !== note)
            ? previous.map((item) => (item.uri === note.uri ? note : item))
            : previous
        )
        setPrepared((current) =>
          current?.session === next.session ? { ...current, note } : current
        )
        setSelected((current) =>
          current?.session === next.session ? { ...current, note, opening: false } : current
        )
      } catch (cause) {
        if (mounted.current && request === generation.current) {
          const message = errorText(cause)
          setError(message)
          setSelected((current) =>
            current?.note.uri === result.note.uri
              ? { ...current, opening: false, openError: message }
              : current
          )
        }
      }
    },
    [backGate, prepareNote, stopIndex]
  )
  const updateNote = useCallback(
    (note: Note) => {
      stopIndex()
      if (vault && isRootTemplate(note.path)) {
        templateVersion.current += 1
        setTemplateCache({ vault: vault.uri, source: note.source })
      }
      setNotes((previous) => previous.map((item) => (item.uri === note.uri ? note : item)))
      setPrepared((current) => (current?.note.uri === note.uri ? { ...current, note } : current))
      setSelected((current) =>
        current?.note.uri === note.uri ? { ...current, note, openError: undefined } : current
      )
      setError(null)
      setSaveError((current) => (current?.uri === note.uri ? null : current))
    },
    [stopIndex, vault]
  )
  const showNotice = useCallback(
    (icon: NoticeData['icon'], title: string, body?: string) =>
      setNotice({ id: ++noticeSession.current, icon, title, body }),
    []
  )
  const startMove = useCallback(
    (item: MovingItem) => {
      if (backGate.blockOpening()) return
      Keyboard.dismiss()
      openingScreen.current = 'move'
      setMoving(item)
    },
    [backGate]
  )
  const moveTo = useCallback(
    async (destination: string) => {
      const item = moving
      const target = vaultRef.current
      if (!item || !target) throw new Error('This item is no longer available.')
      stopIndex()
      if (item.kind === 'note') {
        const result = item.result
        const moved = await moveNoteToFolder(target, result.note, destination)
        if (!mounted.current) return
        if (isRootTemplate(result.note.path) || isRootTemplate(moved.path)) {
          templateVersion.current += 1
          setTemplateCache(null)
        }
        setNotes((previous) =>
          previous
            .map((item) => (item.uri === result.note.uri ? moved : item))
            .sort((a, b) => a.path.localeCompare(b.path))
        )
        setFavorites((previous) =>
          previous.map((path) => (path === result.note.path ? moved.path : path))
        )
        setPrepared((current) => (current?.note.uri === result.note.uri ? null : current))
        setSelected((current) => (current?.note.uri === result.note.uri ? null : current))
        if (pendingNote.current?.note.uri === result.note.uri) pendingNote.current = null
        openingScreen.current = null
        setMoving(null)
        showNotice('folderOpen', 'Note moved', moved.path)
        return
      }
      const entry = item.entry
      const moved = await moveFolderToFolder(target, entry.path, destination)
      if (!mounted.current) return
      const prefix = `${entry.path}/`
      const inside = (path: string) => path === entry.path || path.startsWith(prefix)
      const shifted = (path: string) => `${moved.path}${path.slice(entry.path.length)}`
      const renamed = new Map(moved.notes.map((note) => [note.uri, note.nextUri]))
      setNotes((previous) =>
        previous
          .map((note) =>
            inside(note.path)
              ? {
                  ...note,
                  uri: renamed.get(note.uri) ?? note.uri,
                  path: shifted(note.path),
                  pdfUri: undefined,
                  pdfHash: undefined,
                }
              : note
          )
          .sort((a, b) => a.path.localeCompare(b.path))
      )
      setFolders((previous) =>
        previous
          .map((path) => (inside(path) ? shifted(path) : path))
          .sort((a, b) => a.localeCompare(b))
      )
      setFavorites((previous) => previous.map((path) => (inside(path) ? shifted(path) : path)))
      setPrepared((current) => (current && inside(current.note.path) ? null : current))
      setSelected((current) => (current && inside(current.note.path) ? null : current))
      if (pendingNote.current && inside(pendingNote.current.note.path)) pendingNote.current = null
      openingScreen.current = null
      setMoving(null)
      showNotice('folderOpen', 'Folder moved', moved.path)
    },
    [moving, showNotice, stopIndex]
  )
  const folderCreated = useCallback((created: NoteFolder) => {
    setFolders((previous) =>
      previous.includes(created.path)
        ? previous
        : [...previous, created.path].sort((a, b) => a.localeCompare(b))
    )
  }, [])
  const startMoveNote = useCallback(
    (result: SearchResult) => startMove({ kind: 'note', result }),
    [startMove]
  )
  const openResult = useCallback((result: SearchResult) => void openNote(result), [openNote])
  const startMoveFolder = useCallback(
    (entry: FolderEntry) => startMove({ kind: 'folder', entry }),
    [startMove]
  )
  const trashNoteItem = useCallback(
    (result: SearchResult) => moveToTrash({ kind: 'note', result }),
    [moveToTrash]
  )
  const trashFolderItem = useCallback(
    (entry: FolderEntry) => moveToTrash({ kind: 'folder', entry }),
    [moveToTrash]
  )
  const favoriteNoteItem = useCallback(
    (result: SearchResult) => toggleFavorite(result.note.path),
    [toggleFavorite]
  )
  const favoriteFolderItem = useCallback(
    (entry: FolderEntry) => toggleFavorite(entry.path),
    [toggleFavorite]
  )
  const keyExtractor = useCallback((item: LibraryRow) => item.key, [])
  const renderLibraryItem = useCallback(
    ({ item }: { item: LibraryRow }) => {
      if (item.kind === 'space') return <View style={{ height: item.height }} />
      if (item.kind === 'folders')
        return (
          <View style={s.chipGrid}>
            {item.items.map((entry) => (
              <FolderChip
                key={entry.path}
                entry={entry}
                count={noteCounts.get(entry.path) ?? 0}
                favorite={favoritePaths.has(entry.path)}
                onPress={goToFolder}
                onLongPress={startMoveFolder}
                onToggleFavorite={favoriteFolderItem}
                onTrash={trashFolderItem}
              />
            ))}
            {item.items.length === 1 ? <View style={s.chipSpacer} /> : null}
          </View>
        )
      return (
        <NoteCard
          result={item.result}
          favorite={favoritePaths.has(item.result.note.path)}
          onPressIn={prepareNote}
          onPress={openNote}
          onLongPress={startMoveNote}
          onToggleFavorite={favoriteNoteItem}
          onTrash={trashNoteItem}
        />
      )
    },
    [
      favoriteFolderItem,
      favoriteNoteItem,
      favoritePaths,
      goToFolder,
      noteCounts,
      openNote,
      prepareNote,
      s,
      startMoveFolder,
      startMoveNote,
      trashFolderItem,
      trashNoteItem,
    ]
  )

  const { workspace } = usePdfWorkspace({
    vault,
    notes,
    enabled: painted && !scanning && !picking,
    compiler,
  })

  useEffect(() => {
    if (!vault) {
      setTemplateCache(null)
      return
    }
    if (!painted) return
    void webRuntime('editor').catch(() => {})
  }, [vault, painted])

  useEffect(() => {
    if (!vault || scanning) return
    const timer = setTimeout(() => {
      void webRuntime('pdf').catch(() => {})
    }, 1000)
    return () => clearTimeout(timer)
  }, [vault, scanning])

  const detail = selected ?? prepared
  detailNoteUri.current = detail?.note.uri ?? ''
  const closeNote = useCallback(() => {
    settleBack(false, false)
    openingScreen.current = null
    stopIndex()
    pendingNote.current = null
    setSelected(null)
  }, [settleBack, stopIndex])
  const saveNoteError = useCallback((message: string) => {
    setSaveError({ uri: detailNoteUri.current, message })
  }, [])
  const searchResultsReady = useCallback((next: SearchResult[]) => {
    setResults(next)
    // A search that answers after a restart must not leave its own failure up.
    if (searchFailure.current !== null) {
      const failure = searchFailure.current
      searchFailure.current = null
      setError((current) => (current === failure ? null : current))
    }
  }, [])
  const searchError = useCallback((message: string) => {
    searchFailure.current = message
    setResults([])
    setError(message)
  }, [])
  const noteVisible = !!selected
  const libraryVisible = !noteVisible && !creating && !moving && !settingsOpen
  // The sort sheet is a sibling overlay, so the library has to ignore input
  // itself or row gestures fire through it.
  const libraryInteractive = libraryVisible && !setup && !sortOpen
  useLayoutEffect(() => {
    libraryVisibleRef.current = libraryVisible
  }, [libraryVisible])
  useEffect(() => {
    // The index is only a launch cache, so keep the editor's autosaves from
    // serializing the whole library behind a note. Write once it is covered.
    if (!vault || scanning || picking || !libraryVisible || !painted) return
    const timer = setTimeout(() => {
      void storeVaultIndex(vault, { notes, folders }).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [vault, notes, folders, scanning, picking, libraryVisible, painted])
  const closeSettings = () => {
    settleBack(false, false)
    openingScreen.current = null
    setSettingsOpen(false)
  }
  const openCreate = () => {
    if (backGate.blockOpening()) return
    Keyboard.dismiss()
    setNotice(null)
    stopIndex()
    openingScreen.current = 'new'
    setCreating(true)
  }
  const stopSearch = () => {
    searchInput.current?.blur()
    Keyboard.dismiss()
    clearSearch()
  }
  return (
    <View style={s.screen}>
      <View
        style={[
          s.screen,
          {
            zIndex: 1,
            paddingTop: top,
            paddingRight: right,
            paddingBottom: bottom,
            paddingLeft: left,
          },
        ]}
        pointerEvents={libraryInteractive ? 'auto' : 'none'}
        accessibilityElementsHidden={!libraryInteractive}
        importantForAccessibility={libraryInteractive ? 'auto' : 'no-hide-descendants'}
      >
        {!vault ? (
          <ScrollView contentContainerStyle={s.onboarding} keyboardShouldPersistTaps="handled">
            <View style={s.onboardSpacer}>
              <View style={s.onboardArt}>
                <View style={s.onboardPaper}>
                  <Text style={[s.onboardCode, { color: colors.accent }]}>{'== Observations'}</Text>
                  <View style={s.onboardCodeGap} />
                  <Text style={s.onboardCode}>Tide in early today.</Text>
                  <Text style={s.onboardCode}>Light on the water.</Text>
                  <View style={s.onboardCodeGap} />
                  <Text style={[s.onboardCode, { color: palette.yellow }]}>
                    {'$n -> infinity$'}
                  </Text>
                  <View style={s.onboardCodeGap} />
                  <Text style={[s.onboardCode, { color: palette.blue }]}>{'#align(center)['}</Text>
                  <Text style={[s.onboardCode, s.onboardCodeIndent]}>Still here.</Text>
                  <Text style={[s.onboardCode, { color: palette.blue }]}>{']'}</Text>
                  <Text style={[s.onboardCode, { color: palette.overlay2 }]}>
                    {'// begin here'}
                  </Text>
                </View>
                <View style={s.onboardPen}>
                  <Icon name="edit" size={25} color={colors.onAccent} />
                </View>
              </View>
            </View>
            <Text style={s.onboardTitle}>{'Good things start\nwith a little note.'}</Text>
            <Text style={s.onboardBody}>
              Pick a folder to keep your notes in. They stay as plain .typ files you can open
              anywhere.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open a folder"
              disabled={picking}
              onPress={() => void chooseVault()}
              style={({ pressed }) => [
                s.onboardButton,
                pressed && s.pressed,
                picking && s.disabled,
              ]}
            >
              <Icon name="folderOpen" size={22} color={colors.onAccent} />
              <Text style={s.onboardButtonText}>Open a folder</Text>
            </Pressable>
          </ScrollView>
        ) : !setup || setupDone ? (
          <>
            {(error || saveError) && (
              <View style={s.errorInset}>
                {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
                {saveError && (
                  <ErrorBanner message={saveError.message} onDismiss={() => setSaveError(null)} />
                )}
              </View>
            )}
            <View style={s.flex}>
              {isSearching ? (
                <View style={s.flex}>
                  <FlatList
                    style={s.flex}
                    data={results}
                    keyExtractor={(result) => `result:${result.note.uri}`}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    contentContainerStyle={[s.searchList, results.length === 0 && s.emptyList]}
                    renderItem={({ item }) => (
                      <SearchResultRow
                        result={item}
                        query={query}
                        favorite={favoritePaths.has(item.note.path)}
                        vaultName={vault.name}
                        onPress={openResult}
                        onLongPress={startMoveNote}
                        onToggleFavorite={favoriteNoteItem}
                        onTrash={trashNoteItem}
                      />
                    )}
                    ListEmptyComponent={
                      searchBusy ? (
                        <View style={s.empty}>
                          <Text style={s.emptyBody}>Searching…</Text>
                        </View>
                      ) : (
                        <View style={s.empty}>
                          <View style={s.emptyIcon}>
                            <Icon name="search" size={28} />
                          </View>
                          <Text style={s.emptyTitle}>No notes found.</Text>
                          <Pressable
                            accessibilityRole="button"
                            onPress={stopSearch}
                            style={s.textLink}
                          >
                            <Text style={s.linkText}>Clear search</Text>
                          </Pressable>
                        </View>
                      )
                    }
                  />
                </View>
              ) : (
                <View style={s.flex}>
                  {folderViews.map((view, index) => (
                    <Reanimated.View
                      key={`folder:${view.path}`}
                      entering={view.path === '' ? undefined : folderIn}
                      exiting={view.path === '' ? undefined : folderOut}
                      style={
                        index === folderViews.length - 1 ? [s.flex, s.listLayer] : s.hiddenList
                      }
                      pointerEvents={view.current ? 'auto' : 'none'}
                      accessibilityElementsHidden={!view.current}
                      importantForAccessibility={view.current ? 'auto' : 'no-hide-descendants'}
                    >
                      <FlatList
                        style={s.flex}
                        bounces={false}
                        alwaysBounceVertical={false}
                        overScrollMode="never"
                        initialNumToRender={12}
                        maxToRenderPerBatch={16}
                        updateCellsBatchingPeriod={16}
                        windowSize={5}
                        data={view.rows}
                        getItemLayout={view.getItemLayout}
                        keyExtractor={keyExtractor}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                        contentContainerStyle={[s.list, view.empty && s.emptyList]}
                        renderItem={renderLibraryItem}
                        ListHeaderComponent={
                          view.path ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Up to ${
                                parentFolder(view.path) === ''
                                  ? vault.name
                                  : folderName(parentFolder(view.path))
                              }`}
                              onPress={() => goToFolder(parentFolder(view.path))}
                              style={({ pressed }) => [s.parentRow, pressed && s.pressed]}
                            >
                              <Icon name="arrowLeft" size={18} color={colors.muted} />
                              <Text numberOfLines={1} style={s.parentName}>
                                {parentFolder(view.path) === ''
                                  ? vault.name
                                  : folderName(parentFolder(view.path))}
                              </Text>
                            </Pressable>
                          ) : undefined
                        }
                        ListEmptyComponent={
                          view.empty && startupReady && !scanning ? (
                            <View style={s.empty}>
                              <View style={s.emptyIcon}>
                                <Icon
                                  name={view.path ? 'folderOpen' : 'file'}
                                  size={32}
                                  color={view.path ? colors.accent : colors.ink}
                                />
                              </View>
                              <Text style={s.emptyTitle}>
                                {view.path ? 'This folder is empty.' : 'A fresh page awaits.'}
                              </Text>
                              {view.path ? null : (
                                <Text style={s.emptyBody}>
                                  Create your first note, or add .typ files to this folder. They’ll
                                  feel right at home.
                                </Text>
                              )}
                              <Pressable
                                accessibilityRole="button"
                                onPress={openCreate}
                                style={({ pressed }) => [s.emptyButton, pressed && s.pressed]}
                              >
                                <Icon name="plus" size={20} color={colors.onAccent} />
                                <Text style={s.emptyButtonText}>
                                  {view.path ? 'Write a note here' : 'Write your first note'}
                                </Text>
                              </Pressable>
                            </View>
                          ) : undefined
                        }
                      />
                    </Reanimated.View>
                  ))}
                </View>
              )}
              <View style={s.listFade}>
                <View pointerEvents="none" style={s.listFadeRamp}>
                  <Fade id="library-fade" color={colors.paper} mid={0} />
                </View>
                {/* The opaque part takes taps, so hidden rows cannot be opened. */}
                <View style={s.listFadeSolid} />
              </View>
            </View>
            <KeyboardAvoidingView behavior={keyboardBehavior} style={s.dockShell}>
              <View style={s.dock}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isSearching ? 'Cancel search' : 'Settings'}
                  onPress={() => {
                    if (isSearching) {
                      stopSearch()
                      return
                    }
                    if (backGate.blockOpening()) return
                    Keyboard.dismiss()
                    openingScreen.current = 'settings'
                    setSettingsOpen(true)
                  }}
                  style={({ pressed }) => [s.markButton, pressed && s.pressed]}
                >
                  <SwapFaces
                    swapped={isSearching}
                    size={MARK_SIZE}
                    front={<TypoMark size={30} />}
                    back={<Icon name="close" size={30} color={colors.ink} />}
                  />
                </Pressable>
                <Pressable
                  accessible={false}
                  onPress={() => searchInput.current?.focus()}
                  style={s.searchHit}
                >
                  <View style={[s.searchField, isSearching && s.searchFieldActive]}>
                    <Icon name="search" size={22} color={colors.accent} />
                    <TextInput
                      ref={searchInput}
                      accessibilityLabel="Find a thought"
                      placeholder="Find a thought…"
                      placeholderTextColor={colors.muted}
                      value={query}
                      onChangeText={setQuery}
                      style={s.searchFieldInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Sort notes. ${sortLabel}`}
                      accessibilityElementsHidden={isSearching}
                      importantForAccessibility={isSearching ? 'no-hide-descendants' : 'auto'}
                      disabled={isSearching}
                      hitSlop={8}
                      onPress={() => {
                        Keyboard.dismiss()
                        searchInput.current?.blur()
                        setSortOpen(true)
                      }}
                      style={s.searchFieldAction}
                    >
                      <SwapFaces
                        swapped={isSearching}
                        size={22}
                        front={<Icon name="sort" size={22} color={colors.muted} />}
                        back={null}
                      />
                    </Pressable>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create a new note"
                  onPress={openCreate}
                  style={s.dockButton}
                >
                  {({ pressed }) => (
                    <View style={[s.fab, pressed && s.fabPressed]}>
                      <Icon name="plus" size={32} color={colors.onAccent} />
                    </View>
                  )}
                </Pressable>
              </View>
            </KeyboardAvoidingView>
            {trashNotice ? (
              <TrashNotice
                key={trashNotice.id}
                title={trashNotice.title}
                onUndo={
                  trashUndo?.noticeId === trashNotice.id ? () => void undoLastTrash() : undefined
                }
                onDone={() => setTrashNotice(null)}
              />
            ) : notice ? (
              <LibraryNotice key={notice.id} notice={notice} onDone={() => setNotice(null)} />
            ) : null}
          </>
        ) : null}
        {setup && <VaultSetup progress={setup} done={setupDone} onDone={finishSetup} />}
      </View>
      {painted && vault && (
        <MemoNoteSearch
          key={`search:${vault.uri}`}
          notes={notes}
          query={deferredQuery}
          mode={SEARCH_MODE}
          onResults={searchResultsReady}
          onError={searchError}
          onPending={setSearchPending}
        />
      )}
      {painted && workspace && <MemoCompilerHost key={vault?.uri} ref={compiler} />}
      {painted && vault && workspace && (
        <MemoNoteDetail
          key={`detail:${vault.uri}`}
          workspace={workspace}
          active={noteVisible}
          instantIn={!!selected?.created}
          onPrepared={editorPrepared}
          session={detail?.session ?? 0}
          note={detail?.note ?? warmNote}
          opening={!!selected?.opening}
          openError={selected?.openError}
          initialLine={detail?.line}
          initialQuery={isSearching && detail?.line ? query : ''}
          onClose={closeNote}
          onSave={updateNote}
          onSaveError={saveNoteError}
        />
      )}
      {creating && vault && (
        <NewNote
          vault={vault}
          folders={folders}
          directory={folder}
          initialTemplate={templateCache?.vault === vault.uri ? templateCache.source : undefined}
          onFolderCreated={folderCreated}
          onEditTemplate={(source, onSaved) => setTemplateEditor({ source, onSaved })}
          obscured={!!templateEditor}
          onClose={() => {
            settleBack(false, false)
            openingScreen.current = null
            setCreating(false)
          }}
          onCreated={(note) => {
            stopIndex()
            setNotes((previous) => [...previous, note].sort((a, b) => a.path.localeCompare(b.path)))
            clearSearch()
            openingScreen.current = 'note'
            setSelected({ ...prepareNote({ note }), created: true })
          }}
          onDismissed={() => setCreating(false)}
        />
      )}
      {templateEditor && vault && (
        <TemplateEditor
          vault={vault}
          source={templateEditor.source}
          onClose={() => setTemplateEditor(null)}
          onSaved={(source) => {
            const pending = templateEditor
            setTemplateEditor(null)
            pending.onSaved(source)
            templateVersion.current += 1
            setTemplateCache({ vault: vault.uri, source })
            void index(vault, { quiet: true })
          }}
        />
      )}
      {moving && vault && (
        <FolderSheet
          folders={folders}
          vault={vault}
          initial={null}
          excludeTree={moving.kind === 'folder' ? moving.entry.path : undefined}
          defaultParent={parentFolder(
            moving.kind === 'folder' ? moving.entry.path : moving.result.note.path
          )}
          title="Move"
          mode="move"
          counts={noteCounts}
          itemName={
            moving.kind === 'note'
              ? moving.result.note.path.slice(moving.result.note.path.lastIndexOf('/') + 1)
              : moving.entry.name
          }
          itemIcon={moving.kind === 'note' ? 'file' : 'folder'}
          busyLabel="Moving…"
          onConfirm={moveTo}
          onFolderCreated={folderCreated}
          onClose={() => {
            settleBack(false, false)
            openingScreen.current = null
            setMoving(null)
          }}
        />
      )}
      {settingsOpen && vault && (
        <Settings
          vaultName={vault.name}
          picking={picking}
          onChangeFolder={() => {
            closeSettings()
            // The picker and the vault setup have to be visible, and neither
            // can be while Settings covers the library.
            void chooseVault()
          }}
          onClose={closeSettings}
        />
      )}
      {sortOpen && (
        <SortSheet
          sort={sort}
          onChange={(value) => {
            if (value === sort) return
            setSort(value)
          }}
          onClose={() => setSortOpen(false)}
        />
      )}
    </View>
  )
}
