import React, { useState } from "react";
import { Task, Subject } from "@/types";
import { IconChevronLeft as ChevronLeft, IconChevronRight as ChevronRight, IconCalendar as CalendarIcon, IconClock as Clock, IconEdit as Edit2, IconTrash as Trash, IconPlus as Plus, IconFileText as FileText, IconCircle2 as CheckCircle2 } from '@tabler/icons-react';
import { Tooltip } from "@components/ui";
import { getFormattedTaskId } from "@utils/index";

interface CalendarViewProps {
  tasks: Task[];
  subjects: Subject[];
  selectedDate: string;
  onDayClick: (dateStr: string) => void;
  onOpenTimeTracker: (task: Task) => void;
  onOpenEditTask: (task: Task) => void;
  onOpenAddTask: (dateStr: string) => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onDeleteTask: (taskId: string) => void;
  onViewTaskDetails?: (task: Task) => void;
}

export default function CalendarView({
  tasks,
  subjects,
  selectedDate,
  onDayClick,
  onOpenTimeTracker,
  onOpenEditTask,
  onOpenAddTask,
  onUpdateTask,
  onDeleteTask,
  onViewTaskDetails,
}: CalendarViewProps) {
  // We'll set the initial calendar month to July 2026
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(6); // July is index 6

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((prev) => prev - 1);
    } else {
      setCurrentMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((prev) => prev + 1);
    } else {
      setCurrentMonth((prev) => prev + 1);
    }
  };

  const getDayTasks = (day: number) => {
    const formattedDate = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return tasks.filter((t) => {
      if (t.date === formattedDate) return true;
      if (t.timeLogs && t.timeLogs.some((l) => l.loggedAt && l.loggedAt.startsWith(formattedDate))) return true;
      return false;
    });
  };

  const getDayLoggedMinutes = (day: number) => {
    const formattedDate = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayTasks = getDayTasks(day);
    let total = 0;
    for (const t of dayTasks) {
      if (t.timeLogs && t.timeLogs.length > 0) {
        let loggedForDay = 0;
        for (const log of t.timeLogs) {
          if (log.loggedAt && log.loggedAt.startsWith(formattedDate)) {
            loggedForDay += log.minutes || 0;
          }
        }
        if (loggedForDay > 0) {
          total += loggedForDay;
        } else if (t.date === formattedDate) {
          total += t.timeSpentMinutes || 0;
        }
      } else if (t.date === formattedDate) {
        total += t.timeSpentMinutes || 0;
      }
    }
    return total;
  };

  const getSubjectName = (subjectId?: string) => {
    if (!subjectId) return "";
    const sub = subjects.find((s) => s.id === subjectId);
    return sub ? sub.name : "";
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "High": return "bg-rose-50 text-rose-600 border border-rose-100";
      case "Medium": return "bg-amber-50 text-amber-600 border border-amber-100";
      default: return "bg-slate-50 text-slate-500 border border-slate-100";
    }
  };

  const renderCells = () => {
    const cells = [];

    // Fill preceding empty cells
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(<div key={`empty-${i}`} className="bg-slate-50/50 border border-slate-100/30 min-h-[125px] p-2.5 rounded-xl opacity-30"></div>);
    }

    // Fill days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isSelected = selectedDate === dateStr;
      
      // Determine if it is today dynamically
      const today = new Date();
      const isToday = currentYear === today.getFullYear() && currentMonth === today.getMonth() && day === today.getDate();

      // Determine if Sunday (revision day!)
      const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();
      const isSunday = dayOfWeek === 0;

      const dayTasks = getDayTasks(day);
      const totalMinutes = getDayLoggedMinutes(day);

      cells.push(
        <button
          key={day}
          type="button"
          onClick={() => onDayClick(dateStr)}
          className={`border min-h-[135px] lg:min-h-[145px] p-2.5 flex flex-col justify-between text-left transition-all duration-150 relative rounded-2xl group cursor-pointer ${
            isToday
              ? "bg-indigo-600 text-white font-extrabold shadow-md shadow-indigo-500/25 border-indigo-600 z-10 scale-[1.02]"
              : isSelected
              ? "bg-indigo-50 border-indigo-300 text-indigo-950 font-bold ring-2 ring-indigo-400/30"
              : isSunday
              ? "bg-rose-50/50 border-rose-100 hover:bg-rose-100/50 text-slate-800"
              : "bg-white border-slate-200/80 hover:bg-slate-50/80 text-slate-800 hover:border-slate-300"
          }`}
        >
          <div className="flex justify-between items-center w-full">
            <span className={`text-xs font-mono font-bold ${
              isToday 
                ? "bg-white text-indigo-700 px-2 py-0.5 rounded-md" 
                : "text-slate-700"
            }`}>
              {day}
            </span>
            {isToday && (
              <span className="text-[9px] font-extrabold bg-white text-indigo-700 px-1.5 py-0.5 rounded tracking-wider">
                TODAY
              </span>
            )}
            {isSunday && !isToday && (
              <span className="text-[9px] font-bold bg-rose-100/80 text-rose-700 px-1.5 py-0.5 rounded tracking-wider border border-rose-200/50">
                REV
              </span>
            )}
          </div>

          {/* Tasks and Time overview inside day cell */}
          <div className="space-y-1.5 w-full mt-2 flex-1 flex flex-col justify-end">
            {dayTasks.length > 0 && (
              <div className="flex flex-col gap-1 max-h-[64px] overflow-hidden">
                {dayTasks.slice(0, 2).map((t, idx) => {
                  const taskIdVal = getFormattedTaskId(t, idx);
                  return (
                    <div
                      key={t.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDayClick(dateStr);
                        if (onViewTaskDetails) onViewTaskDetails(t);
                      }}
                      className={`text-[9.5px] truncate font-semibold px-1.5 py-1 rounded-md leading-tight border cursor-pointer hover:underline ${
                        isToday
                          ? "bg-indigo-700/70 text-white border-indigo-400/40"
                          : t.status === "Completed"
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200/60"
                          : "bg-slate-50 text-slate-700 border-slate-200/80 hover:text-indigo-600"
                      }`}
                      title={`${taskIdVal}: ${t.title}`}
                    >
                      <span className="font-mono text-[8.5px] opacity-80 mr-1">{taskIdVal}:</span>
                      {t.status === "Completed" ? "✓ " : ""}
                      {t.title}
                    </div>
                  );
                })}
                {dayTasks.length > 2 && (
                  <div className={`text-[8.5px] font-mono font-bold ${isToday ? "text-indigo-200" : "text-slate-500"}`}>
                    +{dayTasks.length - 2} more targets
                  </div>
                )}
              </div>
            )}

            {totalMinutes > 0 && (
              <div className={`text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block w-max ${
                isToday 
                  ? "bg-indigo-500 text-white" 
                  : "bg-indigo-50 text-indigo-700 border border-indigo-100"
              }`}>
                ⏱️ {totalMinutes}m logged
              </div>
            )}
          </div>
        </button>
      );
    }

    return cells;
  };

  const selectedDateTasks = tasks.filter((t) => {
    if (t.date === selectedDate) return true;
    if (t.timeLogs && t.timeLogs.some((l) => l.loggedAt && l.loggedAt.startsWith(selectedDate))) return true;
    return false;
  });

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "Completed").length;

  return (
    <div className="bg-white border border-slate-100 p-5 md:p-6 shadow-sm rounded-3xl flex-1 flex flex-col">
      <div className="flex flex-col xl:flex-row gap-6 flex-1 items-stretch">
        
        {/* Left column: Calendar Grid */}
        <div className="flex-1 space-y-5 flex flex-col justify-between">
          {/* Calendar Header */}
          <div className="flex justify-end items-center gap-4 border-b border-slate-100 pb-4">
            {/* Month selector controls */}
            <div className="flex items-center gap-2 self-stretch sm:self-auto justify-between bg-slate-50 border border-slate-200/60 p-1.5 rounded-xl shadow-sm">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1.5 hover:bg-white active:scale-95 text-slate-600 hover:text-slate-900 rounded-lg transition-all cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-extrabold text-slate-700 text-xs px-2 font-mono uppercase tracking-wider">
                {monthNames[currentMonth]} {currentYear}
              </span>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1.5 hover:bg-white active:scale-95 text-slate-600 hover:text-slate-900 rounded-lg transition-all cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Stats Banner */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="bg-rose-50/60 border border-rose-100 p-2.5 rounded-xl text-center font-mono text-xs font-bold text-rose-700 flex items-center justify-center gap-1.5 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              Sundays = Revision
            </div>
            <div className="bg-indigo-50/60 border border-indigo-100 p-2.5 rounded-xl text-center font-mono text-xs font-bold text-indigo-700 flex items-center justify-center gap-1.5 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
              Highlighted = Today
            </div>
            <div className="bg-slate-50 border border-slate-200/60 p-2.5 rounded-xl text-center font-mono text-xs font-bold text-slate-600 flex items-center justify-center gap-1 shadow-sm">
              <span>⏱️</span>
              Minutes Logged
            </div>
            <div className="bg-emerald-50/80 border border-emerald-100 p-2.5 rounded-xl text-center font-mono text-xs font-bold text-emerald-800 flex items-center justify-center gap-1 shadow-sm">
              <span>🎯</span>
              Syllabus Done: {completedTasks}/{totalTasks} ({totalTasks > 0 ? Math.round((completedTasks/totalTasks)*100) : 0}%)
            </div>
          </div>

          {/* Week Day Labels */}
          <div className="grid grid-cols-7 gap-2 text-center font-bold text-xs uppercase font-mono tracking-wider text-slate-500">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, idx) => (
              <div
                key={day}
                className={`py-1.5 rounded-lg ${
                  idx === 0 ? "text-rose-600 bg-rose-50/50 font-extrabold border border-rose-100/50" : "text-slate-600 bg-slate-50 border border-slate-100"
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-2 flex-1">
            {renderCells()}
          </div>
        </div>

        {/* Right column: Side column loaded with tasks on selected date */}
        <div className="w-full xl:w-96 shrink-0 bg-slate-50/50 border border-slate-200/80 rounded-2xl p-4 md:p-5 flex flex-col gap-4 shadow-sm self-stretch h-auto min-h-[500px]">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3.5">
            <div>
              <h4 className="font-extrabold text-slate-800 text-xs sm:text-sm uppercase tracking-wide flex items-center gap-1.5">
                <CalendarIcon className="w-4 h-4 text-indigo-500" />
                Selected Date
              </h4>
              <p className="text-indigo-600 font-extrabold text-xs font-mono mt-0.5">
                {selectedDate}
              </p>
            </div>
            
            <button
              onClick={() => onOpenAddTask(selectedDate)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Target
            </button>
          </div>

          {/* Task List container - fills available vertical space to match calendar height */}
          <div className="flex-1 space-y-3 overflow-y-auto pr-0.5 scrollbar-thin">
            {selectedDateTasks.length === 0 ? (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center p-6 bg-white border border-slate-200/80 rounded-2xl shadow-sm">
                <FileText className="w-10 h-10 text-slate-300 mb-2" />
                <span className="font-extrabold text-sm text-slate-700 block">No Targets Scheduled</span>
                <span className="text-xs text-slate-400 mt-1 max-w-[200px] inline-block leading-relaxed">
                  Click 'Add Target' to plan study topics for this day.
                </span>
              </div>
            ) : (
              selectedDateTasks.map((task, idx) => {
                const isCompleted = task.status === "Completed";
                const displayTaskId = getFormattedTaskId(task, idx);
                
                const handleToggle = () => {
                  const nextStatus = isCompleted ? "Not Started" : "Completed";
                  const nextCol = nextStatus === "Completed" ? "completed" : "today";
                  onUpdateTask(task.id, { status: nextStatus, boardColumnId: nextCol });
                };

                return (
                  <div
                    key={task.id}
                    className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-sm hover:shadow-md transition-all flex flex-col gap-2.5 relative group"
                  >
                    {/* Header Row: Task ID badge */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-extrabold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100 shadow-sm">
                        {displayTaskId}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase ${getPriorityColor(task.priority)}`}>
                        {task.priority}
                      </span>
                    </div>

                    {/* Main Row: checkbox + title */}
                    <div className="flex gap-2.5 items-start">
                      <button
                        onClick={handleToggle}
                        className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center cursor-pointer active:scale-90 transition-all mt-0.5 ${
                          isCompleted
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "bg-white border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        {isCompleted && <span className="text-xs font-bold">✓</span>}
                      </button>
                      
                      <div className="flex-1 min-w-0">
                        <span
                          onClick={() => onViewTaskDetails && onViewTaskDetails(task)}
                          className={`text-xs font-bold text-slate-800 leading-snug block cursor-pointer hover:text-indigo-600 hover:underline transition-colors break-words [overflow-wrap:anywhere] ${
                            isCompleted ? "line-through text-slate-400" : ""
                          }`}
                        >
                          {task.title}
                        </span>
                        {task.subjectId && (
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50/80 px-2 py-0.5 rounded-md mt-1.5 inline-block border border-indigo-100/50">
                            📚 {getSubjectName(task.subjectId)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata tags */}
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className={`text-[9px] px-2 py-0.5 rounded-md font-bold uppercase bg-slate-100 text-slate-600 border border-slate-200/60`}>
                        {task.category}
                      </span>
                      {task.timeSpentMinutes > 0 && (
                        <span className="text-[9.5px] font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-100/60">
                          ⏱️ {task.timeSpentMinutes}m studied
                        </span>
                      )}
                    </div>

                    {/* Actions Row */}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 mt-0.5">
                      <button
                        onClick={() => onOpenTimeTracker(task)}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-mono font-bold px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 transition-all cursor-pointer flex items-center gap-1"
                      >
                        ⏱️ Log Time
                      </button>

                      <div className="flex items-center gap-1">
                        <Tooltip content="Edit Task" position="top">
                          <button
                            onClick={() => onOpenEditTask(task)}
                            className="p-1.5 hover:bg-amber-50 hover:text-amber-700 rounded-lg transition-all cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-600" />
                          </button>
                        </Tooltip>
                        <Tooltip content="Delete Target" position="top">
                          <button
                            onClick={() => onDeleteTask(task.id)}
                            className="p-1.5 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-all cursor-pointer"
                          >
                            <Trash className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-500" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
