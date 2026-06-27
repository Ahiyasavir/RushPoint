// Virtualized centre canvas for the Builder shell (change:
// v2.1-builder-shell-redesign). Renders the active stage's tasks as scannable
// TaskCards, windowed via @tanstack/react-virtual so a 100+ task stage stays at
// 60 FPS (only the visible rows mount). Falls back to a simple list for tiny
// stages where virtualization overhead isn't worth it.
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Task } from '@rushpoint/shared';
import TaskCard from './TaskCard';

const ROW = 64; // estimated card height + gap (measured precisely at runtime)

export default function TaskCanvas({ tasks, activeTaskId, onSelect }: {
  tasks: Task[]; activeTaskId?: string; onSelect: (taskId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rv = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 6,
  });

  // Small stages: skip the windowing machinery entirely.
  if (tasks.length <= 12) {
    return (
      <div className="space-y-2">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} active={t.id === activeTaskId} onClick={() => onSelect(t.id)} />
        ))}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="overflow-y-auto max-h-[62vh] -mx-1 px-1">
      <div style={{ height: rv.getTotalSize(), position: 'relative', width: '100%' }}>
        {rv.getVirtualItems().map((vi) => {
          const t = tasks[vi.index];
          return (
            <div
              key={t.id}
              ref={rv.measureElement}
              data-index={vi.index}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, paddingBottom: 8 }}
            >
              <TaskCard task={t} active={t.id === activeTaskId} onClick={() => onSelect(t.id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
