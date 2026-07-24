import React, { useState, useEffect } from "react";
import {
  IconPlus as Plus,
  IconTrash as Trash,
  IconEdit as Edit2,
  IconPencil as Pencil,
  IconCheck as Check,
  IconCalendar as CalendarIcon,
  IconTag as Tag,
  IconNote as StickyNote,
  IconBook as BookOpen,
  IconFilter as Filter,
  IconStar as Star,
  IconX as X,
  IconSparkles as Sparkles,
  IconFlame as Flame,
  IconLayoutGrid as LayoutGrid,
  IconGridDots as GridDots,
} from "@tabler/icons-react";
import { Task, Subject, ReminderNote, StudyNote } from "@/types";
import { toast } from "@utils/index";
import {
  getUserReminders,
  saveUserReminder,
  deleteUserReminder,
  getUserStudyNotes,
  saveUserStudyNote,
  deleteUserStudyNote,
} from "@/db";

const isBlackOrDarkHex = (color: string) => {
  if (!color) return false;
  const c = color.trim().toLowerCase().replace("#", "");
  if (c === "000000" || c === "000" || c === "black" || c === "00000000") return true;
  if (c.length === 6) {
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      if (brightness < 60) return true;
    }
  }
  return false;
};

interface NotesViewProps {
  tasks: Task[];
  subjects: Subject[];
  activeDashboardId: string;
  user?: any;
  reminders?: ReminderNote[];
  onToggleReminder?: (id: string) => void;
  onDeleteReminder?: (id: string) => void;
  onSaveReminder?: (rem: ReminderNote) => void;
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => void;
}

const PASTEL_COLORS = [
  { name: "Warm Orange", hex: "#fed7aa", border: "#f97316" },
  { name: "Lime Green", hex: "#d9f99d", border: "#84cc16" },
  { name: "Lavender", hex: "#ddd6fe", border: "#8b5cf6" },
  { name: "Sky Blue", hex: "#bae6fd", border: "#0284c7" },
  { name: "Mint Fresh", hex: "#a7f3d0", border: "#10b981" },
  { name: "Soft Coral", hex: "#fecdd3", border: "#f43f5e" },
  { name: "Canary Yellow", hex: "#fef08a", border: "#eab308" },
  { name: "Plum Pink", hex: "#f5d0fe", border: "#d946ef" },
];

export const NotesView: React.FC<NotesViewProps> = ({
  tasks,
  subjects,
  activeDashboardId,
  user,
  reminders: propsReminders,
  onToggleReminder: propsOnToggleReminder,
  onDeleteReminder: propsOnDeleteReminder,
  onSaveReminder: propsOnSaveReminder,
  onUpdateTask,
}) => {
  const [filterType, setFilterType] = useState<"all" | "reminders" | "study">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [gridCols, setGridCols] = useState<"3" | "4" | "5">("3");

  const [reminders, setReminders] = useState<ReminderNote[]>(propsReminders || []);
  const [customStudyNotes, setCustomStudyNotes] = useState<StudyNote[]>([]);
  const [loading, setLoading] = useState(true);

  // Deleted note IDs state (persisted locally per dashboard so deleted task/log notes stay removed)
  const [deletedNoteIds, setDeletedNoteIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`deleted_notes_${activeDashboardId}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const markNoteAsDeleted = (id: string) => {
    setDeletedNoteIds((prev) => {
      const updated = Array.from(new Set([...prev, id]));
      try {
        localStorage.setItem(`deleted_notes_${activeDashboardId}`, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // Sync propsReminders into local reminders state if provided
  useEffect(() => {
    if (propsReminders) {
      setReminders(propsReminders);
    }
  }, [propsReminders]);

  // Delete Confirmation Modal State
  const [deleteConfirmNote, setDeleteConfirmNote] = useState<{
    id: string;
    type: "reminder" | "study";
    title: string;
  } | null>(null);

  // Add Reminder Modal
  const [showAddReminderModal, setShowAddReminderModal] = useState(false);
  const [newReminderTitle, setNewReminderTitle] = useState("");
  const [newReminderDate, setNewReminderDate] = useState(new Date().toISOString().split("T")[0]);
  const [newReminderIsImportant, setNewReminderIsImportant] = useState(false);

  // Add Custom Study Note Modal
  const [showAddStudyNoteModal, setShowAddStudyNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [newNoteColor, setNewNoteColor] = useState("#fed7aa");
  const [newNoteSubjectId, setNewNoteSubjectId] = useState("");
  const [newNoteTags, setNewNoteTags] = useState("");
  const [newNoteIsImportant, setNewNoteIsImportant] = useState(false);

  // Edit Reminder Modal
  const [editingReminder, setEditingReminder] = useState<ReminderNote | null>(null);
  const [editReminderTitle, setEditReminderTitle] = useState("");
  const [editReminderDate, setEditReminderDate] = useState("");
  const [editReminderIsImportant, setEditReminderIsImportant] = useState(false);

  // Edit Study Note Modal
  const [editingStudyNote, setEditingStudyNote] = useState<StudyNote | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  const [editNoteColor, setEditNoteColor] = useState("#fed7aa");
  const [editNoteTags, setEditNoteTags] = useState("");
  const [editNoteIsImportant, setEditNoteIsImportant] = useState(false);

  const userId = user?.id;

  // Load reminders & study notes from DB or initialize default ones
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        if (!propsReminders) {
          const fetchedReminders = await getUserReminders(userId, activeDashboardId);
          if (fetchedReminders.length > 0) {
            setReminders(fetchedReminders);
          } else {
            // Default initial reminders
            const todayStr = new Date().toISOString().split("T")[0];
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 10);
            const overdue10Days = yesterday.toISOString().split("T")[0];

            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split("T")[0];

            const initialReminders: ReminderNote[] = [
              {
                id: "rem_1",
                dashboardId: activeDashboardId,
                title: "Revise Graph Algorithms & Shortest Path Formulas",
                date: todayStr,
                completed: false,
                color: "#fef08a",
                isImportant: true,
                createdAt: new Date().toISOString(),
              },
              {
                id: "rem_2",
                dashboardId: activeDashboardId,
                title: "Submit Machine Learning Assignment #3",
                date: overdue10Days,
                completed: false,
                color: "#fef08a",
                isImportant: true,
                createdAt: new Date().toISOString(),
              },
              {
                id: "rem_3",
                dashboardId: activeDashboardId,
                title: "Prepare notes for Database Normalization & 3NF",
                date: tomorrowStr,
                completed: false,
                color: "#fef08a",
                isImportant: false,
                createdAt: new Date().toISOString(),
              },
            ];

            setReminders(initialReminders);
            for (const rem of initialReminders) {
              await saveUserReminder(userId, rem);
            }
          }
        }

        const fetchedStudyNotes = await getUserStudyNotes(userId, activeDashboardId);
        setCustomStudyNotes(fetchedStudyNotes);
      } catch (err) {
        console.warn("Failed to load notes data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [userId, activeDashboardId, propsReminders]);

  // Aggregate all study notes from tasks time logs, task notes, and custom study notes
  const aggregatedStudyNotes: StudyNote[] = [];

  // 1. From Task Time Logs & Task Notes
  tasks.forEach((t) => {
    const subj = subjects.find((s) => s.id === t.subjectId);
    const subjName = subj ? subj.name : t.category || "General";
    const taskIdDisplay = t.taskId || t.taskid || t.id.substring(0, 7);

    // Task level notes if non-empty
    if (t.notes && t.notes.trim()) {
      aggregatedStudyNotes.push({
        id: `task_note_${t.id}`,
        dashboardId: activeDashboardId,
        taskId: taskIdDisplay,
        taskTitle: t.title,
        subjectId: t.subjectId,
        subjectName: subjName,
        note: t.notes,
        color: "#fed7aa", // Default warm orange pastel
        createdAt: t.date,
      });
    }

    // Task time logs notes
    (t.timeLogs || []).forEach((log) => {
      if (log.note && log.note.trim() && log.note !== "Logged active study session.") {
        aggregatedStudyNotes.push({
          id: `log_note_${log.id}`,
          dashboardId: activeDashboardId,
          taskId: taskIdDisplay,
          taskTitle: t.title,
          subjectId: t.subjectId,
          subjectName: subjName,
          note: log.note,
          color: "#d9f99d", // Default lime green pastel
          createdAt: log.loggedAt,
        });
      }
    });
  });

  // Merge with custom edited/created study notes (custom overrides or adds)
  const allStudyNotesMap = new Map<string, StudyNote>();
  aggregatedStudyNotes.forEach((note) => allStudyNotesMap.set(note.id, note));
  customStudyNotes.forEach((note) => allStudyNotesMap.set(note.id, note));
  const finalStudyNotes = Array.from(allStudyNotesMap.values());

  // Date badge helper function for reminders
  const getRelativeDateBadge = (dateStr: string) => {
    if (!dateStr) return { text: "Planned", color: "bg-slate-100 text-slate-700 border-slate-200" };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(dateStr + "T00:00:00");
    target.setHours(0, 0, 0, 0);

    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return { text: "Planned For Today", color: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    } else if (diffDays === 1) {
      return { text: "Tomorrow", color: "bg-purple-50 text-purple-700 border-purple-200" };
    } else if (diffDays < 0) {
      const positiveDays = Math.abs(diffDays);
      return { text: `Overdue by ${positiveDays} day${positiveDays > 1 ? "s" : ""}`, color: "bg-rose-50 text-rose-700 border-rose-200 font-bold" };
    } else {
      return { text: `Upcoming (${dateStr})`, color: "bg-amber-50 text-amber-800 border-amber-200" };
    }
  };

  // Date formatter for portal standard view (e.g. July 23, 2026)
  const formatPortalDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    } catch (e) {
      return dateStr;
    }
  };

  // Add new Reminder Note handler
  const handleCreateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReminderTitle.trim()) return;

    const newRem: ReminderNote = {
      id: "rem_" + Date.now(),
      dashboardId: activeDashboardId,
      title: newReminderTitle.trim(),
      date: newReminderDate,
      completed: false,
      color: "#fef08a",
      isImportant: newReminderIsImportant,
      createdAt: new Date().toISOString(),
    };

    if (propsOnSaveReminder) {
      propsOnSaveReminder(newRem);
    } else {
      setReminders((prev) => [newRem, ...prev]);
      await saveUserReminder(userId, newRem);
    }
    toast.success("Reminder note added!");
    setNewReminderTitle("");
    setNewReminderIsImportant(false);
    setShowAddReminderModal(false);
  };

  // Add new Custom Study Note handler
  const handleCreateStudyNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;

    if (isBlackOrDarkHex(newNoteColor)) {
      toast.error("Black (#000000) and dark background colors are disabled to ensure note text stays readable.");
      return;
    }

    const subj = subjects.find((s) => s.id === newNoteSubjectId);
    const tagsArray = newNoteTags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const newNote: StudyNote = {
      id: "study_" + Date.now(),
      dashboardId: activeDashboardId,
      note: newNoteText.trim(),
      color: newNoteColor,
      subjectId: newNoteSubjectId || undefined,
      subjectName: subj ? subj.name : undefined,
      tags: tagsArray,
      isImportant: newNoteIsImportant,
      createdAt: new Date().toISOString(),
    };

    setCustomStudyNotes((prev) => [newNote, ...prev]);
    await saveUserStudyNote(userId, newNote);
    toast.success("Study note created!");
    setNewNoteText("");
    setNewNoteTags("");
    setNewNoteIsImportant(false);
    setShowAddStudyNoteModal(false);
  };

  // Toggle Reminder completion
  const handleToggleReminder = async (id: string) => {
    if (propsOnToggleReminder) {
      propsOnToggleReminder(id);
    } else {
      const updated = reminders.map((r) =>
        r.id === id ? { ...r, completed: !r.completed } : r
      );
      setReminders(updated);
      const target = updated.find((r) => r.id === id);
      if (target) {
        await saveUserReminder(userId, target);
        toast.success(target.completed ? "Marked as done!" : "Marked as pending");
      }
    }
  };

  // Toggle Reminder Important status directly
  const handleToggleImportantReminder = async (rem: ReminderNote) => {
    const updated: ReminderNote = { ...rem, isImportant: !rem.isImportant };
    if (propsOnSaveReminder) {
      propsOnSaveReminder(updated);
    } else {
      setReminders((prev) => prev.map((r) => (r.id === rem.id ? updated : r)));
      await saveUserReminder(userId, updated);
    }
    toast.success(updated.isImportant ? "Marked note as Important 🔥" : "Removed Important tag");
  };

  // Prompt Confirmation before Delete
  const promptDeleteReminder = (rem: ReminderNote) => {
    setDeleteConfirmNote({
      id: rem.id,
      type: "reminder",
      title: rem.title,
    });
  };

  const promptDeleteStudyNote = (note: StudyNote) => {
    setDeleteConfirmNote({
      id: note.id,
      type: "study",
      title: note.note,
    });
  };

  // Confirm and Execute Instant Deletion
  const handleConfirmDelete = async () => {
    if (!deleteConfirmNote) return;
    const { id, type } = deleteConfirmNote;

    // Immediately mark as deleted locally so it instantly disappears from UI without refresh
    markNoteAsDeleted(id);

    if (type === "reminder") {
      setReminders((prev) => prev.filter((r) => r.id !== id));
      if (propsOnDeleteReminder) {
        propsOnDeleteReminder(id);
      } else {
        await deleteUserReminder(userId, id);
      }
      toast.success("Reminder note deleted.");
    } else {
      const noteObj = finalStudyNotes.find((n) => n.id === id);

      if (onUpdateTask) {
        if (id.startsWith("task_note_")) {
          const rawTaskId = id.replace("task_note_", "");
          const matchedTask = tasks.find((t) => t.id === rawTaskId || t.taskId === rawTaskId);
          if (matchedTask) {
            onUpdateTask(matchedTask.id, { notes: "", description: "" });
          }
        } else if (id.startsWith("log_note_")) {
          const rawLogId = id.replace("log_note_", "");
          const matchedTask = tasks.find((t) => (t.timeLogs || []).some((l) => l.id === rawLogId));
          if (matchedTask) {
            const updatedLogs = (matchedTask.timeLogs || []).map((l) =>
              l.id === rawLogId ? { ...l, note: "" } : l
            );
            onUpdateTask(matchedTask.id, { timeLogs: updatedLogs });
          }
        } else if (noteObj) {
          const matchedTask = tasks.find(
            (t) =>
              (noteObj.taskId && (t.taskId === noteObj.taskId || t.id === noteObj.taskId)) ||
              (t.notes && t.notes.trim() === noteObj.note.trim())
          );
          if (matchedTask) {
            onUpdateTask(matchedTask.id, { notes: "", description: "" });
          }
        }
      }

      setCustomStudyNotes((prev) => prev.filter((n) => n.id !== id));
      await deleteUserStudyNote(userId, id);
      toast.success("Study note deleted.");
    }

    setDeleteConfirmNote(null);
  };

  // Open Edit Modal for Reminder Note
  const handleOpenEditReminder = (rem: ReminderNote) => {
    setEditingReminder(rem);
    setEditReminderTitle(rem.title);
    setEditReminderDate(rem.date);
    setEditReminderIsImportant(!!rem.isImportant);
  };

  // Save Edited Reminder Note
  const handleSaveEditedReminder = async () => {
    if (!editingReminder) return;
    const updated: ReminderNote = {
      ...editingReminder,
      title: editReminderTitle.trim(),
      date: editReminderDate,
      isImportant: editReminderIsImportant,
    };

    if (propsOnSaveReminder) {
      propsOnSaveReminder(updated);
    } else {
      setReminders((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      await saveUserReminder(userId, updated);
    }
    toast.success("Reminder note updated!");
    setEditingReminder(null);
  };

  // Open Edit Modal for Study Note
  const handleOpenEditStudyNote = (note: StudyNote) => {
    setEditingStudyNote(note);
    setEditNoteText(note.note);
    setEditNoteColor(note.color || "#fed7aa");
    setEditNoteTags((note.tags || []).join(", "));
    setEditNoteIsImportant(!!note.isImportant);
  };

  // Save Edited Study Note
  const handleSaveStudyNote = async () => {
    if (!editingStudyNote) return;

    if (isBlackOrDarkHex(editNoteColor)) {
      toast.error("Black (#000000) and dark background colors are disabled to ensure note text stays readable.");
      return;
    }

    const tagsArray = editNoteTags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const updatedNote: StudyNote = {
      ...editingStudyNote,
      note: editNoteText,
      color: editNoteColor,
      tags: tagsArray,
      isImportant: editNoteIsImportant,
    };

    if (onUpdateTask) {
      if (editingStudyNote.id.startsWith("task_note_")) {
        const rawTaskId = editingStudyNote.id.replace("task_note_", "");
        const matchedTask = tasks.find((t) => t.id === rawTaskId || t.taskId === rawTaskId);
        if (matchedTask) {
          onUpdateTask(matchedTask.id, { notes: editNoteText, description: editNoteText });
        }
      } else if (editingStudyNote.taskId) {
        const matchedTask = tasks.find((t) => t.taskId === editingStudyNote.taskId || t.id === editingStudyNote.taskId);
        if (matchedTask) {
          onUpdateTask(matchedTask.id, { notes: editNoteText, description: editNoteText });
        }
      }
    }

    setCustomStudyNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === updatedNote.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updatedNote;
        return copy;
      }
      return [...prev, updatedNote];
    });

    await saveUserStudyNote(userId, updatedNote);
    toast.success("Study note updated!");
    setEditingStudyNote(null);
  };

  // Toggle Important on Study Note directly
  const handleToggleImportantStudyNote = async (note: StudyNote) => {
    const updated = { ...note, isImportant: !note.isImportant };
    setCustomStudyNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === updated.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updated;
        return copy;
      }
      return [...prev, updated];
    });
    await saveUserStudyNote(userId, updated);
    toast.success(updated.isImportant ? "Marked study note as Important 🔥" : "Removed Important tag");
  };

  // Toggle Favorite on Study Note
  const handleToggleFavoriteStudyNote = async (note: StudyNote) => {
    const updated = { ...note, isFavorite: !note.isFavorite };
    setCustomStudyNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === updated.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updated;
        return copy;
      }
      return [...prev, updated];
    });
    await saveUserStudyNote(userId, updated);
  };

  // Filtered lists (excluding any deletedNoteIds)
  const filteredReminders = reminders.filter(
    (r) =>
      !deletedNoteIds.includes(r.id) &&
      r.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredStudyNotes = finalStudyNotes.filter(
    (n) =>
      !deletedNoteIds.includes(n.id) &&
      (n.note.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (n.subjectName && n.subjectName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (n.taskId && n.taskId.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  // Dynamic Grid classes based on 3, 4, or 5 cards per row
  const gridContainerClass =
    gridCols === "5"
      ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
      : gridCols === "4"
      ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
      : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5";

  // Card size constraint (3 per row: Standard 250px, 4 per row: Compact 200px, 5 per row: Mini 150px)
  const cardSizeClass =
    gridCols === "5"
      ? "w-full min-h-[150px] p-3 flex flex-col justify-between"
      : gridCols === "4"
      ? "w-full min-h-[200px] p-4 flex flex-col justify-between"
      : "w-full min-h-[250px] p-5 flex flex-col justify-between";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header & New Note Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-[24px] border border-slate-100 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <StickyNote className="w-7 h-7 text-amber-500" />
            Notes & Sticky Post-Its
          </h1>
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
            Organize sticky reminder notes and colorful study cards with authentic Kalam handwriting font (16px/24px).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => {
              setNewReminderIsImportant(false);
              setShowAddReminderModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md shadow-amber-500/20 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Reminder Note
          </button>

          <button
            onClick={() => {
              setNewNoteIsImportant(false);
              setShowAddStudyNoteModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-600/20 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Study Note
          </button>
        </div>
      </div>

      {/* Filter Tabs, Search & Grid Density Selector */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        {/* Filter Pills */}
        <div className="flex items-center gap-2 p-1 bg-slate-100/80 dark:bg-slate-800/80 rounded-xl w-fit border border-slate-200/60 dark:border-slate-700/60">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              filterType === "all"
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            All Notes ({filteredReminders.length + filteredStudyNotes.length})
          </button>
          <button
            onClick={() => setFilterType("reminders")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              filterType === "reminders"
                ? "bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 shadow-xs"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <span>📌 Reminders</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 bg-amber-200/60 dark:bg-amber-800/60 rounded-full font-bold">
              {filteredReminders.length}
            </span>
          </button>
          <button
            onClick={() => setFilterType("study")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              filterType === "study"
                ? "bg-indigo-100 dark:bg-indigo-950/80 text-indigo-900 dark:text-indigo-200 shadow-xs"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <span>📚 Study Notes</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 bg-indigo-200/60 dark:bg-indigo-800/60 rounded-full font-bold">
              {filteredStudyNotes.length}
            </span>
          </button>
        </div>

        {/* Right side controls: Grid size toggle + Search input */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Grid Layout Density Selector (3 clean icons, no text labels or tooltips) */}
          <div className="flex items-center gap-1 bg-slate-100/90 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setGridCols("3")}
              aria-label="3 columns"
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                gridCols === "3"
                  ? "bg-amber-500 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setGridCols("4")}
              aria-label="4 columns"
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                gridCols === "4"
                  ? "bg-amber-500 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700"
              }`}
            >
              <GridDots className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setGridCols("5")}
              aria-label="5 columns"
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                gridCols === "5"
                  ? "bg-amber-500 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700"
              }`}
            >
              <GridDots className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search input */}
          <div className="relative w-full sm:w-60">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes or task IDs..."
              className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
            <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
        </div>
      </div>

      {/* Main Grid View */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs font-mono text-slate-400 mt-3">Loading notes repository...</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* SECTION 1: Reminder Notes (Sticky Yellow Post-It Style) */}
          {(filterType === "all" || filterType === "reminders") && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800 pb-2">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                  Sticky Reminder Notes ({filteredReminders.length})
                </h2>
                <span className="text-[10px] font-mono text-slate-400">
                  Yellow post-it reminders ({gridCols} per row)
                </span>
              </div>

              {filteredReminders.length === 0 ? (
                <div className="p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center bg-slate-50/50 dark:bg-slate-900/50">
                  <p className="text-xs font-mono text-slate-400">No reminder notes found.</p>
                  <button
                    onClick={() => setShowAddReminderModal(true)}
                    className="mt-3 text-xs font-bold text-amber-600 hover:underline cursor-pointer"
                  >
                    + Add sticky reminder
                  </button>
                </div>
              ) : (
                <div className={gridContainerClass}>
                  {filteredReminders.map((rem) => {
                    const badge = getRelativeDateBadge(rem.date);
                    return (
                      <div
                        key={rem.id}
                        className={`group relative rounded-2xl border transition-all duration-200 shadow-sm hover:shadow-md ${cardSizeClass} ${
                          rem.completed
                            ? "bg-slate-100 border-slate-200 opacity-75"
                            : rem.isImportant
                            ? "bg-[#fef08a] border-rose-400 ring-2 ring-rose-400/50 hover:-translate-y-0.5"
                            : "bg-[#fef08a] border-[#fde047] hover:-translate-y-0.5"
                        }`}
                        style={{
                          boxShadow: rem.completed
                            ? "none"
                            : rem.isImportant
                            ? "0 4px 20px -2px rgba(244, 63, 94, 0.35)"
                            : "0 4px 20px -2px rgba(250, 204, 21, 0.25)",
                        }}
                      >
                        {/* Top Action & Badge Row */}
                        <div className="flex items-start justify-between gap-1.5 shrink-0">
                          <div className="flex flex-wrap items-center gap-1 min-w-0">
                            {rem.isImportant && (
                              <span className="px-2 py-0.5 text-[9px] font-mono font-extrabold uppercase bg-rose-600 text-white rounded-md shadow-2xs flex items-center gap-0.5 shrink-0">
                                <Flame className="w-2.5 h-2.5 fill-white text-white" />
                                Important
                              </span>
                            )}
                            <span
                              className={`text-[9px] font-mono px-2 py-0.5 rounded-full border font-bold truncate max-w-[120px] ${badge.color}`}
                            >
                              {badge.text}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-all shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleImportantReminder(rem)}
                              title={rem.isImportant ? "Remove Important" : "Mark as Important"}
                              className={`p-1 rounded-lg border transition-all cursor-pointer hover:scale-105 ${
                                rem.isImportant
                                  ? "bg-rose-500 text-white border-rose-600 shadow-xs"
                                  : "bg-white/90 text-slate-600 hover:text-rose-600 hover:bg-rose-50 border-black/10"
                              }`}
                            >
                              <Flame className={`w-3 h-3 ${rem.isImportant ? "fill-white text-white" : ""}`} />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenEditReminder(rem)}
                              title="Edit Note"
                              className="p-1 bg-white/90 hover:bg-amber-100 text-slate-700 hover:text-amber-900 border border-black/10 rounded-lg shadow-2xs transition-all cursor-pointer hover:scale-105"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>

                            <button
                              type="button"
                              onClick={() => promptDeleteReminder(rem)}
                              title="Delete Note"
                              className="p-1 bg-white/90 hover:bg-rose-100 text-slate-700 hover:text-rose-700 border border-black/10 rounded-lg shadow-2xs transition-all cursor-pointer hover:scale-105"
                            >
                              <Trash className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Note Content with Kalam Handwritten Font (16px/24px) */}
                        <div className="my-1.5 overflow-y-auto flex-1 flex items-center min-h-0">
                          <p
                            className={`kalam-regular !text-slate-900 whitespace-pre-wrap break-words w-full ${
                              rem.completed ? "line-through opacity-60" : ""
                            }`}
                          >
                            {rem.title}
                          </p>
                        </div>

                        {/* Bottom Row: Date + Toggle checkbox */}
                        <div className="pt-1.5 border-t border-black/10 flex items-center justify-between text-[9px] font-mono !text-slate-800 shrink-0">
                          <span className="flex items-center gap-1 font-bold truncate">
                            <CalendarIcon className="w-3 h-3 text-amber-800 shrink-0" />
                            {formatPortalDate(rem.date)}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleToggleReminder(rem.id)}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-all cursor-pointer shrink-0 ${
                              rem.completed
                                ? "bg-emerald-100 !text-emerald-900"
                                : "bg-black/5 hover:bg-black/10 !text-slate-900"
                            }`}
                          >
                            <Check className="w-3 h-3" />
                            {rem.completed ? "Done" : "Mark"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SECTION 2: Study Notes (Task & Time Log Notes - Colorful Sticky Cards) */}
          {(filterType === "all" || filterType === "study") && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800 pb-2">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                  Colorful Task Study Notes ({filteredStudyNotes.length})
                </h2>
                <span className="text-[10px] font-mono text-slate-400">
                  Notes logged during study sessions ({gridCols} per row)
                </span>
              </div>

              {filteredStudyNotes.length === 0 ? (
                <div className="p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center bg-slate-50/50 dark:bg-slate-900/50">
                  <p className="text-xs font-mono text-slate-400">
                    No task study notes recorded yet.
                  </p>
                  <button
                    onClick={() => setShowAddStudyNoteModal(true)}
                    className="mt-3 text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
                  >
                    + Add a study note card
                  </button>
                </div>
              ) : (
                <div className={gridContainerClass}>
                  {filteredStudyNotes.map((note) => {
                    const cardBg = note.color || "#fed7aa";
                    const cleanTaskId = note.taskId ? note.taskId.replace(/^#/, "") : "";
                    return (
                      <div
                        key={note.id}
                        className={`group relative rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${cardSizeClass} ${
                          note.isImportant ? "border-rose-400 ring-2 ring-rose-400/50" : "border-black/10"
                        }`}
                        style={{
                          backgroundColor: cardBg,
                          boxShadow: note.isImportant
                            ? "0 4px 20px -2px rgba(244, 63, 94, 0.25)"
                            : "0 4px 20px -2px rgba(0,0,0,0.06)",
                        }}
                      >
                        {/* Top Badges Row */}
                        <div className="flex items-start justify-between gap-1.5 shrink-0">
                          <div className="flex flex-wrap items-center gap-1 min-w-0">
                            {note.isImportant && (
                              <span className="px-1.5 py-0.5 text-[9px] font-mono font-extrabold uppercase bg-rose-600 text-white rounded-md shadow-2xs flex items-center gap-0.5 shrink-0">
                                <Flame className="w-2.5 h-2.5 fill-white text-white" />
                                Important
                              </span>
                            )}
                            {cleanTaskId && (
                              <span className="px-1.5 py-0.5 text-[9px] font-mono font-extrabold uppercase bg-slate-900/80 text-white rounded-md shadow-2xs truncate">
                                {cleanTaskId}
                              </span>
                            )}
                            {note.subjectName && gridCols !== "5" && (
                              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-white/80 !text-slate-900 rounded-md border border-black/5 shadow-2xs truncate max-w-[90px]">
                                {note.subjectName}
                              </span>
                            )}
                          </div>

                          {/* Top Right Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleImportantStudyNote(note)}
                              title={note.isImportant ? "Remove Important" : "Mark as Important"}
                              className={`p-1 rounded-lg border transition-all cursor-pointer hover:scale-105 ${
                                note.isImportant
                                  ? "bg-rose-500 text-white border-rose-600 shadow-xs"
                                  : "bg-white/80 text-slate-600 hover:text-rose-600 hover:bg-rose-50 border-black/10"
                              }`}
                            >
                              <Flame className={`w-3 h-3 ${note.isImportant ? "fill-white text-white" : ""}`} />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleFavoriteStudyNote(note)}
                              className={`p-1 rounded-lg transition-all cursor-pointer ${
                                note.isFavorite
                                  ? "text-amber-600 bg-amber-100/90"
                                  : "!text-slate-700 hover:bg-black/5"
                              }`}
                              title={note.isFavorite ? "Favorited" : "Mark Favorite"}
                            >
                              <Star
                                className={`w-3 h-3 ${
                                  note.isFavorite ? "fill-amber-500" : ""
                                }`}
                              />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenEditStudyNote(note)}
                              title="Edit Note"
                              className="p-1 bg-white/90 hover:bg-amber-100 text-slate-700 hover:text-amber-900 border border-black/10 rounded-lg shadow-2xs transition-all cursor-pointer hover:scale-105"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>

                            <button
                              type="button"
                              onClick={() => promptDeleteStudyNote(note)}
                              title="Delete Note"
                              className="p-1 bg-white/90 hover:bg-rose-100 text-slate-700 hover:text-rose-700 border border-black/10 rounded-lg shadow-2xs transition-all cursor-pointer hover:scale-105"
                            >
                              <Trash className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Note Body Text with Kalam Handwritten Font (16px/24px) */}
                        <div className="my-1.5 overflow-y-auto flex-1 flex items-center min-h-0">
                          <p className="kalam-regular !text-slate-900 whitespace-pre-wrap break-words w-full">
                            "{note.note}"
                          </p>
                        </div>

                        {/* Bottom Tags */}
                        <div className="pt-1.5 border-t border-black/10 flex items-center justify-between shrink-0">
                          <div className="flex flex-wrap items-center gap-1">
                            {(note.tags || []).map((t, idx) => (
                              <span
                                key={idx}
                                className="text-[8px] font-mono font-bold !text-slate-800 bg-black/10 px-1.5 py-0.2 rounded-md truncate max-w-[80px]"
                              >
                                {t.replace(/^#/, "")}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MODAL: Delete Confirmation */}
      {deleteConfirmNote && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 bg-rose-100 dark:bg-rose-950/50 rounded-2xl">
                <Trash className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Delete Note?</h3>
                <p className="text-[11px] font-mono text-slate-500">Action cannot be undone</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700 font-medium line-clamp-3">
              "{deleteConfirmNote.title}"
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmNote(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Trash className="w-3.5 h-3.5" />
                Delete Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add New Reminder Note */}
      {showAddReminderModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-amber-500" />
                Add Sticky Reminder Note
              </h3>
              <button
                onClick={() => setShowAddReminderModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateReminder} className="space-y-4">
              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1">
                  Reminder Content / Title
                </label>
                <textarea
                  value={newReminderTitle}
                  onChange={(e) => setNewReminderTitle(e.target.value)}
                  placeholder="e.g. Revise Computer Networks Socket Programming formulas"
                  rows={3}
                  required
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 kalam-regular !text-slate-900 dark:!text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                ></textarea>
              </div>

              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1">
                  Target / Scheduled Date
                </label>
                <input
                  type="date"
                  value={newReminderDate}
                  onChange={(e) => setNewReminderDate(e.target.value)}
                  required
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              {/* Tag as Important Option */}
              <div className="p-3 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-rose-600 fill-rose-500" />
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100 block">Mark as Important</span>
                    <span className="text-[10px] font-mono text-slate-500">
                      Shows prominent red tag on sticky note
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={newReminderIsImportant}
                  onChange={(e) => setNewReminderIsImportant(e.target.checked)}
                  className="w-4 h-4 accent-rose-600 rounded cursor-pointer"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddReminderModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
                >
                  Create Sticky Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add Custom Study Note */}
      {showAddStudyNoteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-500" />
                Add Custom Study Note
              </h3>
              <button
                onClick={() => setShowAddStudyNoteModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateStudyNote} className="space-y-4">
              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1">
                  Note Content
                </label>
                <textarea
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  placeholder="e.g. Proof for Dijkstra's shortest path time complexity using min-heap"
                  rows={4}
                  required
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 kalam-regular !text-slate-900 dark:!text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                ></textarea>
              </div>

              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1">
                  Subject (Optional)
                </label>
                <select
                  value={newNoteSubjectId}
                  onChange={(e) => setNewNoteSubjectId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">-- General / No Subject --</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Color Selection */}
              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1.5">
                  Card Background Color
                </label>
                <div className="flex items-center gap-2">
                  {PASTEL_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setNewNoteColor(c.hex)}
                      className={`w-6 h-6 rounded-full border transition-transform hover:scale-125 cursor-pointer ${
                        newNoteColor.toLowerCase() === c.hex.toLowerCase() ? "ring-2 ring-slate-900 ring-offset-1 scale-110" : "border-black/10"
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1">
                  Custom Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={newNoteTags}
                  onChange={(e) => setNewNoteTags(e.target.value)}
                  placeholder="e.g. algorithms, graphs, midterm"
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              {/* Tag as Important Option */}
              <div className="p-3 bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800/60 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-rose-600 fill-rose-500" />
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100 block">Mark as Important</span>
                    <span className="text-[10px] font-mono text-slate-500">
                      Shows red tag on study note
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={newNoteIsImportant}
                  onChange={(e) => setNewNoteIsImportant(e.target.checked)}
                  className="w-4 h-4 accent-rose-600 rounded cursor-pointer"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddStudyNoteModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
                >
                  Create Study Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Edit Reminder Note */}
      {editingReminder && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Pencil className="w-4 h-4 text-amber-500" />
                Edit Sticky Reminder Note
              </h3>
              <button
                onClick={() => setEditingReminder(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1">
                  Reminder Content
                </label>
                <textarea
                  value={editReminderTitle}
                  onChange={(e) => setEditReminderTitle(e.target.value)}
                  rows={3}
                  required
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 kalam-regular !text-slate-900 dark:!text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                ></textarea>
              </div>

              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1">
                  Target / Scheduled Date
                </label>
                <input
                  type="date"
                  value={editReminderDate}
                  onChange={(e) => setEditReminderDate(e.target.value)}
                  required
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-800 dark:text-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              {/* Tag as Important Option */}
              <div className="p-3 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-rose-600 fill-rose-500" />
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100 block">Mark as Important</span>
                    <span className="text-[10px] font-mono text-slate-500">
                      Shows prominent red tag on sticky note
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={editReminderIsImportant}
                  onChange={(e) => setEditReminderIsImportant(e.target.checked)}
                  className="w-4 h-4 accent-rose-600 rounded cursor-pointer"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingReminder(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditedReminder}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Edit Study Note */}
      {editingStudyNote && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Pencil className="w-4 h-4 text-indigo-500" />
                Edit Task Study Note
              </h3>
              <button
                onClick={() => setEditingStudyNote(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1">
                  Note Content
                </label>
                <textarea
                  value={editNoteText}
                  onChange={(e) => setEditNoteText(e.target.value)}
                  rows={4}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 kalam-regular !text-slate-900 dark:!text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                ></textarea>
              </div>

              {/* Tag as Important Option */}
              <div className="p-3 bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800/60 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-rose-600 fill-rose-500" />
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100 block">Mark as Important</span>
                    <span className="text-[10px] font-mono text-slate-500">
                      Shows red tag on study note card
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={editNoteIsImportant}
                  onChange={(e) => setEditNoteIsImportant(e.target.checked)}
                  className="w-4 h-4 accent-rose-600 rounded cursor-pointer"
                />
              </div>

              {/* Color Selection */}
              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1.5">
                  Card Background Color
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono font-semibold text-slate-500 block mb-1">
                      Select Defined Color
                    </label>
                    <select
                      value={
                        PASTEL_COLORS.some((c) => c.hex.toLowerCase() === editNoteColor.toLowerCase())
                          ? PASTEL_COLORS.find((c) => c.hex.toLowerCase() === editNoteColor.toLowerCase())?.hex
                          : "custom"
                      }
                      onChange={(e) => {
                        if (e.target.value !== "custom") {
                          setEditNoteColor(e.target.value);
                        }
                      }}
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                    >
                      {PASTEL_COLORS.map((c) => (
                        <option key={c.hex} value={c.hex}>
                          {c.name} ({c.hex})
                        </option>
                      ))}
                      <option value="custom">🎨 Custom Hex Option...</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono font-semibold text-slate-500 block mb-1">
                      Custom Hex Code
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={
                          editNoteColor.startsWith("#") && !isBlackOrDarkHex(editNoteColor)
                            ? editNoteColor
                            : "#fed7aa"
                        }
                        onChange={(e) => {
                          if (isBlackOrDarkHex(e.target.value)) {
                            toast.error("Pure black (#000000) is disabled for note card backgrounds.");
                            setEditNoteColor("#fed7aa");
                          } else {
                            setEditNoteColor(e.target.value);
                          }
                        }}
                        className="w-9 h-9 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer shrink-0 bg-white dark:bg-slate-800 shadow-2xs"
                        title="Pick custom color"
                      />
                      <input
                        type="text"
                        value={editNoteColor}
                        onChange={(e) => setEditNoteColor(e.target.value)}
                        placeholder="#fed7aa"
                        className={`w-full p-2 bg-slate-50 dark:bg-slate-800 border text-xs font-mono font-bold text-slate-800 dark:text-slate-200 rounded-xl focus:outline-none focus:ring-2 ${
                          isBlackOrDarkHex(editNoteColor)
                            ? "border-rose-400 focus:ring-rose-500/20 focus:border-rose-500"
                            : "border-slate-200 dark:border-slate-700 focus:ring-indigo-500/20 focus:border-indigo-500"
                        }`}
                      />
                    </div>
                  </div>
                </div>

                {isBlackOrDarkHex(editNoteColor) && (
                  <p className="mt-2 text-[10px] font-mono font-bold text-rose-600 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 p-2 rounded-xl flex items-center gap-1.5">
                    ⚠️ Pure black (#000000) or very dark hex codes are disabled to keep note text readable.
                  </p>
                )}

                {/* Color Swatches & Live Preview Bar */}
                <div
                  className="mt-3 p-3 rounded-xl border border-black/10 flex items-center justify-between gap-2 shadow-2xs transition-colors"
                  style={{
                    backgroundColor: isBlackOrDarkHex(editNoteColor) ? "#fed7aa" : editNoteColor,
                  }}
                >
                  <span className="text-xs font-extrabold !text-slate-900 truncate">
                    Preview: {isBlackOrDarkHex(editNoteColor) ? "#fed7aa (Reset)" : editNoteColor}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {PASTEL_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setEditNoteColor(c.hex)}
                        className={`w-5 h-5 rounded-full border transition-transform hover:scale-125 cursor-pointer ${
                          editNoteColor.toLowerCase() === c.hex.toLowerCase() ? "ring-2 ring-slate-900 ring-offset-1 scale-110" : "border-black/10"
                        }`}
                        style={{ backgroundColor: c.hex }}
                        title={c.name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono font-bold uppercase text-slate-600 dark:text-slate-400 block mb-1">
                  Custom Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={editNoteTags}
                  onChange={(e) => setEditNoteTags(e.target.value)}
                  placeholder="e.g. formulas, important, exam"
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingStudyNote(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveStudyNote}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
