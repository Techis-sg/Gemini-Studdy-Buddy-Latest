import React, { useMemo, useState } from "react";
import { Task, Subject } from "@/types";
import { getPriorityColor, getCategoryBg, getStatusColor, formatDate, getFormattedTaskId, getSubjectName } from "@utils/index";
import { DataTable, ActionMenuPortal, Tooltip } from "@components/ui";
import { ColumnDef } from "@tanstack/react-table";
import { IconEye as Eye, IconClock as Clock, IconEdit as Edit2, IconTrash as Trash } from "@tabler/icons-react";

interface TasksListViewProps {
  tasks: Task[];
  subjects: Subject[];
  itemsPerPage: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onDeleteTask: (taskId: string) => void;
  onOpenTimeTracker: (task: Task) => void;
  onOpenEditTask: (task: Task) => void;
  onViewDetails: (task: Task) => void;
}

function StatusCell({ task, onUpdateTask }: { task: Task; onUpdateTask: (id: string, updates: Partial<Task>) => void }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <select
        autoFocus
        value={task.status}
        onChange={(e) => {
          const nextStatus = e.target.value as Task["status"];
          const nextCol = nextStatus === "Completed" ? "completed" : "today";
          onUpdateTask(task.id, { status: nextStatus, boardColumnId: nextCol });
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className="text-[10px] p-1 font-bold rounded-lg border border-indigo-400 bg-white text-slate-800 shadow-sm focus:outline-none cursor-pointer"
      >
        <option value="Not Started">Not Started</option>
        <option value="In Progress">In Progress</option>
        <option value="Completed">Completed</option>
      </select>
    );
  }

  return (
    <span
      onDoubleClick={() => setEditing(true)}
      onClick={() => setEditing(true)}
      title="Click or double-click to change status inline"
      className={`text-[10px] px-2.5 py-1 font-bold uppercase rounded-lg shadow-sm border border-slate-100/20 inline-block cursor-pointer hover:scale-105 transition-all ${getStatusColor(task.status)}`}
    >
      {task.status}
    </span>
  );
}

function PriorityCell({ task, onUpdateTask }: { task: Task; onUpdateTask: (id: string, updates: Partial<Task>) => void }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <select
        autoFocus
        value={task.priority}
        onChange={(e) => {
          const nextPriority = e.target.value as Task["priority"];
          onUpdateTask(task.id, { priority: nextPriority });
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className="text-[10px] p-1 font-bold rounded-lg border border-indigo-400 bg-white text-slate-800 shadow-sm focus:outline-none cursor-pointer"
      >
        <option value="Low">Low</option>
        <option value="Medium">Medium</option>
        <option value="High">High</option>
      </select>
    );
  }

  return (
    <span
      onDoubleClick={() => setEditing(true)}
      onClick={() => setEditing(true)}
      title="Click or double-click to change priority inline"
      className={`text-[10px] px-2.5 py-1 font-bold uppercase rounded-lg shadow-sm border border-slate-100/20 inline-block cursor-pointer hover:scale-105 transition-all ${getPriorityColor(task.priority)}`}
    >
      {task.priority}
    </span>
  );
}

export default function TasksListView({
  tasks,
  subjects,
  itemsPerPage,
  currentPage,
  onPageChange,
  onUpdateTask,
  onDeleteTask,
  onOpenTimeTracker,
  onOpenEditTask,
  onViewDetails,
}: TasksListViewProps) {
  const columns = useMemo<ColumnDef<Task>[]>(() => [
    {
      id: "task",
      header: "Task",
      size: 360,
      cell: ({ row }) => {
        const task = row.original;
        const isCompleted = task.status === "Completed";
        const displayTaskId = getFormattedTaskId(task, row.index + (currentPage - 1) * itemsPerPage);
        const handleToggleStatus = () => {
          const nextStatus = isCompleted ? "Not Started" : "Completed";
          const nextCol = nextStatus === "Completed" ? "completed" : "today";
          onUpdateTask(task.id, { status: nextStatus, boardColumnId: nextCol });
        };
        return (
          <div className="flex items-start gap-3 py-1">
            <button
              type="button"
              onClick={handleToggleStatus}
              className={`w-5 h-5 mt-0.5 shrink-0 border rounded-md flex items-center justify-center cursor-pointer select-none active:scale-95 transition-all shadow-sm ${
                isCompleted
                  ? "bg-emerald-500 border-emerald-500 text-white font-bold"
                  : "bg-white border-slate-300 hover:bg-slate-50"
              }`}
              title="Toggle Completed"
            >
              {isCompleted ? "✓" : ""}
            </button>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-mono text-[11px] font-bold text-indigo-600 block">
                {displayTaskId}
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  onClick={() => onViewDetails(task)}
                  className={`font-bold text-sm block text-slate-800 break-words whitespace-normal cursor-pointer hover:text-indigo-600 hover:underline transition-colors ${
                    isCompleted ? "line-through text-slate-400 font-normal" : ""
                  }`}
                >
                  {task.title}
                </span>
                {task.notes && (
                  <Tooltip
                    position="bottom"
                    content={
                      <div className="max-w-xs text-left font-sans p-1">
                        <span className="font-bold text-amber-300 block mb-1">📝 Task Notes</span>
                        <p className="text-slate-100 text-xs leading-relaxed whitespace-pre-wrap font-normal">{task.notes}</p>
                      </div>
                    }
                  >
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 px-2 py-0.5 rounded-md cursor-help shadow-2xs transition-all">
                      📝 Note
                    </span>
                  </Tooltip>
                )}
              </div>
              {task.attachments && task.attachments.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {task.attachments.map((a) => (
                    <span
                      key={a.id}
                      className="text-[9px] bg-slate-100 border border-slate-200 px-2 py-0.5 font-mono rounded-md flex items-center gap-1 shadow-sm text-slate-600"
                    >
                      📎 {a.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "date",
      header: "Scheduled Date",
      size: 140,
      cell: ({ row }) => {
        const task = row.original;
        const todayStr = (() => {
          const d = new Date();
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const dayStr = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${dayStr}`;
        })();
        const isToday = task.date === todayStr;
        return isToday ? (
          <span className="flex flex-col gap-0.5 text-xs">
            <span className="text-slate-800 font-mono font-bold">{formatDate(task.date)}</span>
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-md w-max animate-pulse">
              Today 🌟
            </span>
          </span>
        ) : (
          <span className="font-mono font-bold text-slate-600 text-xs">{formatDate(task.date)}</span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      size: 120,
      cell: ({ row }) => <StatusCell task={row.original} onUpdateTask={onUpdateTask} />,
    },
    {
      accessorKey: "priority",
      header: "Priority",
      size: 110,
      cell: ({ row }) => <PriorityCell task={row.original} onUpdateTask={onUpdateTask} />,
    },
    {
      accessorKey: "timeSpentMinutes",
      header: "TimeLog",
      size: 100,
      cell: ({ row }) => {
        const task = row.original;
        return task.timeSpentMinutes > 0 ? (
          <span className="inline-flex items-center gap-1 bg-indigo-50/70 text-indigo-700 px-2.5 py-1 rounded-xl border border-indigo-100/40 text-[11px] shadow-sm font-mono font-bold">
            ⏱️ {task.timeSpentMinutes}m
          </span>
        ) : (
          <span className="text-slate-400 font-mono text-[11px]">-</span>
        );
      },
    },
    {
      id: "association",
      header: "TAGS",
      size: 170,
      cell: ({ row }) => {
        const task = row.original;
        const subName = getSubjectName(task.subjectId, subjects);
        return (
          <div className="flex flex-col gap-1 items-start max-w-[160px]">
            {task.category && (
              <span className={`text-[9px] px-2 py-0.5 font-bold uppercase rounded-md shadow-sm border border-slate-100/20 ${getCategoryBg(task.category)}`}>
                {task.category}
              </span>
            )}
            {subName ? (
              <span className="bg-indigo-50/70 text-indigo-950 border border-indigo-100/40 rounded-md px-2 py-0.5 font-sans font-bold text-[11px] shadow-sm truncate max-w-[150px]">
                📚 {subName}
              </span>
            ) : (
              <span className="text-slate-400 font-mono text-[10px] italic">No Subject</span>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      size: 90,
      cell: ({ row }) => {
        const task = row.original;
        return (
          <div className="flex items-center justify-center">
            <ActionMenuPortal
              items={[
                {
                  label: "View Details",
                  icon: <Eye className="w-3.5 h-3.5 text-indigo-500" />,
                  onClick: () => onViewDetails(task),
                },
                {
                  label: "Log Time",
                  icon: <Clock className="w-3.5 h-3.5 text-indigo-500" />,
                  onClick: () => onOpenTimeTracker(task),
                },
                {
                  label: "Edit",
                  icon: <Edit2 className="w-3.5 h-3.5 text-amber-500" />,
                  onClick: () => onOpenEditTask(task),
                },
                {
                  label: "Delete",
                  icon: <Trash className="w-3.5 h-3.5 text-rose-500" />,
                  onClick: () => onDeleteTask(task.id),
                  danger: true,
                },
              ]}
            />
          </div>
        );
      },
    },
  ], [
    tasks.length,
    subjects,
    onUpdateTask,
    onOpenTimeTracker,
    onOpenEditTask,
    onDeleteTask,
    onViewDetails,
  ]);

  return (
    <DataTable<Task>
      columns={columns}
      data={tasks}
      enablePagination={true}
      pageSize={itemsPerPage}
      currentPage={currentPage}
      onPageChange={onPageChange}
      paginationLabel="targets"
      containerClassName="border border-slate-100 rounded-2xl shadow-sm bg-white min-h-[220px] flex flex-col justify-between overflow-x-auto"
      tableClassName="w-full text-left border-collapse bg-white min-w-[800px]"
      theadClassName="font-mono text-[10px]"
      emptyState={
        <div className="p-12 text-center text-slate-400 font-mono italic">
          No matching tasks found. Refine your filter parameters or search term.
        </div>
      }
    />
  );
}
