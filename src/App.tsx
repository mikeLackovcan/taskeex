import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  addDays,
  dayKey,
  formatDuration,
  formatTime,
  freeStartAt,
  placeAt,
  resize,
  rollOver,
  schedule,
  setStart,
  unschedule,
  weekStart,
  type Task,
} from './schedule'

const STORAGE_KEY = 'taskeex.tasks.v1'
const TRAY = 'tray'
/** Drop target id of a day's header: dropping there takes the next free slot. */
const HEAD = 'head:'
const DURATIONS = [15, 30, 60, 90, 120]
const DEFAULT_DURATION = 30
const UNDO_MS = 6000
/** Height of one hour on the time grid, in px. Keep in step with --hour in styles.css. */
const HOUR_H = 56
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const PALETTE = 8
const PHONE = '(max-width: 760px)'
const PHONE_DAYS = 14

const px = (minutes: number) => (minutes * HOUR_H) / 60

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // The first visit starts with one bubble that teaches the main move.
    return raw
      ? (JSON.parse(raw) as Task[])
      : [{ id: 'welcome', title: 'Drag me onto a time', duration: DEFAULT_DURATION }]
  } catch {
    return []
  }
}

/** A stable colour per task, so a bubble keeps its look wherever it goes. */
function colour(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 9973
  return h % PALETTE
}

const holds = (el: Element | null, x: number, y: number) => {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

// Find the target under the pointer from where things are on screen right now, because the day
// headers stay put while the grid scrolls under them. The headers and the tray sit on top of
// the grid, so they win over a day column.
const collision: CollisionDetection = (args) => {
  const pt = args.pointerCoordinates
  if (!pt) return rectIntersection(args)
  const hits = args.droppableContainers.filter((c) => holds(c.node.current, pt.x, pt.y))
  const head = hits.find((h) => String(h.id).startsWith(HEAD))
  const tray = hits.find((h) => h.id === TRAY)
  const inGrid = holds(document.querySelector('.grid-scroll'), pt.x, pt.y)
  const col = inGrid ? hits.find((h) => h !== head && h !== tray) : undefined
  const hit = head ?? tray ?? col
  return hit ? [{ id: hit.id }] : []
}

type Undo = { message: string; previous: Task[] }
type Preview = { day: string; start: number }

function useIsPhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE)
    const onChange = () => setPhone(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return phone
}

const weekday = (day: string, style: 'long' | 'short' = 'long') =>
  new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: style })

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks)
  const [now, setNow] = useState(() => new Date())
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState(() => dayKey(new Date()))
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const scroller = useRef<HTMLDivElement>(null)
  const isPhone = useIsPhone()

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
    } catch {
      // Storage can be unavailable (private window); the app still works for this visit.
    }
  }, [tasks])

  // Keep the clock current, and bring rolling tasks forward when the app opens or the day changes.
  useEffect(() => {
    const tick = () => {
      setNow(new Date())
      setTasks((ts) => rollOver(ts))
    }
    tick()
    const timer = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  // Open on the part of the day that matters: a little before now, and never earlier than 7:00.
  useLayoutEffect(() => {
    const minutes = Math.max(7 * 60, new Date().getHours() * 60 - 60)
    if (isPhone) {
      const col = document.querySelector<HTMLElement>('.col')
      const tray = document.querySelector<HTMLElement>('.tray')
      if (col && tray) window.scrollTo(0, col.offsetTop + px(minutes) - tray.offsetHeight)
    } else if (scroller.current) {
      scroller.current.scrollTop = px(minutes)
    }
  }, [isPhone])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // A short press lifts the bubble, so a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const todayKey = dayKey(now)
  // A computer shows the week. A phone shows one day, picked from a strip that starts today.
  const stripStart = isPhone
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : addDays(weekStart(now), weekOffset * 7)
  const strip = useMemo(
    () => Array.from({ length: isPhone ? PHONE_DAYS : 7 }, (_, i) => dayKey(addDays(stripStart, i))),
    [stripStart.getTime(), isPhone],
  )
  const columns = isPhone ? [selectedDay] : strip

  const loose = tasks.filter((t) => !t.day).sort((a, b) => Number(!!a.done) - Number(!!b.done))
  const dragging = tasks.find((t) => t.id === draggingId)
  const editing = tasks.find((t) => t.id === editingId)

  /** Apply a change and offer to undo it for a few seconds. */
  function change(next: Task[], message: string) {
    setUndo({ message, previous: tasks })
    setTasks(next)
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
  }

  /** The time under the top edge of the lifted bubble, when it is held over a day column. */
  function landingOn(over: string | null, id: string): Preview | null {
    if (!over || over === TRAY || over.startsWith(HEAD)) return null
    const col = document.querySelector<HTMLElement>(`[data-col="${over}"]`)
    const lifted = document.querySelector<HTMLElement>('.lifted')
    if (!col || !lifted) return null
    const y = lifted.getBoundingClientRect().top - col.getBoundingClientRect().top
    return { day: over, start: freeStartAt(tasks, id, over, (y / HOUR_H) * 60) }
  }

  // Runs on every move, and again when the target under the bubble changes.
  function onDragMove(e: DragMoveEvent | DragOverEvent) {
    const next = landingOn(e.over ? String(e.over.id) : null, String(e.active.id))
    setPreview((p) => (p?.day === next?.day && p?.start === next?.start ? p : next))
  }

  function endDrag() {
    setDraggingId(null)
    setPreview(null)
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id)
    const target = e.over ? String(e.over.id) : null
    // Measure before the lifted bubble leaves the screen.
    const landing = landingOn(target, id)
    endDrag()
    const task = tasks.find((t) => t.id === id)
    if (!task || !target) return
    if (target === TRAY) {
      if (task.day) change(unschedule(tasks, id), `“${task.title}” is a bubble again`)
      return
    }
    const onHead = target.startsWith(HEAD)
    const day = onHead ? target.slice(HEAD.length) : target
    if (onHead && day === task.day) return
    const next = onHead || !landing ? schedule(tasks, id, day) : placeAt(tasks, id, landing.day, landing.start)
    const placed = next.find((t) => t.id === id)!
    if (placed.day === task.day && placed.start === task.start) return
    change(next, `Moved to ${weekday(day)} at ${formatTime(placed.start!)}`)
  }

  const first = new Date(`${strip[0]}T00:00`)
  const last = new Date(`${strip[strip.length - 1]}T00:00`)
  const range = `${first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`

  const heads = (
    <div className="heads">
      {!isPhone && <div className="gutter-head" />}
      {strip.map((key) => (
        <DayHead
          key={key}
          day={key}
          isToday={key === todayKey}
          selected={isPhone && key === selectedDay}
          count={tasks.filter((t) => t.day === key && !t.done).length}
          onSelect={() => setSelectedDay(key)}
        />
      ))}
    </div>
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={(e) => {
        setDraggingId(String(e.active.id))
        navigator.vibrate?.(8)
      }}
      onDragMove={onDragMove}
      onDragOver={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={endDrag}
    >
      <div className="app">
        <Tray
          tasks={loose}
          draggingId={draggingId}
          onAdd={(title) => setTasks((ts) => [...ts, { id: crypto.randomUUID(), title, duration: DEFAULT_DURATION }])}
          onOpen={setEditingId}
          hasAny={tasks.length > 0}
        >
          {isPhone && heads}
        </Tray>

        <main className="calendar">
          {!isPhone && (
            <header className="week-bar">
              <h2>{range}</h2>
              <button className="ghost arrow" aria-label="Previous week" onClick={() => setWeekOffset((w) => w - 1)}>
                ‹
              </button>
              <button className="ghost arrow" aria-label="Next week" onClick={() => setWeekOffset((w) => w + 1)}>
                ›
              </button>
              {weekOffset !== 0 && (
                <button className="ghost today-btn" onClick={() => setWeekOffset(0)}>
                  Today
                </button>
              )}
            </header>
          )}
          <div className="grid-scroll" ref={scroller}>
            {!isPhone && heads}
            <div className="grid">
              <div className="gutter" aria-hidden="true">
                {HOURS.slice(1).map((h) => (
                  <span key={h} style={{ top: px(h * 60) }}>
                    {h}:00
                  </span>
                ))}
              </div>
              {columns.map((key) => (
                <Column
                  key={key}
                  day={key}
                  isToday={key === todayKey}
                  nowMinutes={now.getHours() * 60 + now.getMinutes()}
                  tasks={tasks.filter((t) => t.day === key)}
                  draggingId={draggingId}
                  preview={preview?.day === key && dragging ? { ...dragging, start: preview.start } : undefined}
                  onOpen={setEditingId}
                />
              ))}
            </div>
          </div>
        </main>
      </div>

      <DragOverlay dropAnimation={null}>{dragging && <BubbleFace task={dragging} lifted />}</DragOverlay>

      {editing && (
        <Editor
          task={editing}
          onClose={() => setEditingId(null)}
          onRename={(title) => setTasks((ts) => ts.map((t) => (t.id === editing.id ? { ...t, title } : t)))}
          onDuration={(d) => setTasks((ts) => resize(ts, editing.id, d))}
          onStart={(start) => setTasks((ts) => setStart(ts, editing.id, start))}
          onRolling={(rolling) => setTasks((ts) => ts.map((t) => (t.id === editing.id ? { ...t, rolling } : t)))}
          onDone={() => {
            const done = !editing.done
            change(
              tasks.map((t) => (t.id === editing.id ? { ...t, done } : t)),
              done ? `Done: ${editing.title}` : `Not done: ${editing.title}`,
            )
            setEditingId(null)
          }}
          onUnschedule={() => {
            change(unschedule(tasks, editing.id), `“${editing.title}” is a bubble again`)
            setEditingId(null)
          }}
          onDelete={() => {
            change(
              tasks.filter((t) => t.id !== editing.id),
              `Deleted “${editing.title}”`,
            )
            setEditingId(null)
          }}
        />
      )}

      {undo && (
        <div className="toast" role="status">
          <span>{undo.message}</span>
          <button
            onClick={() => {
              setTasks(undo.previous)
              setUndo(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
    </DndContext>
  )
}

function Tray(props: {
  tasks: Task[]
  draggingId: string | null
  hasAny: boolean
  onAdd: (title: string) => void
  onOpen: (id: string) => void
  children?: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY })
  const [text, setText] = useState('')
  return (
    <aside ref={setNodeRef} className={`tray${isOver ? ' over' : ''}`}>
      <h1 className="wordmark">
        <i aria-hidden="true" />
        taskeex
      </h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const title = text.trim()
          if (!title) return
          props.onAdd(title)
          setText('')
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task"
          aria-label="New task"
          enterKeyHint="done"
          autoComplete="off"
        />
        {text.trim() && (
          <button type="submit" className="add" aria-label="Add task">
            +
          </button>
        )}
      </form>
      <div className="bubbles">
        {props.tasks.map((t) => (
          <Bubble key={t.id} task={t} hidden={t.id === props.draggingId} onOpen={props.onOpen} />
        ))}
        {props.tasks.length === 0 && (
          <p className="hint">
            {props.hasAny ? 'Everything is on the calendar.' : 'Your tasks appear here as bubbles. Drag one onto a time.'}
          </p>
        )}
      </div>
      {props.children}
    </aside>
  )
}

function DayHead(props: { day: string; isToday: boolean; selected: boolean; count: number; onSelect: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: HEAD + props.day })
  const cls = ['head', isOver && 'over', props.isToday && 'today', props.selected && 'selected'].filter(Boolean).join(' ')
  return (
    <button
      ref={setNodeRef}
      className={cls}
      onClick={props.onSelect}
      aria-label={`${weekday(props.day)} ${Number(props.day.slice(8))}, ${props.count} to do`}
    >
      <span>{weekday(props.day, 'short')}</span>
      <b>{Number(props.day.slice(8))}</b>
      <i className={props.count ? 'dot on' : 'dot'} aria-hidden="true" />
    </button>
  )
}

function Column(props: {
  day: string
  isToday: boolean
  nowMinutes: number
  tasks: Task[]
  draggingId: string | null
  preview?: Task
  onOpen: (id: string) => void
}) {
  const { setNodeRef } = useDroppable({ id: props.day })
  return (
    <section ref={setNodeRef} data-col={props.day} className={props.isToday ? 'col today' : 'col'}>
      {props.tasks.map((t) => (
        <Bubble key={t.id} task={t} hidden={t.id === props.draggingId} onOpen={props.onOpen} />
      ))}
      {props.preview && (
        <div className="slot" style={{ top: px(props.preview.start!), height: px(props.preview.duration) }}>
          <time>{formatTime(props.preview.start!)}</time>
        </div>
      )}
      {props.isToday && <div className="now" style={{ top: px(props.nowMinutes) }} aria-hidden="true" />}
    </section>
  )
}

/** A task, as a loose bubble in the tray or as a block on the time grid. */
function Bubble({ task, hidden, onOpen }: { task: Task; hidden: boolean; onOpen: (id: string) => void }) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id: task.id })
  const onGrid = task.start !== undefined
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={onGrid ? 'bubble-btn block' : 'bubble-btn'}
      style={{
        opacity: hidden ? 0.25 : 1,
        ...(onGrid && { top: px(task.start!), height: px(task.duration) }),
      }}
      onClick={() => onOpen(task.id)}
    >
      <BubbleFace task={task} />
    </button>
  )
}

function BubbleFace({ task, lifted }: { task: Task; lifted?: boolean }) {
  const cls = ['bubble', `c${colour(task.id)}`, lifted && 'lifted', task.done && 'done'].filter(Boolean).join(' ')
  return (
    <span className={cls}>
      <span className="title">
        {task.done && <span aria-label="Done">✓ </span>}
        {task.title}
      </span>
      {task.start !== undefined && !lifted ? (
        <time>
          {formatTime(task.start)} – {formatTime(task.start + task.duration)}
        </time>
      ) : (
        <small>{formatDuration(task.duration)}</small>
      )}
    </span>
  )
}

function Editor(props: {
  task: Task
  onClose: () => void
  onRename: (title: string) => void
  onDuration: (minutes: number) => void
  onStart: (minutes: number) => void
  onRolling: (rolling: boolean) => void
  onDone: () => void
  onUnschedule: () => void
  onDelete: () => void
}) {
  const { task } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" role="dialog" aria-label="Task details" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <input
            className="sheet-title"
            value={task.title}
            aria-label="Task name"
            onChange={(e) => props.onRename(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && props.onClose()}
          />
          <button className="ghost" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        {task.day && (
          <label className="row">
            <span>
              Starts at
              <small>{new Date(`${task.day}T00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</small>
            </span>
            <input
              type="time"
              step={900}
              value={`${String(Math.floor(task.start! / 60)).padStart(2, '0')}:${String(task.start! % 60).padStart(2, '0')}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number)
                if (!Number.isNaN(h) && !Number.isNaN(m)) props.onStart(h * 60 + m)
              }}
            />
          </label>
        )}
        <div className="chips" role="group" aria-label="Length">
          {DURATIONS.map((d) => (
            <button key={d} className={d === task.duration ? 'chip on' : 'chip'} onClick={() => props.onDuration(d)}>
              {formatDuration(d)}
            </button>
          ))}
        </div>
        <label className="row">
          <span>
            Rolling
            <small>Moves to today until it is done</small>
          </span>
          <input type="checkbox" checked={!!task.rolling} onChange={(e) => props.onRolling(e.target.checked)} />
        </label>
        <div className="sheet-actions">
          {task.day && (
            <button className="ghost" onClick={props.onUnschedule}>
              Take off calendar
            </button>
          )}
          <button className="ghost danger" onClick={props.onDelete}>
            Delete
          </button>
          <button className="primary" onClick={props.onDone}>
            {task.done ? 'Mark not done' : 'Mark done'}
          </button>
        </div>
      </div>
    </div>
  )
}
