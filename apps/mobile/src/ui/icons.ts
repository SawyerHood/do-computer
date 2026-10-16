// Every symbol the app draws: its SF Symbol on iOS, and a drawing of the same thing for where
// there are none (Android, and the browser build the tests run).
export const ICONS = {
  chevronLeft: ["chevron.left", '<path d="m15 5-7 7 7 7"/>'],
  chevronRight: ["chevron.right", '<path d="m9 5 7 7-7 7"/>'],
  chevronDown: ["chevron.down", '<path d="m6 9 6 6 6-6"/>'],
  plus: ["plus", '<path d="M12 5v14M5 12h14"/>'],
  close: ["xmark", '<path d="M6 6l12 12M18 6 6 18"/>'],
  check: ["checkmark", '<path d="m5 12.5 4.5 4.500L19 7.5"/>'],
  search: ["magnifyingglass", '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'],
  compose: [
    "square.and.pencil",
    '<path d="M12 4H6.500A2.5 2.5 0 0 0 4 6.500v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.500V12"/><path d="m10 14 .700-3L19 2.800l2.2 2.200L13 13.300z"/>',
  ],
  mic: [
    "mic",
    '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.500a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  ],
  arrowUp: ["arrow.up", '<path d="M12 19V5M6 11l6-6 6 6"/>'],
  stop: [
    "stop.fill",
    '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  ],
  more: ["ellipsis", '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.8"/>'],
  reorder: ["line.3.horizontal", '<path d="M4 7.500h16M4 12h16M4 16.500h16"/>'],
  chats: [
    "bubble.left.and.bubble.right",
    '<path d="M14 9.500A5.5 5.5 0 0 0 8.5 4h-1A5.5 5.5 0 0 0 4 13.700V17l3-1.600h1.5"/><path d="M11 13.500a4.5 4.5 0 0 1 4.5-4.500h1a4.5 4.5 0 0 1 3 7.900V20l-2.8-1.500h-1.200a4.5 4.5 0 0 1-4.5-4.500z"/>',
  ],
  folder: [
    "folder",
    '<path d="M3 7.500A1.5 1.5 0 0 1 4.5 6h4.600l2 2.200h8.400A1.5 1.5 0 0 1 21 9.700v7.800a1.5 1.5 0 0 1-1.5 1.500h-15A1.5 1.5 0 0 1 3 17.500z"/>',
  ],
  doc: [
    "doc.text",
    '<path d="M7 3h7l4 4v12.500A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.500v-15A1.5 1.5 0 0 1 7.5 3z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>',
  ],
  clock: ["clock", '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.500V12l3 2"/>'],
  bolt: ["bolt", '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>'],
  plug: ["powerplug", '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>'],
  shield: [
    "checkmark.shield",
    '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  ],
  desktop: [
    "desktopcomputer",
    '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.500V20"/>',
  ],
  person: ["person", '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'],
  people: [
    "person.2",
    '<circle cx="9" cy="9" r="3.5"/><path d="M2.5 19.500a6.5 6.5 0 0 1 13 0M16 5.700a3.5 3.5 0 0 1 0 6.600M18.5 15a6.5 6.5 0 0 1 3 4.5"/>',
  ],
  gear: [
    "gearshape",
    '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.5 12H21M5.6 5.600l1.8 1.800M16.6 16.600l1.8 1.800M5.6 18.400l1.8-1.800M16.6 7.400l1.8-1.8"/>',
  ],
  bell: [
    "bell",
    '<path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.5 2h-15zM10 20.500a2 2 0 0 0 4 0"/>',
  ],
  lock: [
    "lock",
    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  ],
  share: [
    "square.and.arrow.up",
    '<path d="M12 15V3.500M8 7l4-4 4 4M6 11H5.500A1.5 1.5 0 0 0 4 12.500v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.500v-6a1.5 1.5 0 0 0-1.5-1.500H18"/>',
  ],
  photo: [
    "photo",
    '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.5"/><path d="m4 17 5-4.5 3.5 3 3-2.500L21 17"/>',
  ],
  camera: [
    "camera",
    '<path d="M4 8.500A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.500v9a1.5 1.5 0 0 1-1.5 1.500h-13A1.5 1.5 0 0 1 4 17.500z"/><circle cx="12" cy="13" r="3.5"/>',
  ],
  trash: [
    "trash",
    '<path d="M4.5 7h15M9.5 7V4.500h5V7M6.5 7l.800 12.500h9.400L17.5 7M10 11v5M14 11v5"/>',
  ],
  pause: ["pause.fill", '<path d="M8.5 6v12M15.5 6v12" stroke-width="2.6"/>'],
  play: ["play.fill", '<path d="M8 5.500v13l10.5-6.500z" fill="currentColor"/>'],
  gift: [
    "gift",
    '<rect x="4" y="10" width="16" height="10" rx="1.5"/><path d="M3 7h18v3H3zM12 7v13M12 7c-1.5-4-6-3.5-5-1 .600 1.3 3 1 5 1zm0 0c1.5-4 6-3.5 5-1-.600 1.3-3 1-5 1z"/>',
  ],
  hanger: [
    "hanger",
    '<path d="M12 8.500c0-1.5 2-1.7 2-3.500a2 2 0 0 0-4 0M12 8.500l8.5 6.300c1 .800.5 2.2-.700 2.200H4.200c-1.2 0-1.7-1.4-.700-2.200z"/>',
  ],
  link: [
    "link",
    '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.700l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.700l1-1"/>',
  ],
  pin: ["pin", '<path d="M9 3.5h6M10 3.500v6l-3 3.500h10l-3-3.500v-6M12 13v7.5"/>'],
  pinFill: [
    "pin.fill",
    '<path d="M10 3.500h4v6l3 3.500H7l3-3.500z" fill="currentColor"/><path d="M9 3.5h6M12 13v7.5"/>',
  ],
  pinSlash: [
    "pin.slash",
    '<path d="M9 3.5h6M10 3.500v6l-3 3.500h10l-3-3.500v-6M12 13v7.5M4 4l16 16"/>',
  ],
  globe: [
    "globe",
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.500c3 3 3 14 0 17M12 3.500c-3 3-3 14 0 17"/>',
  ],
  pencil: ["pencil", '<path d="m5 19 .800-3.800L16.5 4.500l3 3L8.8 18.200z"/>'],
  history: [
    "clock.arrow.circlepath",
    '<path d="M4 12a8 8 0 1 0 2.5-5.800M4 4.500v4h4M12 8v4.500l3 1.5"/>',
  ],
  eye: [
    "eye",
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  ],
  terminal: [
    "apple.terminal",
    '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.500M12.5 15h4"/>',
  ],
  clip: [
    "paperclip",
    '<path d="m20 11-8.5 8.500a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.700l-8.5 8.500a1.7 1.7 0 0 1-2.4-2.400L14.5 7"/>',
  ],
  note: ["note.text", '<path d="M5 4.500h14v10l-5 5H5zM14 19.500v-5h5M8.5 9h7M8.5 12.500h4"/>'],
  chart: ["chart.bar", '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" stroke-width="2.4"/>'],
  refresh: ["arrow.clockwise", '<path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.400M19.5 4v4h-4"/>'],
  hash: ["number", '<path d="M9 3.5 7.5 20.500M16.5 3.5 15 20.500M4 9h16.500M3.5 15H20"/>'],
  wave: [
    "waveform",
    '<path d="M4 10v4M8 6.500v11M12 3.500v17M16 7.500v9M20 10.500v3" stroke-width="2"/>',
  ],
  brain: [
    "brain",
    '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.500A3.2 3.2 0 0 0 7 17a3 3 0 0 0 5 1.500V5.500A2.5 2.5 0 0 0 9 4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.500A3.2 3.2 0 0 1 17 17a3 3 0 0 1-5 1.5"/>',
  ],
  cpu: [
    "cpu",
    '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M10 3.500v3M14 3.500v3M10 17.500v3M14 17.500v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3"/>',
  ],
  qr: [
    "qrcode",
    '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2.500v2.500H14zM18 18h2v2h-2zM18 14h2M14 19h1.5"/>',
  ],
  heart: [
    "heart.fill",
    '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.5 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  ],
  moon: ["moon", '<path d="M20 14.500A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.500z"/>'],
  mail: [
    "envelope",
    '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 6 8.5-6"/>',
  ],
  list: ["list.bullet", '<path d="M4 7h16M4 12h16M4 17h16"/>'],
  arrowUpRight: ["arrow.up.right", '<path d="M8 16 16.5 7.500M9.5 7.500h7v7"/>'],
  copy: [
    "doc.on.doc",
    '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.500A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.500v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  ],
  download: ["arrow.down.to.line", '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.500M5 19.500h14"/>'],
  spark: ["sparkles", '<path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z"/>'],
  pointer: ["cursorarrow", '<path d="M6 3.5 18.5 13l-5.6.600L10 19z" fill="currentColor"/>'],
  info: ["info.circle", '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'],
  warning: ["exclamationmark.triangle", '<path d="M12 4 3 19.500h18zM12 10v4.500M12 17h.01"/>'],
  archive: [
    "archivebox",
    '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.500a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  ],
  key: [
    "key",
    '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.500l2.5 2.500M13 10l2 2"/>',
  ],
  card: [
    "creditcard",
    '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  ],
  slider: [
    "slider.horizontal.3",
    '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  ],
  checkCircle: [
    "checkmark.circle.fill",
    '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.5 2.7 2.700L16 9.5"/>',
  ],
  circle: ["circle", '<circle cx="12" cy="12" r="8.5"/>'],
  arrowDown: ["arrow.down", '<path d="M12 5v14M6 13l6 6 6-6"/>'],
  signOut: [
    "rectangle.portrait.and.arrow.right",
    '<path d="M14 4.500H7A1.5 1.5 0 0 0 5.5 6v12A1.5 1.5 0 0 0 7 19.500h7M10.5 12h9M16.5 8.5 20 12l-3.5 3.5"/>',
  ],
  restore: ["arrow.uturn.backward", '<path d="M8 6 4 10l4 4M4 10h10.500a5 5 0 0 1 0 10H11"/>'],
  question: [
    "questionmark",
    '<path d="M8.5 9a3.5 3.5 0 1 1 5 3.200c-1 .500-1.5 1.2-1.5 2.300M12 18h.01"/>',
  ],
  code: [
    "chevron.left.forwardslash.chevron.right",
    '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5.500l-3 13"/>',
  ],
  checklist: [
    "checklist",
    '<path d="m4 7 1.5 1.500L8.5 5.500M4 15.500l1.5 1.5 3-3M12 7.500h8M12 16h8"/>',
  ],
  bold: ["bold", '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'],
  italic: ["italic", '<path d="M10 5h7M7 19h7M14 5l-4 14"/>'],
  heading: ["textformat.size", '<path d="M6 5v14M18 5v14M6 12h12"/>'],
  sidebar: [
    "sidebar.left",
    '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M9 5v14"/>',
  ],
  wifiOff: [
    "wifi.slash",
    '<path d="M4 4l16 16M8.5 15.500a5 5 0 0 1 7 0M5 12a10 10 0 0 1 4-2.500M19 12a10 10 0 0 0-5-3"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
  ],
  star: [
    "star",
    '<path d="m12 4 2.4 5.2 5.6.600-4.2 3.8 1.2 5.600L12 16.300l-5 2.9 1.2-5.600L4 9.800l5.6-.600z"/>',
  ],
  move: [
    "folder.badge.plus",
    '<path d="M3 7.500A1.5 1.5 0 0 1 4.5 6h4.600l2 2.200h8.400A1.5 1.5 0 0 1 21 9.700v7.800a1.5 1.5 0 0 1-1.5 1.500h-15A1.5 1.5 0 0 1 3 17.500zM10 13.500h5M13 11l2.5 2.500L13 16"/>',
  ],
  apple: [
    "apple.logo",
    '<path d="M12 7.500c-2-1.6-6.5-1-6.5 4 0 4 2.5 8 4.5 8 .900 0 1.3-.500 2-.500s1.1.500 2 .500c2 0 4.5-4 4.5-8 0-5-4.5-5.6-6.5-4zM12 7.500c0-1.5.600-2.8 2-3.5"/>',
  ],
} as const satisfies Record<string, readonly [sf: string, svg: string]>

export type IconName = keyof typeof ICONS
