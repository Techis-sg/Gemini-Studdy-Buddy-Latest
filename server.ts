import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import {
  fetchUserDashboardData,
  saveUserProfile,
  getUserProfile,
  getUserProfileByEmail,
  getUserProfileByGithub,
  saveUserDashboard,
  deleteUserDashboard,
  saveUserTask,
  deleteUserTask,
  saveUserSubject,
  deleteUserSubject,
  saveUserSettings,
  getUserSettings,
  addHistoryLog,
  getHistoryLogs,
  saveFeedback,
  getFeedbacks,
  exportUserData,
  deleteUserData,
  saveDataExportRequest,
} from "./src/db/index.js";
import {
  sendMailjetEmail,
  sendDataExportEmail,
  sendAccountDeactivationEmail,
  getMailjetCredentials,
} from "./src/services/mailjet.js";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { handleChatbotRequest } from "./src/features/chatbot/server/chatbotAgent.js";
import { Dashboard, Subject, Task, TimeLog, TaskAttachment } from "./src/types";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

const allowedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/pdf",
]);

const allowedExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".pdf",
]);

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many upload requests. Please try again later.",
  },
});

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")           // Replace spaces with -
    .replace(/[^\w\-]+/g, "")       // Remove all non-word chars
    .replace(/\-\-+/g, "-")         // Replace multiple - with single -
    .replace(/^-+/, "")             // Trim - from start of text
    .replace(/-+$/, "");            // Trim - from end of text
}

dotenv.config();

const app = express();
const PORT = 3000;

// Increase limits for base64 file uploads safely
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use("/uploads", express.static(uploadsDir));

// Initialize Gemini Client
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
} else {
  console.warn("GEMINI_API_KEY is not defined in environment variables.");
}

/**
 * Robust wrapper for calling Gemini content generation with automated retries and
 * fallback to gemini-3.1-flash-lite if the primary model is busy/overloaded (503 Service Unavailable).
 */
async function generateContentWithFallback(params: any): Promise<any> {
  if (!ai) {
    throw new Error("Gemini API client is not configured.");
  }

  const originalModel = params.model || "gemini-3.6-flash";
  try {
    return await ai.models.generateContent({
      ...params,
      model: params.model || "gemini-3.6-flash",
    });
  } catch (err: any) {
    const errorStr = String(err.message || err).toLowerCase();
    const is503 = errorStr.includes("503") || 
                  errorStr.includes("demand") || 
                  errorStr.includes("unavailable") || 
                  errorStr.includes("overloaded") || 
                  errorStr.includes("rate limit") ||
                  err.status === 503;

    if (is503) {
      console.warn(`Model ${originalModel} is busy or unavailable. Trying fallback model gemini-3.1-flash-lite...`, err);
      // Wait a tiny bit to let spikes settle
      await new Promise(resolve => setTimeout(resolve, 500));

      const fallbackParams = {
        ...params,
        model: "gemini-3.1-flash-lite"
      };

      try {
        return await ai.models.generateContent(fallbackParams);
      } catch (fallbackErr: any) {
        console.error("Fallback model gemini-3.1-flash-lite also failed:", fallbackErr);
        // If fallback fails, try a simple retry on the original model
        console.warn(`Retrying original model ${originalModel} one last time...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await ai.models.generateContent(params);
      }
    }

    // For other types of errors, propagate them
    throw err;
  }
}

/**
 * Syncs the subject percentage/status in Firestore based on its associated tasks
 */
async function syncSubjectProgress(userId: string, dashboardId: string, subjectId: string): Promise<void> {
  const data = await fetchUserDashboardData(userId);
  const subjectsList = data.subjects[dashboardId] || [];
  const tasksList = data.tasks[dashboardId] || [];

  const subj = subjectsList.find((s) => s.id === subjectId);
  if (!subj) return;

  const associatedTasks = tasksList.filter((t) => t.subjectId === subjectId);
  if (associatedTasks.length === 0) {
    subj.percentage = 0;
    subj.status = "Not Started";
    await saveUserSubject(userId, subj);
    return;
  }

  const completed = associatedTasks.filter((t) => t.status === "Completed").length;
  const percentage = Math.round((completed / associatedTasks.length) * 100);

  subj.percentage = percentage;
  subj.status =
    percentage === 100 ? "Completed" : percentage > 0 ? "In Progress" : "Not Started";

  await saveUserSubject(userId, subj);
}

// --- Auth Routes ---

// Get current session
app.get("/api/auth/me", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    if (userId && userId !== "null" && userId !== "undefined" && userId !== "anonymous") {
      const user = await getUserProfile(userId);
      if (user && user.status === 2) {
        return res.status(403).json({ error: "This account has been deleted and cannot be accessed." });
      }
      if (user && user.isBlocked) {
        return res.status(403).json({ error: "Your account is blocked for misuse. Contact administrator: support@studybuddy.com" });
      }
      res.json({ user });
    } else {
      res.json({ user: null });
    }
  } catch (error: any) {
    console.error("Auth me error:", error);
    res.status(500).json({ error: "Failed to get current session: " + error.message });
  }
});

// Unified OAuth Handler (Google / GitHub)
const handleUnifiedOAuth = async (req: express.Request, res: express.Response) => {
  try {
    const { provider, email, name, avatarUrl, uid, github } = req.body;
    const cleanEmail = email ? email.trim().toLowerCase() : "";
    const cleanGithub = github ? github.trim().toLowerCase() : "";

    // Step 1: Does Firestore contain this user? Search by ID, Email, or GitHub account
    let existingUser = uid ? await getUserProfile(uid) : null;
    if (!existingUser && cleanEmail) {
      existingUser = await getUserProfileByEmail(cleanEmail);
    }
    if (!existingUser && cleanGithub) {
      existingUser = await getUserProfileByGithub(cleanGithub);
    }

    if (!cleanEmail && !cleanGithub && !existingUser) {
      return res.status(400).json({ error: "Email or GitHub profile is required for authentication." });
    }

    const cleanName = name ? name.trim() : (cleanEmail ? cleanEmail.split("@")[0] : (existingUser ? existingUser.name : "User"));
    const cleanId = existingUser
      ? existingUser.id
      : (uid || `${provider || "google"}_${cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9]/g, "_") : (cleanGithub ? cleanGithub.replace(/[^a-zA-Z0-9]/g, "_") : "user")}`);

    // Check if user is blocked
    if (existingUser && existingUser.isBlocked) {
      return res.status(403).json({
        error: "Your account is blocked for misuse. Contact administrator: support@studybuddy.com",
        code: "USER_BLOCKED",
      });
    }

    // Step 2: If user does not exist or was deleted -> Create profile in Firestore
    if (!existingUser || existingUser.status === 2) {
      const defaultGithub = cleanGithub || (provider === "github" ? `https://github.com/${cleanName.toLowerCase().replace(/\s+/g, "")}` : "");
      const newUser = {
        id: cleanId,
        provider: provider || "google",
        email: cleanEmail,
        github: defaultGithub,
        name: cleanName,
        avatarUrl: avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${cleanId}`,
        createdAt: new Date().toISOString(),
        warningsCount: 0,
        isBlocked: false,
        status: 1, // Active
        deactivatedAt: null,
        deactivationHistory: [],
        isMischievous: false,
        mischievousFlagReason: null,
      };

      await saveUserProfile(cleanId, newUser);
      await fetchUserDashboardData(cleanId);

      return res.json({ success: true, user: newUser, isNewUser: true });
    }

    // Step 3: User exists -> Interlink email/github OAuth identity details if provided
    let profileNeedsSave = false;
    if (cleanEmail && (!existingUser.email || existingUser.email !== cleanEmail)) {
      existingUser.email = cleanEmail;
      profileNeedsSave = true;
    }
    if (cleanGithub && (!existingUser.github || existingUser.github !== cleanGithub)) {
      existingUser.github = cleanGithub;
      profileNeedsSave = true;
    }
    if (avatarUrl && existingUser.avatarUrl !== avatarUrl) {
      existingUser.avatarUrl = avatarUrl;
      profileNeedsSave = true;
    }
    if (cleanName && (!existingUser.name || existingUser.name === "User" || existingUser.name === "Google User")) {
      existingUser.name = cleanName;
      profileNeedsSave = true;
    }
    if (profileNeedsSave) {
      await saveUserProfile(existingUser.id, existingUser);
    }

    // Ensure dashboard data is seeded/available
    await fetchUserDashboardData(existingUser.id);

    // Check if user has TOTP MFA enabled
    const userSettings = await getUserSettings(existingUser.id);
    const mfaEnabled = (existingUser.twoFactorEnabled || userSettings?.twoFactorEnabled) && (existingUser.totpSecret || userSettings?.totpSecret);

    if (mfaEnabled && !req.body.mfaVerified) {
      const totpCode = req.body.totpCode ? String(req.body.totpCode).trim().replace(/\D/g, "") : "";
      if (!totpCode) {
        return res.json({
          requiresMfa: true,
          userId: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          message: "Google Authenticator 2FA is required for this account.",
        });
      }

      const cleanSecret = String(existingUser.totpSecret || userSettings?.totpSecret).replace(/\s+/g, "").toUpperCase();
      const totp = new OTPAuth.TOTP({
        issuer: "LearnSpace",
        label: "User",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(cleanSecret),
      });

      const delta = totp.validate({ token: totpCode, window: 2 });
      if (delta === null) {
        return res.status(400).json({ error: "Invalid Google Authenticator 6-digit code." });
      }
    }

    return res.json({ success: true, user: existingUser, isNewUser: false });
  } catch (error: any) {
    console.error("Auth handler error:", error);
    return res.status(500).json({ error: "Authentication failed: " + error.message });
  }
};

app.post("/api/auth/google", handleUnifiedOAuth);
app.post("/api/auth/login", handleUnifiedOAuth);
app.post("/api/auth/register", handleUnifiedOAuth);

// --- API Routes ---

// Get DB state
app.get("/api/dashboard", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const data = await fetchUserDashboardData(userId);
    res.json(data);
  } catch (error: any) {
    console.error("Fetch dashboards error:", error);
    res.status(500).json({ error: "Failed to fetch planner: " + error.message });
  }
});

// Create new dashboard
app.post("/api/dashboard", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { name, description, target, statusOverview } = req.body;

    const dbName = name || "New Custom Tracker Plan";
    const newDashboard: Dashboard = {
      id: "dash_" + Date.now(),
      name: dbName,
      shortName: slugify(dbName),
      description: description || "Custom study tracks and tasks tracking.",
      createdAt: new Date().toISOString(),
      isDefault: false,
      target: target || "AIR < 200",
      statusOverview: statusOverview || "Created " + new Date().toLocaleDateString(),
    };

    await saveUserDashboard(userId, newDashboard);
    res.json({ dashboard: newDashboard, subjects: [], tasks: [] });
  } catch (error: any) {
    console.error("Create dashboard error:", error);
    res.status(500).json({ error: "Failed to create dashboard: " + error.message });
  }
});

// Delete dashboard
app.delete("/api/dashboard/:id", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { id } = req.params;

    await deleteUserDashboard(userId, id);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete dashboard error:", error);
    res.status(500).json({ error: "Failed to delete dashboard: " + error.message });
  }
});

// Create new task
app.post("/api/task", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { dashboardId, title, description, date, category, priority, subjectId, boardColumnId } = req.body;

    const targetColumn = boardColumnId || "today";
    const statusMap: Record<string, 'Not Started' | 'In Progress' | 'Completed'> = {
      backlog: "Not Started",
      today: "Not Started",
      in_progress: "In Progress",
      completed: "Completed",
      revision: "Completed",
    };
    const mappedStatus = statusMap[targetColumn] || "Not Started";

    const dbData = await fetchUserDashboardData(userId);
    const existingTasks = dbData.tasks[dashboardId] || [];
    const seqNum = existingTasks.length + 1;
    const taskIdVal = req.body.taskId || req.body.taskid || `TSK-${String(seqNum).padStart(3, "0")}`;

    const newTask: Task = {
      id: "task_" + Date.now(),
      taskId: taskIdVal,
      taskid: taskIdVal,
      dashboardId,
      subjectId,
      title: title || "New Task",
      description: description || "",
      date: date || new Date().toISOString().split("T")[0],
      category: category || "General",
      status: mappedStatus,
      priority: priority || "Medium",
      notes: "",
      timeSpentMinutes: 0,
      timeLogs: [],
      attachments: [],
      boardColumnId: targetColumn,
    };

    await saveUserTask(userId, newTask);

    // Save action log to history
    await addHistoryLog(userId, {
      id: "log_user_create_" + Date.now(),
      type: "action",
      subType: "user",
      action: "create_task",
      description: `Created syllabus task: "${newTask.title}".`,
      timestamp: new Date().toISOString(),
    });

    if (subjectId) {
      await syncSubjectProgress(userId, dashboardId, subjectId);
    }

    res.json(newTask);
  } catch (error: any) {
    console.error("Create task error:", error);
    res.status(500).json({ error: "Failed to create task: " + error.message });
  }
});

// Update task
app.put("/api/task/:id", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { id } = req.params;
    const updates = req.body;

    const data = await fetchUserDashboardData(userId);
    let targetTask: Task | null = null;
    let oldStatus = "";

    // Search inside all dashboard lists
    for (const dId of Object.keys(data.tasks)) {
      const match = data.tasks[dId].find((t) => t.id === id);
      if (match) {
        oldStatus = match.status;
        targetTask = { ...match, ...updates };
        break;
      }
    }

    if (!targetTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    await saveUserTask(userId, targetTask);

    // Save action log to history
    if (oldStatus !== targetTask.status) {
      await addHistoryLog(userId, {
        id: "log_user_status_" + Date.now(),
        type: "action",
        subType: "user",
        action: targetTask.status === "Completed" ? "complete_task" : "update_task",
        description: `Updated task "${targetTask.title}" status to "${targetTask.status}".`,
        timestamp: new Date().toISOString(),
      });
    } else {
      await addHistoryLog(userId, {
        id: "log_user_update_" + Date.now(),
        type: "action",
        subType: "user",
        action: "update_task",
        description: `Edited task details for: "${targetTask.title}".`,
        timestamp: new Date().toISOString(),
      });
    }

    if (targetTask.subjectId) {
      await syncSubjectProgress(userId, targetTask.dashboardId, targetTask.subjectId);
    }

    res.json(targetTask);
  } catch (error: any) {
    console.error("Update task error:", error);
    res.status(500).json({ error: "Failed to update task: " + error.message });
  }
});

// Delete task
app.delete("/api/task/:id", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { id } = req.params;

    const data = await fetchUserDashboardData(userId);
    let targetTask: Task | null = null;

    for (const dId of Object.keys(data.tasks)) {
      const match = data.tasks[dId].find((t) => t.id === id);
      if (match) {
        targetTask = match;
        break;
      }
    }

    if (!targetTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    await deleteUserTask(userId, id);

    // Save action log to history
    await addHistoryLog(userId, {
      id: "log_user_delete_" + Date.now(),
      type: "action",
      subType: "user",
      action: "delete_task",
      description: `Deleted syllabus task: "${targetTask.title}".`,
      timestamp: new Date().toISOString(),
    });

    if (targetTask.subjectId) {
      await syncSubjectProgress(userId, targetTask.dashboardId, targetTask.subjectId);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete task error:", error);
    res.status(500).json({ error: "Failed to delete task: " + error.message });
  }
});

// Reorder tasks
app.put("/api/tasks/reorder/:dashId", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { dashId } = req.params;
    const { taskIds } = req.body;

    const data = await fetchUserDashboardData(userId);
    const existingTasks = data.tasks[dashId] || [];
    const taskMap = new Map(existingTasks.map((t) => [t.id, t]));
    const reordered: Task[] = [];

    taskIds.forEach((id: string) => {
      const task = taskMap.get(id);
      if (task) {
        reordered.push(task);
        taskMap.delete(id);
      }
    });

    taskMap.forEach((task) => {
      reordered.push(task);
    });

    // Save them sequentially
    for (const task of reordered) {
      await saveUserTask(userId, task);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Reorder tasks error:", error);
    res.status(500).json({ error: "Failed to reorder tasks: " + error.message });
  }
});

// Log time for task
app.post("/api/task/:id/log-time", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { id } = req.params;
    const { minutes, note } = req.body;

    const data = await fetchUserDashboardData(userId);
    let targetTask: Task | null = null;

    for (const dId of Object.keys(data.tasks)) {
      const match = data.tasks[dId].find((t) => t.id === id);
      if (match) {
        targetTask = { ...match };
        break;
      }
    }

    if (!targetTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    const newLog: TimeLog = {
      id: "log_" + Date.now(),
      minutes: Number(minutes) || 0,
      note: note || "Logged active study session.",
      loggedAt: new Date().toISOString(),
    };

    targetTask.timeLogs = [...(targetTask.timeLogs || []), newLog];
    targetTask.timeSpentMinutes = (targetTask.timeSpentMinutes || 0) + newLog.minutes;

    if (targetTask.status === "Not Started") {
      targetTask.status = "In Progress";
      targetTask.boardColumnId = "in_progress";
    }

    await saveUserTask(userId, targetTask);

    // Save action log to history
    await addHistoryLog(userId, {
      id: "log_user_time_" + Date.now(),
      type: "action",
      subType: "user",
      action: "log_time",
      description: `Logged ${minutes} study minutes to: "${targetTask.title}".`,
      timestamp: new Date().toISOString(),
    });

    if (targetTask.subjectId) {
      await syncSubjectProgress(userId, targetTask.dashboardId, targetTask.subjectId);
    }

    res.json(targetTask);
  } catch (error: any) {
    console.error("Log time error:", error);
    res.status(500).json({ error: "Failed to log time: " + error.message });
  }
});

// Edit subject
app.put("/api/subject/:dashId/:id", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { dashId, id } = req.params;
    const updates = req.body;

    const data = await fetchUserDashboardData(userId);
    const subjectsList = data.subjects[dashId] || [];
    const targetSubj = subjectsList.find((s) => s.id === id);

    if (!targetSubj) {
      return res.status(404).json({ error: "Subject not found" });
    }

    const updatedSubj: Subject = {
      ...targetSubj,
      ...updates,
    };

    // BI-DIRECTIONAL SYNC: Subject status -> Tasks status
    const targetStatus = updatedSubj.status;
    const tasksList = data.tasks[dashId] || [];

    if (targetStatus === "Completed") {
      for (const t of tasksList) {
        if (t.subjectId === id && t.status !== "Completed") {
          t.status = "Completed";
          t.boardColumnId = "completed";
          await saveUserTask(userId, t);
        }
      }
    } else if (targetStatus === "Not Started") {
      for (const t of tasksList) {
        if (t.subjectId === id && t.status !== "Not Started") {
          t.status = "Not Started";
          t.boardColumnId = "today";
          await saveUserTask(userId, t);
        }
      }
    } else if (targetStatus === "In Progress") {
      const hasActive = tasksList.some((t) => t.subjectId === id && t.status === "In Progress");
      if (!hasActive) {
        const subjectTasks = tasksList.filter((t) => t.subjectId === id);
        const todoTask = subjectTasks.find((t) => t.status === "Not Started");
        if (todoTask) {
          todoTask.status = "In Progress";
          todoTask.boardColumnId = "in_progress";
          await saveUserTask(userId, todoTask);
        } else if (subjectTasks.length > 0) {
          subjectTasks[0].status = "In Progress";
          subjectTasks[0].boardColumnId = "in_progress";
          await saveUserTask(userId, subjectTasks[0]);
        }
      }
    }

    // Recalculate percentage based on synced task statuses
    const updatedTasksList = (await fetchUserDashboardData(userId)).tasks[dashId] || [];
    const associatedTasks = updatedTasksList.filter((t) => t.subjectId === id);
    if (associatedTasks.length > 0) {
      const completedCount = associatedTasks.filter((t) => t.status === "Completed").length;
      updatedSubj.percentage = Math.round((completedCount / associatedTasks.length) * 100);
    }

    await saveUserSubject(userId, updatedSubj);
    res.json(updatedSubj);
  } catch (error: any) {
    console.error("Update subject error:", error);
    res.status(500).json({ error: "Failed to update subject: " + error.message });
  }
});

// Add custom subject
app.post("/api/subject/:dashId", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { dashId } = req.params;
    const {
      name,
      block,
      daysPlanned,
      timeline,
      percentage,
      pendingTopics,
      completedTopics,
      weightage,
      resource,
    } = req.body;

    const newSubject: Subject = {
      id: "subj_" + Date.now(),
      dashboardId: dashId,
      name: name || "New Subject",
      block: block || "Block 1 - GATE",
      daysPlanned: Number(daysPlanned) || 0,
      timeline: timeline || "Custom",
      status: percentage === 100 ? "Completed" : percentage > 0 ? "In Progress" : "Not Started",
      percentage: Number(percentage) || 0,
      pendingTopics: pendingTopics || "",
      completedTopics: completedTopics || "",
      weightage: weightage || "",
      resource: resource || "",
    };

    await saveUserSubject(userId, newSubject);
    res.json(newSubject);
  } catch (error: any) {
    console.error("Add subject error:", error);
    res.status(500).json({ error: "Failed to add subject: " + error.message });
  }
});

// Delete subject
app.delete("/api/subject/:dashId/:id", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { id } = req.params;

    await deleteUserSubject(userId, id);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete subject error:", error);
    res.status(500).json({ error: "Failed to delete subject: " + error.message });
  }
});

// --- Settings API ---
app.get("/api/settings", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const settings = await getUserSettings(userId);
    res.json({ settings });
  } catch (error: any) {
    console.error("Fetch settings error:", error);
    res.status(500).json({ error: "Failed to fetch settings: " + error.message });
  }
});

app.post("/api/settings", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const settings = req.body;
    await saveUserSettings(userId, settings);

    // Sync profile document in Firestore with email, github, and full name
    if (userId) {
      const userProfile = await getUserProfile(userId);
      if (userProfile) {
        let updated = false;
        if (settings.email && settings.email !== userProfile.email) {
          userProfile.email = settings.email.trim().toLowerCase();
          updated = true;
        }
        if (settings.github !== undefined && settings.github !== userProfile.github) {
          userProfile.github = settings.github.trim();
          updated = true;
        }
        if (settings.avatarUrl && settings.avatarUrl !== userProfile.avatarUrl) {
          userProfile.avatarUrl = settings.avatarUrl;
          updated = true;
        }
        if (settings.firstName || settings.lastName) {
          userProfile.name = `${settings.firstName || ''} ${settings.lastName || ''}`.trim();
          updated = true;
        }
        if (updated) {
          await saveUserProfile(userId, userProfile);
        }
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Save settings error:", error);
    res.status(500).json({ error: "Failed to save settings: " + error.message });
  }
});

// --- MFA / TOTP (Google Authenticator) API ---
app.post("/api/auth/mfa/generate", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const profile = await getUserProfile(userId);
    const email = profile?.email || "user@learnspace.app";

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: "LearnSpace",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: secret,
    });

    const uri = totp.toString();
    const qrCodeUrl = await QRCode.toDataURL(uri);

    res.json({
      secret: secret.base32,
      uri,
      qrCodeUrl,
    });
  } catch (error: any) {
    console.error("MFA Generate error:", error);
    res.status(500).json({ error: "Failed to generate MFA setup: " + error.message });
  }
});

app.post("/api/auth/mfa/verify", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { secret, code } = req.body;

    if (!secret || !code) {
      return res.status(400).json({ error: "Secret key and verification code are required." });
    }

    const cleanSecret = String(secret).replace(/\s+/g, "").toUpperCase();
    const cleanCode = String(code).trim().replace(/\D/g, "");

    const totp = new OTPAuth.TOTP({
      issuer: "LearnSpace",
      label: "User",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(cleanSecret),
    });

    const delta = totp.validate({ token: cleanCode, window: 2 });
    if (delta === null) {
      return res.status(400).json({ error: "Invalid authenticator code. Please check your Google Authenticator app and try again." });
    }

    const currentSettings = (await getUserSettings(userId)) || {};
    const updatedSettings = {
      ...currentSettings,
      twoFactorEnabled: true,
      totpSecret: cleanSecret,
    };
    await saveUserSettings(userId, updatedSettings);

    const profile = await getUserProfile(userId);
    if (profile) {
      await saveUserProfile(userId, { ...profile, twoFactorEnabled: true, totpSecret: cleanSecret });
    }

    await addHistoryLog(userId, {
      id: "log_" + Date.now(),
      type: "action",
      action: "enable_mfa",
      description: "Enabled Google Authenticator TOTP Multi-Factor Authentication (MFA).",
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, message: "MFA verified and enabled successfully!" });
  } catch (error: any) {
    console.error("MFA Verify error:", error);
    res.status(500).json({ error: "Failed to verify MFA code: " + error.message });
  }
});

app.post("/api/auth/mfa/disable", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const currentSettings = (await getUserSettings(userId)) || {};
    const updatedSettings = {
      ...currentSettings,
      twoFactorEnabled: false,
      totpSecret: null,
    };
    await saveUserSettings(userId, updatedSettings);

    const profile = await getUserProfile(userId);
    if (profile) {
      await saveUserProfile(userId, { ...profile, twoFactorEnabled: false, totpSecret: null });
    }

    await addHistoryLog(userId, {
      id: "log_" + Date.now(),
      type: "action",
      action: "disable_mfa",
      description: "Disabled Multi-Factor Authentication (MFA).",
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, message: "MFA disabled successfully." });
  } catch (error: any) {
    console.error("MFA Disable error:", error);
    res.status(500).json({ error: "Failed to disable MFA: " + error.message });
  }
});

app.post("/api/auth/mfa/validate", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { code } = req.body;
    const cleanCode = String(code || "").trim().replace(/\D/g, "");

    const settings = await getUserSettings(userId);
    const profile = await getUserProfile(userId);
    const secret = settings?.totpSecret || profile?.totpSecret;

    if (!secret) {
      return res.status(400).json({ error: "MFA is not enabled for this account." });
    }

    const cleanSecret = String(secret).replace(/\s+/g, "").toUpperCase();

    const totp = new OTPAuth.TOTP({
      issuer: "LearnSpace",
      label: "User",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(cleanSecret),
    });

    const delta = totp.validate({ token: cleanCode, window: 2 });
    if (delta === null) {
      return res.status(400).json({ error: "Invalid authenticator code." });
    }

    res.json({ success: true, valid: true });
  } catch (error: any) {
    console.error("MFA Validate error:", error);
    res.status(500).json({ error: "Failed to validate MFA code: " + error.message });
  }
});

app.post("/api/auth/mfa/login-verify", async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ error: "User ID and 6-digit TOTP code are required." });
    }

    const cleanCode = String(code).trim().replace(/\D/g, "");
    const profile = await getUserProfile(userId);
    const settings = await getUserSettings(userId);
    const secret = profile?.totpSecret || settings?.totpSecret;

    if (!profile) {
      return res.status(404).json({ error: "User profile not found." });
    }

    if (!secret) {
      return res.json({ success: true, user: profile });
    }

    const cleanSecret = String(secret).replace(/\s+/g, "").toUpperCase();

    const totp = new OTPAuth.TOTP({
      issuer: "LearnSpace",
      label: "User",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(cleanSecret),
    });

    const delta = totp.validate({ token: cleanCode, window: 2 });
    if (delta === null) {
      return res.status(400).json({ error: "Invalid Google Authenticator code. Please check your app and try again." });
    }

    await addHistoryLog(userId, {
      id: "log_" + Date.now(),
      type: "action",
      action: "mfa_login_verify",
      description: "Successfully verified TOTP MFA code during sign-in.",
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, user: profile });
  } catch (error: any) {
    console.error("MFA login verify error:", error);
    res.status(500).json({ error: "MFA verification failed: " + error.message });
  }
});

// --- Privacy & Account Management API ---
app.get("/api/user/export-data", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const data = await exportUserData(userId);
    res.json(data);
  } catch (error: any) {
    console.error("Export data error:", error);
    res.status(500).json({ error: "Failed to export user data package: " + error.message });
  }
});

// --- Mailjet API Routes & Integrations ---
app.get("/api/mailjet/status", (req, res) => {
  const creds = getMailjetCredentials();
  res.json({
    configured: Boolean(creds.apiKey && creds.apiSecret),
    apiKeyPrefix: creds.apiKey ? creds.apiKey.substring(0, 6) + "..." : null,
    senderEmail: creds.senderEmail,
    senderName: creds.senderName,
  });
});

app.post("/api/mailjet/send-test", async (req, res) => {
  try {
    const { recipientEmail, subject, message } = req.body;
    if (!recipientEmail) {
      return res.status(400).json({ error: "recipientEmail is required." });
    }

    const result = await sendMailjetEmail({
      toEmail: recipientEmail,
      subject: subject || "[StudyBuddy] Test Email via Mailjet API",
      textPart: message || "Hello! This is a test transactional email sent via Mailjet API v3.1 integration in StudyBuddy Portal.",
      htmlPart: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h3 style="color: #4f46e5; margin-top: 0;">Mailjet API Test Successful!</h3>
        <p style="color: #334155;">${message || "This email confirms that your Mailjet Email API credentials (API Key: 29670a77fe0b...) are configured and delivering emails successfully."}</p>
        <p style="font-size: 12px; color: #94a3b8;">Sent via StudyBuddy Portal Mailjet Service</p>
      </div>`,
    });

    if (result.success) {
      res.json({
        success: true,
        message: "Test email dispatched successfully via Mailjet API!",
        messageId: result.messageId,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || "Mailjet delivery failed.",
        details: result.data,
      });
    }
  } catch (error: any) {
    console.error("Mailjet send-test error:", error);
    res.status(500).json({ error: "Failed to dispatch test email: " + error.message });
  }
});

app.post("/api/user/export-request", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const profile = await getUserProfile(userId);
    const userEmail = profile?.email || "user@learnspace.app";

    const requestId = await saveDataExportRequest(userId, userEmail);

    await addHistoryLog(userId, {
      id: "log_" + Date.now(),
      type: "action",
      action: "request_data_export",
      description: `Initiated data package export request for ${userEmail}.`,
      timestamp: new Date().toISOString(),
    });

    // Send Mailjet notification email asynchronously
    sendDataExportEmail(userEmail, profile?.name || "User", requestId).catch((err) => {
      console.warn("[Mailjet] Export email notification dispatch error:", err);
    });

    res.json({
      success: true,
      message: "Export Data Request Received. We will send your data to email in short time.",
      requestId,
    });
  } catch (error: any) {
    console.error("Export request error:", error);
    res.status(500).json({ error: "Failed to submit export data request: " + error.message });
  }
});

app.post("/api/user/deactivate", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const profile = await getUserProfile(userId);
    const now = new Date().toISOString();
    const prevHistory = Array.isArray(profile?.deactivationHistory) ? profile.deactivationHistory : [];
    const newHistory = [...prevHistory, now];

    if (profile) {
      await saveUserProfile(userId, {
        ...profile,
        status: 0,
        isDeactivated: true,
        deactivatedAt: now,
        deactivationHistory: newHistory,
        updatedAt: now,
      });

      if (profile.email) {
        sendAccountDeactivationEmail(profile.email, profile.name || "User").catch((err) => {
          console.warn("[Mailjet] Deactivation email dispatch error:", err);
        });
      }
    }

    await addHistoryLog(userId, {
      id: "log_" + Date.now(),
      type: "action",
      action: "deactivate_account",
      description: "User deactivated their workspace session (status set to 0).",
      timestamp: now,
    });

    res.json({ success: true, message: "Account deactivated successfully." });
  } catch (error: any) {
    console.error("Deactivate account error:", error);
    res.status(500).json({ error: "Failed to deactivate account: " + error.message });
  }
});

app.post("/api/user/reactivate", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const profile = await getUserProfile(userId);
    if (!profile) {
      return res.status(404).json({ error: "User profile not found." });
    }
    if (profile.status === 2) {
      return res.status(403).json({ error: "This account has been deleted and cannot be reactivated." });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const history: string[] = Array.isArray(profile.deactivationHistory) ? profile.deactivationHistory : [];

    // Calculate deactivations/reactivations in the last 24 hours
    const recentDeactivations = history.filter((ts) => {
      const time = new Date(ts).getTime();
      return !isNaN(time) && now.getTime() - time < 24 * 60 * 60 * 1000;
    });

    let isMischievous = profile.isMischievous || false;
    let mischievousFlagReason = profile.mischievousFlagReason || null;

    if (recentDeactivations.length >= 3) {
      isMischievous = true;
      mischievousFlagReason = `Frequent account deactivation and reactivation loop detected (${recentDeactivations.length} occurrences in 24 hours).`;
      await addHistoryLog(userId, {
        id: "log_" + Date.now(),
        type: "warning",
        action: "mischievous_flag_raised",
        description: `Flagged user for suspicious frequent deactivation/reactivation cycle.`,
        timestamp: nowIso,
      });
    }

    const updatedProfile = {
      ...profile,
      status: 1,
      isDeactivated: false,
      lastReactivatedAt: nowIso,
      isMischievous,
      mischievousFlagReason,
      updatedAt: nowIso,
    };

    await saveUserProfile(userId, updatedProfile);

    await addHistoryLog(userId, {
      id: "log_" + Date.now(),
      type: "action",
      action: "reactivate_account",
      description: "User reactivated their workspace session (status set to 1).",
      timestamp: nowIso,
    });

    res.json({
      success: true,
      message: "Account reactivated successfully.",
      user: updatedProfile,
    });
  } catch (error: any) {
    console.error("Reactivate account error:", error);
    res.status(500).json({ error: "Failed to reactivate account: " + error.message });
  }
});

app.post("/api/user/deactivate-declined", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const profile = await getUserProfile(userId);
    const count = (profile?.reactivationDeclinedCount || 0) + 1;
    let isMischievous = profile?.isMischievous || false;
    let mischievousFlagReason = profile?.mischievousFlagReason || null;

    if (count >= 3) {
      isMischievous = true;
      mischievousFlagReason = `Repeated login attempts (${count}) while refusing account reactivation.`;
    }

    if (profile) {
      await saveUserProfile(userId, {
        ...profile,
        reactivationDeclinedCount: count,
        isMischievous,
        mischievousFlagReason,
        updatedAt: new Date().toISOString(),
      });
    }

    await addHistoryLog(userId, {
      id: "log_" + Date.now(),
      type: "warning",
      action: "declined_reactivation",
      description: `User declined account reactivation prompt (attempt #${count}).`,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Deactivate declined error:", error);
    res.status(500).json({ error: "Failed to log declined reactivation: " + error.message });
  }
});

app.delete("/api/user/delete-account", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    await deleteUserData(userId);
    res.json({ success: true, message: "Account and all associated records permanently purged from database." });
  } catch (error: any) {
    console.error("Delete account error:", error);
    res.status(500).json({ error: "Failed to delete account: " + error.message });
  }
});

// Helper for asynchronous AI sentiment & aspect-based semantic analysis
async function classifyFeedbackAsync(feedbackId: string, message: string) {
  let aiTag = "Neutral";
  const lowerMsg = message.toLowerCase();

  // 1. First-pass rule-based sentiment & semantic signals for immediate high reliability
  const negativeKeywords = [
    "not working", "not good", "not nice", "not great", "not helpful", "not so good",
    "issue", "bug", "error", "broken", "crash", "failed", "fix", "glitch",
    "problem", "cannot", "cant", "can't", "wrong", "unable", "worst", "terrible",
    "hate", "bad", "useless", "disappointed", "horrible", "fuck", "shit", "sucks",
    "garbage", "trash", "poor", "rubbish", "failing", "flaw"
  ];

  const demandingKeywords = [
    "add", "feature", "would be nice", "please allow", "request", "suggestion",
    "enhancement", "option", "need", "want", "demand", "implement", "could you",
    "can you", "hope you can", "would like", "should have", "bring back"
  ];

  const positiveKeywords = [
    "great", "awesome", "love", "excellent", "good", "nice", "best", "super",
    "helpful", "amazing", "wonderful", "perfect", "thank", "kudos", "brilliant"
  ];

  if (negativeKeywords.some((kw) => lowerMsg.includes(kw))) {
    aiTag = "Negative";
  } else if (demandingKeywords.some((kw) => lowerMsg.includes(kw))) {
    aiTag = "Demanding";
  } else if (positiveKeywords.some((kw) => lowerMsg.includes(kw)) && !lowerMsg.includes("not ") && !lowerMsg.includes("worst")) {
    aiTag = "Positive";
  }

  // 2. Perform deep Gemini AI Sentiment Analysis and Aspect-based Semantic Analysis
  if (ai) {
    try {
      const prompt = `You are an expert AI Sentiment and Aspect-Based Semantic Classifier for user feedback in an educational study portal.

Perform comprehensive Sentiment Analysis (evaluating emotional tone, frustration, satisfaction, anger, praise, or neutrality) AND Aspect-Based Semantic Analysis (evaluating user intent, e.g. feature demands vs bug complaints/frustration vs general feedback).

Analyze the user feedback message below and classify it into EXACTLY ONE tag from this strict list of 4 allowed tags:
- "Positive": User expresses praise, satisfaction, appreciation, good experience, or gratitude.
- "Negative": User expresses frustration, complaint, criticism, discontent, anger, reports bugs/issues/broken functionality, or uses profanity.
- "Demanding": User asks for or demands new features, enhancements, capabilities, options, or functionality in the portal.
- "Neutral": User provides general, non-opinionated, informational statements, queries, or neutral feedback.

Examples for reference:
- "Hey this is not working man some issues are coming up." -> Negative
- "not nice man not so good. worst portal I have seen ever. FUCK you man." -> Negative
- "Please add dark mode toggle and option to export study plan to PDF" -> Demanding
- "This portal is super helpful for my GATE preparation, love it!" -> Positive
- "I use this portal on my laptop running Windows" -> Neutral

User Message: "${message}"

Respond with ONLY the single tag word (one of: Positive, Negative, Demanding, Neutral).`;

      const aiRes = await generateContentWithFallback({
        contents: prompt,
        config: {
          temperature: 0.0,
          maxOutputTokens: 10,
        },
      });

      const rawText = aiRes.response?.text()?.trim() || "";
      const cleanTag = rawText.replace(/[^a-zA-Z]/g, "").trim();
      if (cleanTag) {
        const normalizedTag = cleanTag.charAt(0).toUpperCase() + cleanTag.slice(1).toLowerCase();
        if (["Positive", "Negative", "Demanding", "Neutral"].includes(normalizedTag)) {
          aiTag = normalizedTag;
        }
      }
    } catch (aiErr) {
      console.warn("Async AI feedback classification error:", aiErr);
    }
  }

  // Save the classified tag to DB asynchronously
  try {
    await saveFeedback({ id: feedbackId, ai_tag: aiTag });
  } catch (err) {
    console.error("Failed to update feedback ai_tag asynchronously:", err);
  }
}

// --- Feedback API ---
app.post("/api/feedback", async (req, res) => {
  try {
    const userId = (req.headers["x-user-id"] as string) || "anonymous";
    const { name, email, message, type = "feedback", screenshots = [] } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required fields." });
    }

    const trimmedMsg = String(message).trim();

    // 1. Basic security check & sanitization
    const sanitizedMsg = trimmedMsg.replace(/<[^>]*>?/gm, "");

    // Check allowed characters: alphanumeric, spaces, and allowed special characters (. , / \ ? ! # -)
    if (!/^[a-zA-Z0-9\s.,/\\?!#-]+$/.test(sanitizedMsg)) {
      return res.status(400).json({ error: "Only letters, numbers, spaces, and allowed symbols (. , / \\ ? ! # -) are allowed in message." });
    }

    const wordCount = sanitizedMsg.split(/\s+/).filter(Boolean).length;
    const maxChars = type === "issue" ? 600 : 255;
    const maxWords = type === "issue" ? 100 : 50;

    if (sanitizedMsg.length < 5 || sanitizedMsg.length > maxChars || wordCount < 2 || wordCount > maxWords) {
      return res.status(400).json({ 
        error: `Message must be 5-${maxChars} characters long and between 2 and ${maxWords} words.` 
      });
    }

    // 2. Initial immediate save to DB with preliminary tag
    const feedbackDoc = {
      user_id: userId,
      user_email: String(email).trim(),
      user_name: String(name).trim(),
      date: new Date().toISOString(),
      feedback_message: sanitizedMsg,
      ai_tag: "Neutral",
      type: type,
      screenshots: Array.isArray(screenshots) ? screenshots.slice(0, 5) : [],
    };

    const feedbackId = await saveFeedback(feedbackDoc);

    // 3. Immediate response to user (workflow unaffected)
    res.json({
      success: true,
      message: type === "issue" ? "Issue report submitted successfully." : "Feedback submitted successfully.",
    });

    // 4. Asynchronous background Sentiment and Aspect-Based Semantic Analysis
    setImmediate(() => {
      classifyFeedbackAsync(feedbackId, sanitizedMsg).catch((err) => {
        console.warn("Background feedback classification task failed:", err);
      });
    });
  } catch (err: any) {
    console.error("Feedback submission error:", err);
    res.status(500).json({ error: "Failed to submit feedback: " + err.message });
  }
});

// --- History Logs API ---
app.get("/api/history", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const logs = await getHistoryLogs(userId);
    res.json({ logs });
  } catch (error: any) {
    console.error("Fetch history logs error:", error);
    res.status(500).json({ error: "Failed to fetch activity history: " + error.message });
  }
});

app.post("/api/history", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const { type, action, description, durationMinutes, sessionNumber, loggedInTime, loggedOutTime } = req.body;
    
    const newLog = {
      id: "log_" + Date.now(),
      type: type || "action",
      action: action || "interaction",
      description: description || "User performed an action.",
      timestamp: new Date().toISOString(),
      durationMinutes: durationMinutes !== undefined ? Number(durationMinutes) : undefined,
      sessionNumber: sessionNumber !== undefined ? Number(sessionNumber) : undefined,
      loggedInTime,
      loggedOutTime,
    };

    await addHistoryLog(userId, newLog);
    res.json({ success: true, log: newLog });
  } catch (error: any) {
    console.error("Add history log error:", error);
    res.status(500).json({ error: "Failed to record activity log: " + error.message });
  }
});

// Upload Attachment (Base64 file uploader)
app.post("/api/upload", uploadLimiter, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;

    const {
      fileName,
      mimeType,
      base64Data,
      taskId,
    } = req.body;

    //--------------------------------------------------------
    // Basic validation
    //--------------------------------------------------------

    if (!userId) {
      return res.status(401).json({
        error: "Missing user.",
      });
    }

    if (!fileName || !mimeType || !base64Data) {
      return res.status(400).json({
        error: "Missing required fields.",
      });
    }

    //--------------------------------------------------------
    // Validate mime type
    //--------------------------------------------------------

    if (!allowedMimeTypes.has(mimeType)) {
      return res.status(400).json({
        error: "Unsupported file type.",
      });
    }

    //--------------------------------------------------------
    // Validate extension
    //--------------------------------------------------------

    const extension = path.extname(fileName).toLowerCase();

    if (!allowedExtensions.has(extension)) {
      return res.status(400).json({
        error: "Invalid file extension.",
      });
    }

    //--------------------------------------------------------
    // Approximate upload size check BEFORE decoding
    //--------------------------------------------------------

    const estimatedSize = Math.ceil(base64Data.length * 0.75);

    if (estimatedSize > MAX_UPLOAD_SIZE) {
      return res.status(413).json({
        error: "File too large.",
      });
    }

    //--------------------------------------------------------
    // Decode base64
    //--------------------------------------------------------

    let buffer: Buffer;

    try {
      buffer = Buffer.from(base64Data, "base64");
    } catch {
      return res.status(400).json({
        error: "Invalid file data.",
      });
    }

    //--------------------------------------------------------
    // Double-check decoded size
    //--------------------------------------------------------

    if (buffer.length > MAX_UPLOAD_SIZE) {
      return res.status(413).json({
        error: "File too large.",
      });
    }

    //--------------------------------------------------------
    // Ensure upload directory exists
    //--------------------------------------------------------

    await fs.promises.mkdir(uploadsDir, {
      recursive: true,
    });

    //--------------------------------------------------------
    // Generate safe filename
    //--------------------------------------------------------

    const generatedName =
      crypto.randomUUID() + extension;

    const uploadRoot = path.resolve(uploadsDir);

    const targetPath = path.resolve(
      uploadRoot,
      generatedName
    );

    // Extra safety check
    if (!targetPath.startsWith(uploadRoot)) {
      return res.status(400).json({
        error: "Invalid upload path.",
      });
    }

    //--------------------------------------------------------
    // Save file
    //--------------------------------------------------------

    await fs.promises.writeFile(targetPath, buffer);

    //--------------------------------------------------------
    // Attachment metadata
    //--------------------------------------------------------

    const attachmentUrl = `/uploads/${generatedName}`;

    const attachment: TaskAttachment = {
      id: "attach_" + crypto.randomUUID(),
      name: fileName, // Original filename shown to user
      size: buffer.length,
      mimeType,
      uploadedAt: new Date().toISOString(),
      url: attachmentUrl,
    };

    //--------------------------------------------------------
    // Save attachment to task
    //--------------------------------------------------------

    if (taskId) {
      const data = await fetchUserDashboardData(userId);

      let targetTask: Task | null = null;

      for (const dayId of Object.keys(data.tasks)) {
        const task = data.tasks[dayId].find(
          (t) => t.id === taskId
        );

        if (task) {
          targetTask = {
            ...task,
          };
          break;
        }
      }

      if (targetTask) {
        targetTask.attachments = [
          ...(targetTask.attachments || []),
          attachment,
        ];

        await saveUserTask(userId, targetTask);
      }
    }

    return res.json(attachment);

  } catch (err) {
    console.error("Upload failed:", err);

    return res.status(500).json({
      error: "Failed to upload file.",
    });
  }
});

// AI Planner Importer API
app.post("/api/dashboard/import", async (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const { plannerText, plannerImageBase64, plannerImageMimeType } = req.body;

  if (!ai) {
    return res.status(500).json({
      error: "Gemini API client is not configured on this server. Check GEMINI_API_KEY settings.",
    });
  }

  try {
    let responseText = "";

    const userPrompt = `
Analyze the provided study track, calendar, plan, or list of topics/schedule.
You must construct a highly structured study dashboard.
Parse topics, days/duration, status, dates, resources, and construct a complete study planner.

Format the output strictly as a single JSON object. Do not include markdown wraps like \`\`\`json. Output ONLY the raw JSON string matching the following structure:
{
  "dashboardName": "Descriptive title of this planner track (e.g. UPSC prep, College Semester Plan)",
  "dashboardDescription": "A summary of the goals and target milestones",
  "target": "Overall targets, milestones, or target rank/marks",
  "statusOverview": "Overview of current study status",
  "subjects": [
    {
      "name": "Subject/Module Name",
      "block": "Block 1 - GATE" | "Block 2 - Placements" | "DSA" | "General",
      "daysPlanned": 12,
      "timeline": "e.g. Jul 11-24 or Oct 1-14",
      "pendingTopics": "List of topics pending",
      "completedTopics": "List of topics done if any",
      "percentage": 0, 
      "weightage": "e.g. 10 Marks or High Priority",
      "resource": "Suggested books or website"
    }
  ],
  "tasks": [
    {
      "title": "Daily topic / task title",
      "description": "Specific subtopics to cover, problems to solve, action notes",
      "date": "2026-07-11", // Standard YYYY-MM-DD. Estimate dates starting from July 11, 2026 if no dates are specified. Choose dates in 2026 so they are visible in calendar!
      "category": "Block 1 - GATE" | "Block 2 - Placements" | "DSA" | "General",
      "priority": "Low" | "Medium" | "High",
      "status": "Not Started"
    }
  ]
}

Ensure all dates are strictly in YYYY-MM-DD format (recommend using July/August/September 2026 for any estimated timelines so they display cleanly on our dynamic timetable/calendar!).
Only return the JSON. No conversational text.
`;

    if (plannerImageBase64 && plannerImageMimeType) {
      const imagePart = {
        inlineData: {
          mimeType: plannerImageMimeType,
          data: plannerImageBase64,
        },
      };
      const textPart = {
        text: userPrompt + (plannerText ? `\nAdditional text context provided:\n${plannerText}` : ""),
      };

      const response = await generateContentWithFallback({
        model: "gemini-3.6-flash",
        contents: { parts: [imagePart, textPart] },
        config: {
          responseMimeType: "application/json",
        },
      });
      responseText = response.text || "";
    } else {
      const response = await generateContentWithFallback({
        model: "gemini-3.6-flash",
        contents: userPrompt + `\n\nPlanner Source Material:\n${plannerText}`,
        config: {
          responseMimeType: "application/json",
        },
      });
      responseText = response.text || "";
    }

    let cleanedJson = responseText.trim();
    if (cleanedJson.startsWith("```")) {
      cleanedJson = cleanedJson.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    }

    const parsedPlan = JSON.parse(cleanedJson);
    const newDashId = "dash_ai_" + Date.now();
    const dbName = parsedPlan.dashboardName || "Imported Plan";

    const newDashboard: Dashboard = {
      id: newDashId,
      name: dbName,
      shortName: slugify(dbName),
      description: parsedPlan.dashboardDescription || "AI Imported custom learning track.",
      createdAt: new Date().toISOString(),
      isDefault: false,
      target: parsedPlan.target || "Accomplish all subjects",
      statusOverview: parsedPlan.statusOverview || "Ready to track",
    };

    await saveUserDashboard(userId, newDashboard);

    const createdSubjects: Subject[] = (parsedPlan.subjects || []).map((s: any, idx: number) => ({
      id: `subj_ai_${idx}_${Date.now()}`,
      name: s.name || "Unnamed Module",
      block: s.block || "General",
      daysPlanned: Number(s.daysPlanned) || 5,
      timeline: s.timeline || "Ongoing",
      status: s.percentage === 100 ? "Completed" : s.percentage > 0 ? "In Progress" : "Not Started",
      percentage: Number(s.percentage) || 0,
      pendingTopics: s.pendingTopics || "",
      completedTopics: s.completedTopics || "",
      weightage: s.weightage || "",
      resource: s.resource || "",
    }));

    for (const subj of createdSubjects) {
      await saveUserSubject(userId, subj);
    }

    const createdTasks: Task[] = (parsedPlan.tasks || []).map((t: any, idx: number) => {
      let subjectId = undefined;
      if (t.subjectTitle) {
        const match = createdSubjects.find(
          (sub) => sub.name.toLowerCase() === t.subjectTitle.toLowerCase()
        );
        if (match) subjectId = match.id;
      }

      return {
        id: `task_ai_${idx}_${Date.now()}`,
        dashboardId: newDashId,
        subjectId,
        title: t.title || "Study session",
        description: t.description || "",
        date: t.date || new Date().toISOString().split("T")[0],
        category: t.category || "General",
        status: t.status || "Not Started",
        priority: t.priority || "Medium",
        notes: "",
        timeSpentMinutes: 0,
        timeLogs: [],
        attachments: [],
        boardColumnId: t.status === "Completed" ? "completed" : t.status === "In Progress" ? "in_progress" : "today",
      };
    });

    for (const task of createdTasks) {
      await saveUserTask(userId, task);
    }

    res.json({
      success: true,
      dashboardId: newDashId,
      dashboard: newDashboard,
      subjects: createdSubjects,
      tasks: createdTasks,
    });
  } catch (err: any) {
    console.error("AI Import Failure:", err);
    res.status(500).json({ error: "AI Planner Import failed: " + err.message });
  }
});

// Helper functions for CSV parsing
function parseCSV(text: string): Record<string, string>[] {
  const cleanText = (text || "").replace(/^\uFEFF/, "");
  const lines = cleanText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const rawHeaders = parseCSVLine(lines[0]);
  const headers = rawHeaders.map(h => h.trim());
  const results: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0].trim() === "")) continue;
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      const hTrim = header.trim();
      row[hTrim] = values[idx] !== undefined ? values[idx].trim() : "";
      row[hTrim.toLowerCase()] = values[idx] !== undefined ? values[idx].trim() : "";
    });
    results.push(row);
  }
  return results;
}

function getCsvField(row: Record<string, string>, ...possibleKeys: string[]): string {
  if (!row) return "";
  for (const k of possibleKeys) {
    const lowerKey = k.toLowerCase();
    for (const rk of Object.keys(row)) {
      if (rk.trim().toLowerCase() === lowerKey) {
        if (row[rk] !== undefined && row[rk] !== null && row[rk] !== "") {
          return row[rk];
        }
      }
    }
  }
  return "";
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map(val => val.replace(/^"|"$/g, ""));
}

function getCsvVal(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== "") return row[k];
    const normalized = k.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (row[normalized] !== undefined && row[normalized] !== "") return row[normalized];
  }
  return "";
}

// File Planner Importer API
app.post("/api/dashboard/import-files", async (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const { planMetaText, subjectsCsvText, scheduleCsvText, goalsJsonText, resourcesCsvText } = req.body;

  try {
    // 1. Parse plan_meta.json
    let planMeta: any = {};
    if (planMetaText) {
      planMeta = JSON.parse(planMetaText);
    }

    // 2. Parse goals.json
    let goals: any = {};
    if (goalsJsonText) {
      goals = JSON.parse(goalsJsonText);
    }

    // 3. Parse resources.csv
    let resources: any[] = [];
    if (resourcesCsvText) {
      resources = parseCSV(resourcesCsvText);
    }

    const planInfo = planMeta.plan || {};
    const newDashId = "dash_file_" + Date.now();
    const dbName = planInfo.name || planMeta.name || "My Imported Plan";
    const newDashboard: Dashboard = {
      id: newDashId,
      name: dbName,
      shortName: slugify(dbName),
      description: planInfo.exam || planMeta.description || "Uploaded planner workspace.",
      createdAt: new Date().toISOString(),
      isDefault: false,
      target: planInfo.primary_target || planMeta.target || "Achieve all syllabus milestones",
      statusOverview: planInfo.secondary_target || planMeta.statusOverview || "Initialized from files",
    } as any;

    await saveUserDashboard(userId, newDashboard);

    // 4. Parse subjects.csv and maintain ID mapping
    let createdSubjects: Subject[] = [];
    const subjectIdMap: Record<string, string> = {}; // maps from s01 -> firestore id

    if (subjectsCsvText) {
      const parsedSubjects = parseCSV(subjectsCsvText);
      createdSubjects = parsedSubjects.map((s, idx) => {
        const rawSubjectId = getCsvField(s, "subject_id", "id", "subj_id");
        const firestoreSubjId = `subj_file_${idx}_${Date.now()}`;
        if (rawSubjectId) {
          subjectIdMap[rawSubjectId] = firestoreSubjId;
        }

        const rawBlockId = getCsvField(s, "block_id", "block", "block_name") || "DSA";
        const blockName = rawBlockId === "b1" ? "Block 1" : rawBlockId === "b2" ? "Block 2" : rawBlockId;

        const rawStatus = getCsvField(s, "status", "state") || "Not Started";
        const statusVal = (rawStatus === "done" || rawStatus === "Completed" || rawStatus === "completed") 
          ? "Completed" 
          : (rawStatus === "in_progress" || rawStatus === "In Progress" || rawStatus === "in-progress") 
            ? "In Progress" 
            : "Not Started";

        const daysPlannedVal = Number(getCsvField(s, "planned_days", "daysplanned", "days_planned", "days")) || 10;
        const progressPctVal = Number(getCsvField(s, "progress_pct", "percentage", "progress")) || 0;
        
        const startDate = getCsvField(s, "start_date", "startdate");
        const endDate = getCsvField(s, "end_date", "enddate");
        const timelineStr = startDate && endDate ? `${startDate} to ${endDate}` : (getCsvField(s, "timeline") || "Ongoing");
        const resourceStr = getCsvField(s, "resource_primary", "resource", "resources") || "";
        const weightageStr = getCsvField(s, "exam_weightage", "weightage", "priority") || "";
        const subjectName = getCsvField(s, "name", "subject_name", "subject", "title", "module") || `Subject ${idx + 1}`;

        return {
          id: firestoreSubjId,
          dashboardId: newDashId,
          name: subjectName,
          block: blockName as any,
          daysPlanned: daysPlannedVal,
          timeline: timelineStr,
          status: statusVal as any,
          percentage: progressPctVal,
          pendingTopics: getCsvField(s, "notes", "pendingtopics", "pending_topics") || "Syllabus details",
          completedTopics: getCsvField(s, "completedtopics", "completed_topics") || "",
          weightage: weightageStr,
          resource: resourceStr,
        };
      });

      if (resourcesCsvText) {
        try {
          const parsedResources = parseCSV(resourcesCsvText);
          for (const subj of createdSubjects) {
            const rawSubjId = Object.keys(subjectIdMap).find(k => subjectIdMap[k] === subj.id) || "";
            
            const matchedRes = parsedResources.filter((r) => {
              const resSubjId = (getCsvField(r, "subject_id", "subjectid", "subj_id", "subject") || "").toLowerCase().trim();
              if (!resSubjId) return false;
              if (resSubjId === "all") return true;
              if (rawSubjId && resSubjId === rawSubjId.toLowerCase()) return true;
              if (subj.name && (resSubjId === subj.name.toLowerCase() || subj.name.toLowerCase().includes(resSubjId) || resSubjId.includes(subj.name.toLowerCase()))) return true;
              return false;
            });

            if (matchedRes.length > 0) {
              const formattedResList = matchedRes.map((r) => {
                const rType = (getCsvField(r, "resource_type", "type", "category", "resourcetype") || "").toLowerCase();
                const rTitle = getCsvField(r, "title", "name", "label", "resource_name") || "Resource";
                const rUrl = getCsvField(r, "url_or_location", "url", "link", "location", "path") || "";

                if (rType.includes("video") || rType.includes("youtube") || rType.includes("course") || rType.includes("playlist")) {
                  return `video:${rTitle}|${rUrl}`;
                } else if (rType.includes("textbook") || rType.includes("book") || rType.includes("pdf") || rType.includes("guide")) {
                  return `textbook:${rTitle}${rUrl ? `|${rUrl}` : ""}`;
                } else {
                  return `link:${rTitle}|${rUrl}`;
                }
              });

              const existingRes = subj.resource ? subj.resource.trim() : "";
              const allResList = existingRes ? [existingRes, ...formattedResList] : formattedResList;
              subj.resource = allResList.join(";;");
            }
          }
        } catch (resErr) {
          console.warn("Failed to parse resources.csv during import:", resErr);
        }
      }

      for (const subj of createdSubjects) {
        await saveUserSubject(userId, subj);
      }
    }

    // 5. Parse schedule.csv (Tasks) using the subject ID mapping
    let createdTasks: Task[] = [];
    if (scheduleCsvText) {
      const parsedTasks = parseCSV(scheduleCsvText);
      const todayStr = new Date().toISOString().split("T")[0];

      createdTasks = parsedTasks.map((t, idx) => {
        let subjectId = undefined;
        const rawSubjId = t.subject_id || "";
        
        // Match using the precise map from CSV subject_id -> new firestore id
        if (rawSubjId && subjectIdMap[rawSubjId]) {
          subjectId = subjectIdMap[rawSubjId];
        } else {
          // Fallback to name search
          const targetSubjName = t.subjectName || t.subject || "";
          if (targetSubjName) {
            const match = createdSubjects.find(
              (sub) => sub.name.toLowerCase().includes(targetSubjName.toLowerCase()) || targetSubjName.toLowerCase().includes(sub.name.toLowerCase())
            );
            if (match) subjectId = match.id;
          }
        }

        const taskDate = t.date || todayStr;
        const rawTaskStatus = t.status || "Not Started";
        const taskStatus = (rawTaskStatus === "done" || rawTaskStatus === "Completed" || rawTaskStatus === "completed") 
          ? "Completed" 
          : (rawTaskStatus === "in_progress" || rawTaskStatus === "In Progress" || rawTaskStatus === "in-progress") 
            ? "In Progress" 
            : "Not Started";

        let boardColumnId: Task["boardColumnId"] = "backlog";
        if (taskStatus === "Completed") {
          boardColumnId = "completed";
        } else if (taskStatus === "In Progress") {
          boardColumnId = "in_progress";
        } else if (taskDate === todayStr) {
          boardColumnId = "today";
        } else {
          boardColumnId = "backlog";
        }

        const taskTitle = t.topic || t.title || "Study session";
        const taskType = t.task_type || "";
        const taskDesc = t.notes || t.description || (taskType ? `Type: ${taskType}` : "Study plan entry");
        const rawBlockId = t.block_id || "";
        const categoryVal = rawBlockId === "dsa" ? "DSA" : rawBlockId === "revision" ? "Revision" : rawBlockId === "b1" ? "Block 1" : rawBlockId === "b2" ? "Block 2" : (t.category || "General");

        const taskIdVal = t.taskId || t.taskid || `TSK-${String(idx + 1).padStart(3, "0")}`;

        return {
          id: `task_file_${idx}_${Date.now()}`,
          taskId: taskIdVal,
          taskid: taskIdVal,
          dashboardId: newDashId,
          subjectId,
          title: taskTitle,
          description: taskDesc,
          date: taskDate,
          category: categoryVal as any,
          status: taskStatus,
          priority: (t.priority || "Medium") as any,
          notes: t.notes || "",
          timeSpentMinutes: 0,
          timeLogs: [],
          attachments: [],
          boardColumnId,
        };
      });

      for (const task of createdTasks) {
        await saveUserTask(userId, task);
      }
    }

    await addHistoryLog(userId, {
      id: "hist_import_" + Date.now(),
      type: "action",
      action: "import_planner_files",
      description: `Imported and seeded new study plan "${newDashboard.name}" from CSV/JSON bundle.`,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      dashboardId: newDashId,
      dashboard: newDashboard,
      subjects: createdSubjects,
      tasks: createdTasks,
    });
  } catch (err: any) {
    console.error("File Planner Import Failure:", err);
    res.status(500).json({ error: "Import failed: " + err.message });
  }
});

// AI Chat Endpoint with Function Calling (ACID compliant database operations)
app.post("/api/chat", handleChatbotRequest);

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
