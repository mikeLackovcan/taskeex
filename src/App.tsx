import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  addDays,
  dayKey,
  formatDuration,
  formatTime,
  resize,
  schedule,
  unschedule,
  weekStart,
  type Task,
} from './schedule'

const STORAGE_KEY = 'taskeex.tasks.v1'
const TRAY = 'tray'
const DURATIONS = [15, 30, 60, 90, 120]
const DEFAULT_DURATION = 30
const UNDO_MS = 6000

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Task[]) : []
  } catch {
    return []
  }
}

/** A stable colour per task, so a bubble keeps its look wherever it goes. */
function hue(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

// Prefer what is under the pointer; fall back to overlap for keyboard dragging.
const collision: CollisionDetection = (args) => {
  const hit = pointerWithin(args)
  return hit.length ? hit : rectIntersection(args)
}

type Undo = { message: string; previous: Task[] }

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks)
  const [weekOffset, setWeekOffset] = useState(0)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
    } catch {
      // Storage can be unavailable (private window); the app still works for this visit.
    }
  }, [tasks])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // A short press lifts the bubble, so a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const today = new Date()
  const todayKey = dayKey(today)
  const monday = addDays(weekStart(today), weekOffset * 7)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday.getTime()])

  const loose = tasks.filter((t) => !t.day)
  const dragging = tasks.find((t) => t.id === draggingId)
  const editing = tasks.find((t) => t.id === editingId)

  /** Apply a change and offer to undo it for a few seconds. */
  function change(next: Task[], message: string) {
    setUndo({ message, previous: tasks })
    setTasks(next)
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
  }

  function addTask(title: string) {
    const task: Task = { id: crypto.randomUUID(), title, duration: DEFAULT_DURATION }
    setTasks((ts) => [...ts, task])
  }

  function onDragEnd(e: DragEndEvent) {
    setDraggingId(null)
    const id = String(e.active.id)
    const target = e.over ? String(e.over.id) : null
    const task = tasks.find((t) => t.id === id)
    if (!task || !target || target === (task.day ?? TRAY)) return
    if (target === TRAY) {
      change(unschedule(tasks, id), `“${task.title}” is a bubble again`)
      return
    }
    const next = schedule(tasks, id, target)
    const placed = next.find((t) => t.id === id)!
    const label = new Date(`${target}T00:00`).toLocaleDateString(undefined, { weekday: 'long' })
    change(next, `“${task.title}” on ${label} at ${formatTime(placed.start!)}`)
  }

  const range = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={(e) => {
        setDraggingId(String(e.active.id))
        navigator.vibrate?.(8)
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <div className="app">
        <Tray tasks={loose} draggingId={draggingId} onAdd={addTask} onOpen={setEditingId} hasAny={tasks.length > 0} />

        <main className="calendar">
          <header className="week-bar">
            <button className="ghost" aria-label="Previous week" onClick={() => setWeekOffset((w) => w - 1)}>
              ‹
            </button>
            <h2>{range}</h2>
            <button className="ghost" aria-label="Next week" onClick={() => setWeekOffset((w) => w + 1)}>
              ›
            </button>
            {weekOffset !== 0 && (
              <button className="ghost today-btn" onClick={() => setWeekOffset(0)}>
                Today
              </button>
            )}
          </header>
          <div className="days">
            {days.map((d) => {
              const key = dayKey(d)
              return (
                <Day
                  key={key}
                  id={key}
                  date={d}
                  isToday={key === todayKey}
                  isPast={key < todayKey}
                  tasks={tasks.filter((t) => t.day === key).sort((a, b) => a.start! - b.start!)}
                  draggingId={draggingId}
                  onOpen={setEditingId}
                />
              )
            })}
          </div>
        </main>
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
        {dragging && <BubbleFace task={dragging} lifted />}
      </DragOverlay>

      {editing && (
        <Editor
          task={editing}
          onClose={() => setEditingId(null)}
          onRename={(title) => setTasks((ts) => ts.map((t) => (t.id === editing.id ? { ...t, title } : t)))}
          onDuration={(d) => setTasks((ts) => resize(ts, editing.id, d))}
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
}) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY })
  const [text, setText] = useState('')
  return (
    <aside ref={setNodeRef} className={`tray${isOver ? ' over' : ''}`}>
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
          placeholder="Add a task and press Enter"
          aria-label="New task"
          enterKeyHint="done"
          autoComplete="off"
        />
      </form>
      <div className="bubbles">
        {props.tasks.map((t) => (
          <Bubble key={t.id} task={t} hidden={t.id === props.draggingId} onOpen={props.onOpen} />
        ))}
        {props.tasks.length === 0 && (
          <p className="hint">
            {props.hasAny ? 'Everything is on the calendar.' : 'Your tasks appear here as bubbles. Drag one onto a day.'}
          </p>
        )}
      </div>
    </aside>
  )
}

function Day(props: {
  id: string
  date: Date
  isToday: boolean
  isPast: boolean
  tasks: Task[]
  draggingId: string | null
  onOpen: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id })
  const cls = ['day', isOver && 'over', props.isToday && 'today', props.isPast && 'past'].filter(Boolean).join(' ')
  return (
    <section ref={setNodeRef} className={cls}>
      <h3>
        <span>{props.date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
        <b>{props.date.getDate()}</b>
      </h3>
      <div className="day-tasks">
        {props.tasks.map((t) => (
          <Bubble key={t.id} task={t} hidden={t.id === props.draggingId} onOpen={props.onOpen} />
        ))}
      </div>
    </section>
  )
}

function Bubble({ task, hidden, onOpen }: { task: Task; hidden: boolean; onOpen: (id: string) => void }) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id: task.id })
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="bubble-btn"
      style={{ opacity: hidden ? 0.25 : 1 }}
      onClick={() => onOpen(task.id)}
    >
      <BubbleFace task={task} />
    </button>
  )
}

function BubbleFace({ task, lifted }: { task: Task; lifted?: boolean }) {
  return (
    <span className={`bubble${lifted ? ' lifted' : ''}`} style={{ '--h': hue(task.id) } as React.CSSProperties}>
      {task.start !== undefined && <time>{formatTime(task.start)}</time>}
      <span className="title">{task.title}</span>
      <small>{formatDuration(task.duration)}</small>
    </span>
  )
}

function Editor(props: {
  task: Task
  onClose: () => void
  onRename: (title: string) => void
  onDuration: (minutes: number) => void
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
        <input
          className="sheet-title"
          value={task.title}
          aria-label="Task name"
          onChange={(e) => props.onRename(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && props.onClose()}
        />
        <div className="chips" role="group" aria-label="Duration">
          {DURATIONS.map((d) => (
            <button key={d} className={d === task.duration ? 'chip on' : 'chip'} onClick={() => props.onDuration(d)}>
              {formatDuration(d)}
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          {task.day && (
            <button className="ghost" onClick={props.onUnschedule}>
              Take off calendar
            </button>
          )}
          <button className="ghost danger" onClick={props.onDelete}>
            Delete
          </button>
          <button className="primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
