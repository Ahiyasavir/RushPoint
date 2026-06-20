// Task library browser (§4/§10) — opened from the Builder to pull a public task
// into the stage being edited. Picking a task reconstructs it as a fresh Task
// (new id) and bumps the source's copyCount.
import { useEffect, useState } from 'react';
import type { PublicTask, Task } from '@rushpoint/shared';
import { searchTaskLibrary, incrementTaskCopyCount } from '../services/calls';
import { Button, Card, Input, Spinner } from './ui';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

function toTask(pt: PublicTask): Task {
  return {
    id: uuid(),
    title: pt.title,
    description: pt.description,
    type: pt.type,
    coordinates: pt.coordinates,
    difficulty: pt.difficulty,
    estimatedMinutes: pt.estimatedMinutes,
    pointValue: pt.pointValue,
    maxConcurrentTeams: 3,
    tags: pt.tags ?? [],
  };
}

export default function TaskLibrary({ onInsert, onClose }: {
  onInsert: (task: Task) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<PublicTask[] | null>(null);

  async function run() {
    setTasks(null);
    const { tasks } = await searchTaskLibrary({ query: q });
    setTasks(tasks);
  }
  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  function pick(pt: PublicTask) {
    onInsert(toTask(pt));
    incrementTaskCopyCount({ publicTaskId: pt.id }).catch(() => undefined);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card className="w-full max-w-2xl p-5 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Insert from task library</h3>
          <button className="text-zinc-500 hover:text-zinc-300 text-sm" onClick={onClose}>✕</button>
        </div>
        <div className="flex gap-2 mb-4">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search public tasks…"
            onKeyDown={(e) => e.key === 'Enter' && run()} />
          <Button onClick={run}>Search</Button>
        </div>

        <div className="overflow-y-auto space-y-2">
          {!tasks ? <Spinner label="Loading library…" /> : tasks.length === 0 ? (
            <p className="text-center text-zinc-500 py-10 text-sm">No public tasks match. Publish a game to seed the library.</p>
          ) : tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 border border-glass-border rounded-lg p-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200 truncate">{t.title}</div>
                <div className="text-xs text-zinc-500 truncate">{t.description}</div>
                <div className="flex gap-2 text-[11px] text-zinc-600 mt-0.5">
                  <span>{t.type}</span>·<span>diff {t.difficulty}</span>·<span>{t.pointValue} pts</span>·<span>{t.copyCount} copies</span>
                  {t.sourceGameTitle && <span className="truncate">· from {t.sourceGameTitle}</span>}
                </div>
              </div>
              <Button variant="subtle" onClick={() => pick(t)}>Insert</Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
